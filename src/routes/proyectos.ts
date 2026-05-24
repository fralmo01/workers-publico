import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ok, err } from '../lib/responses';

const router = new Hono<HonoEnv>();

router.get('/:tecnicoId', async (c) => {
  const tecnicoId = c.req.param('tecnicoId');
  try {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM proyecto_tecnico WHERE tecnico_id = ? ORDER BY fecha_creacion DESC')
      .bind(tecnicoId)
      .all<Record<string, unknown>>();
    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener proyectos', 500);
  }
});

router.post('/', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden crear proyectos', 403);
  const userId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
  if (!titulo) return err(c, 'titulo es requerido', 400);

  const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() || null : null;
  const url = typeof body.url === 'string' ? body.url.trim() || null : null;

  try {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB
      .prepare(
        'INSERT INTO proyecto_tecnico (id, tecnico_id, titulo, descripcion, url, fecha_creacion) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(id, userId, titulo, descripcion, url, now)
      .run();
    const created = await c.env.DB
      .prepare('SELECT * FROM proyecto_tecnico WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();
    return ok(c, created, 201);
  } catch {
    return err(c, 'Error al crear proyecto', 500);
  }
});

router.put('/:id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden editar proyectos', 403);
  const userId = c.get('userId');
  const proyectoId = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  try {
    const existing = await c.env.DB
      .prepare('SELECT tecnico_id FROM proyecto_tecnico WHERE id = ?')
      .bind(proyectoId)
      .first<{ tecnico_id: string }>();

    if (!existing) return err(c, 'Proyecto no encontrado', 404);
    if (existing.tecnico_id !== userId) return err(c, 'No tienes permiso para editar este proyecto', 403);

    const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
    if (!titulo) return err(c, 'titulo es requerido', 400);

    const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() || null : null;
    const url = typeof body.url === 'string' ? body.url.trim() || null : null;

    await c.env.DB
      .prepare('UPDATE proyecto_tecnico SET titulo = ?, descripcion = ?, url = ? WHERE id = ?')
      .bind(titulo, descripcion, url, proyectoId)
      .run();

    const updated = await c.env.DB
      .prepare('SELECT * FROM proyecto_tecnico WHERE id = ?')
      .bind(proyectoId)
      .first<Record<string, unknown>>();

    return ok(c, updated);
  } catch {
    return err(c, 'Error al actualizar proyecto', 500);
  }
});

router.delete('/:id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden eliminar proyectos', 403);
  const userId = c.get('userId');
  const proyectoId = c.req.param('id');

  try {
    const existing = await c.env.DB
      .prepare('SELECT tecnico_id, portada_key FROM proyecto_tecnico WHERE id = ?')
      .bind(proyectoId)
      .first<{ tecnico_id: string; portada_key: string | null }>();

    if (!existing) return err(c, 'Proyecto no encontrado', 404);
    if (existing.tecnico_id !== userId) return err(c, 'No tienes permiso para eliminar este proyecto', 403);

    if (existing.portada_key) {
      await c.env.BUCKET.delete(existing.portada_key).catch(() => {});
    }

    await c.env.DB
      .prepare('DELETE FROM proyecto_tecnico WHERE id = ?')
      .bind(proyectoId)
      .run();

    return ok(c, { message: 'Proyecto eliminado correctamente' });
  } catch {
    return err(c, 'Error al eliminar proyecto', 500);
  }
});

export default router;
