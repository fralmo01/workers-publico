import { Hono } from 'hono';
import type { HonoEnv, Categoria, Habilidad, Distrito } from '../types';
import { ok, err } from '../lib/responses';

const router = new Hono<HonoEnv>();

router.get('/categorias', async (c) => {
  try {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM categoria WHERE activo = 1 ORDER BY orden')
      .all<Categoria>();
    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener categorías', 500);
  }
});

router.get('/habilidades', async (c) => {
  try {
    const categoriaId = c.req.query('categoria');
    const stmt = categoriaId
      ? c.env.DB
          .prepare('SELECT * FROM habilidad WHERE categoria_id = ? AND activo = 1 ORDER BY nombre')
          .bind(categoriaId)
      : c.env.DB.prepare(
          'SELECT * FROM habilidad WHERE activo = 1 ORDER BY categoria_id, nombre',
        );
    const { results } = await stmt.all<Habilidad>();
    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener habilidades', 500);
  }
});

router.get('/distritos', async (c) => {
  try {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM distrito WHERE activo = 1 ORDER BY provincia, nombre')
      .all<Distrito>();
    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener distritos', 500);
  }
});

export default router;
