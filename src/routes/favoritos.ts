import { Hono } from 'hono';
import type { HonoEnv, TipoFavorito, Favorito } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ok, err } from '../lib/responses';

const router = new Hono<HonoEnv>();

router.get('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  try {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM favorito WHERE usuario_id = ? ORDER BY fecha DESC')
      .bind(userId)
      .all<Favorito>();
    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener favoritos', 500);
  }
});

router.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const rol = c.get('rol');

  if (rol !== 'EMPRESA' && rol !== 'TECNICO') {
    return err(c, 'Solo EMPRESA o TECNICO pueden guardar favoritos', 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { objetivo_id, tipo } = body;

  if (!objetivo_id || typeof objetivo_id !== 'string') {
    return err(c, 'objetivo_id es requerido', 400);
  }
  if (!tipo || typeof tipo !== 'string') {
    return err(c, 'tipo es requerido', 400);
  }

  if (rol === 'EMPRESA' && tipo !== 'TECNICO_GUARDADO') {
    return err(c, 'Las empresas solo pueden guardar técnicos (tipo: TECNICO_GUARDADO)', 400);
  }
  if (rol === 'TECNICO' && tipo !== 'EMPRESA_GUARDADA') {
    return err(c, 'Los técnicos solo pueden guardar empresas (tipo: EMPRESA_GUARDADA)', 400);
  }

  const tipoValor = tipo as TipoFavorito;

  try {
    const objetivoExiste = tipoValor === 'TECNICO_GUARDADO'
      ? await c.env.DB
          .prepare('SELECT usuario_id FROM perfil_tecnico WHERE usuario_id = ?')
          .bind(objetivo_id)
          .first<{ usuario_id: string }>()
      : await c.env.DB
          .prepare('SELECT usuario_id FROM perfil_empresa WHERE usuario_id = ?')
          .bind(objetivo_id)
          .first<{ usuario_id: string }>();

    if (!objetivoExiste) {
      return err(c, 'Usuario objetivo no encontrado o no tiene el perfil requerido', 404);
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    try {
      await c.env.DB
        .prepare('INSERT INTO favorito (id, usuario_id, objetivo_id, tipo, fecha) VALUES (?, ?, ?, ?, ?)')
        .bind(id, userId, objetivo_id, tipoValor, now)
        .run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        return err(c, 'Ya guardaste este favorito', 409);
      }
      throw e;
    }

    const created = await c.env.DB
      .prepare('SELECT * FROM favorito WHERE id = ?')
      .bind(id)
      .first<Favorito>();

    return ok(c, created, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return err(c, 'Ya guardaste este favorito', 409);
    }
    return err(c, 'Error al guardar favorito', 500);
  }
});

router.delete('/:id', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  try {
    const favorito = await c.env.DB
      .prepare('SELECT usuario_id FROM favorito WHERE id = ?')
      .bind(id)
      .first<{ usuario_id: string }>();

    if (!favorito) return err(c, 'Favorito no encontrado', 404);
    if (favorito.usuario_id !== userId) return err(c, 'No tienes permiso para quitar este favorito', 403);

    await c.env.DB.prepare('DELETE FROM favorito WHERE id = ?').bind(id).run();
    return ok(c, { message: 'Favorito eliminado correctamente' });
  } catch {
    return err(c, 'Error al eliminar favorito', 500);
  }
});

export default router;
