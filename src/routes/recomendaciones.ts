import { Hono } from 'hono';
import type { HonoEnv, RecomendacionEmpresa } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ok, err } from '../lib/responses';

const router = new Hono<HonoEnv>();

// POST /api/recomendaciones — empresa marca técnico como recomendado (idempotente)
router.post('/', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden recomendar técnicos', 403);
  const userId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { tecnico_id } = body;
  if (!tecnico_id || typeof tecnico_id !== 'string') {
    return err(c, 'tecnico_id es requerido', 400);
  }

  try {
    const tecnico = await c.env.DB
      .prepare('SELECT usuario_id FROM perfil_tecnico WHERE usuario_id = ?')
      .bind(tecnico_id)
      .first<{ usuario_id: string }>();
    if (!tecnico) return err(c, 'Técnico no encontrado', 404);

    const now = Math.floor(Date.now() / 1000);

    const result = await c.env.DB
      .prepare('INSERT OR IGNORE INTO recomendacion_empresa (empresa_id, tecnico_id, fecha) VALUES (?, ?, ?)')
      .bind(userId, tecnico_id, now)
      .run();

    // result.meta.changes = 0 → ya existía (idempotente)
    const status = result.meta.changes > 0 ? 201 : 200;
    const rec = await c.env.DB
      .prepare('SELECT * FROM recomendacion_empresa WHERE empresa_id = ? AND tecnico_id = ?')
      .bind(userId, tecnico_id)
      .first<RecomendacionEmpresa>();

    return ok(c, rec, status as 200 | 201);
  } catch {
    return err(c, 'Error al crear recomendación', 500);
  }
});

// DELETE /api/recomendaciones/:tecnico_id — quitar recomendación (solo la empresa que la hizo)
router.delete('/:tecnico_id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden quitar recomendaciones', 403);
  const userId = c.get('userId');
  const tecnicoId = c.req.param('tecnico_id');

  try {
    const existing = await c.env.DB
      .prepare('SELECT empresa_id FROM recomendacion_empresa WHERE empresa_id = ? AND tecnico_id = ?')
      .bind(userId, tecnicoId)
      .first<{ empresa_id: string }>();

    if (!existing) return err(c, 'Recomendación no encontrada', 404);

    await c.env.DB
      .prepare('DELETE FROM recomendacion_empresa WHERE empresa_id = ? AND tecnico_id = ?')
      .bind(userId, tecnicoId)
      .run();

    return ok(c, { message: 'Recomendación eliminada correctamente' });
  } catch {
    return err(c, 'Error al eliminar recomendación', 500);
  }
});

export default router;
