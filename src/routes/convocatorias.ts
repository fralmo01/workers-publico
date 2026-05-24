import { Hono } from 'hono';
import type { HonoEnv, EstadoConvocatoria, Convocatoria, Postulacion } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ok, err } from '../lib/responses';

const ESTADOS: EstadoConvocatoria[] = ['ABIERTA', 'EN_SELECCION', 'CERRADA'];

const TRANSICIONES: Record<EstadoConvocatoria, EstadoConvocatoria[]> = {
  ABIERTA:      ['EN_SELECCION', 'CERRADA'],
  EN_SELECCION: ['ABIERTA', 'CERRADA'],
  CERRADA:      [],
};

const router = new Hono<HonoEnv>();

router.get('/', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden listar sus convocatorias', 403);
  const userId = c.get('userId');
  try {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM convocatoria WHERE empresa_id = ? ORDER BY fecha_creacion DESC')
      .bind(userId)
      .all<Convocatoria>();
    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener convocatorias', 500);
  }
});

router.post('/', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden crear convocatorias', 403);
  const userId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { titulo, descripcion, categoria_id, plazas_disponibles, fecha_inicio, fecha_fin } = body;

  if (!titulo || typeof titulo !== 'string' || !titulo.trim()) {
    return err(c, 'titulo es requerido', 400);
  }
  if (!categoria_id || typeof categoria_id !== 'string') {
    return err(c, 'categoria_id es requerido', 400);
  }
  if (
    typeof plazas_disponibles !== 'number' ||
    !Number.isInteger(plazas_disponibles) ||
    plazas_disponibles < 1
  ) {
    return err(c, 'plazas_disponibles debe ser un entero mayor a 0', 400);
  }
  if (typeof fecha_inicio !== 'number') {
    return err(c, 'fecha_inicio es requerido (Unix timestamp)', 400);
  }
  if (
    fecha_fin !== undefined &&
    fecha_fin !== null &&
    (typeof fecha_fin !== 'number' || fecha_fin <= fecha_inicio)
  ) {
    return err(c, 'fecha_fin debe ser mayor que fecha_inicio', 400);
  }

  try {
    const cat = await c.env.DB
      .prepare('SELECT id FROM categoria WHERE id = ? AND activo = 1')
      .bind(categoria_id)
      .first<{ id: string }>();
    if (!cat) return err(c, 'categoria_id no existe o está inactiva', 400);

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB
      .prepare(
        `INSERT INTO convocatoria
         (id, empresa_id, titulo, descripcion, categoria_id, plazas_disponibles, plazas_ocupadas,
          estado, fecha_inicio, fecha_fin, fecha_creacion)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'ABIERTA', ?, ?, ?)`,
      )
      .bind(
        id,
        userId,
        titulo.trim(),
        typeof descripcion === 'string' ? descripcion : null,
        categoria_id,
        plazas_disponibles,
        fecha_inicio,
        fecha_fin ?? null,
        now,
      )
      .run();

    const created = await c.env.DB
      .prepare('SELECT * FROM convocatoria WHERE id = ?')
      .bind(id)
      .first<Convocatoria>();

    return ok(c, created, 201);
  } catch {
    return err(c, 'Error al crear convocatoria', 500);
  }
});

router.get('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const conv = await c.env.DB
      .prepare(
        `SELECT c.*,
                pe.razon_social, pe.logo_key, pe.descripcion AS empresa_descripcion,
                pe.sector AS empresa_sector, pe.sitio_web AS empresa_sitio_web,
                pe.calificacion_promedio AS empresa_calificacion,
                pe.total_calificaciones AS empresa_total_calificaciones,
                pe.direccion AS empresa_direccion,
                pe.usuario_id AS empresa_usuario_id
         FROM convocatoria c
         INNER JOIN perfil_empresa pe ON pe.usuario_id = c.empresa_id
         WHERE c.id = ?`,
      )
      .bind(id)
      .first<Record<string, unknown>>();
    if (!conv) return err(c, 'Convocatoria no encontrada', 404);
    return ok(c, conv);
  } catch {
    return err(c, 'Error al obtener convocatoria', 500);
  }
});

router.put('/:id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden editar convocatorias', 403);
  const userId = c.get('userId');
  const id = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  try {
    const existing = await c.env.DB
      .prepare('SELECT empresa_id, estado FROM convocatoria WHERE id = ?')
      .bind(id)
      .first<{ empresa_id: string; estado: EstadoConvocatoria }>();

    if (!existing) return err(c, 'Convocatoria no encontrada', 404);
    if (existing.empresa_id !== userId) return err(c, 'No tienes permiso para editar esta convocatoria', 403);
    if (existing.estado === 'CERRADA') return err(c, 'No se puede editar una convocatoria cerrada', 400);

    const { titulo, descripcion, categoria_id, plazas_disponibles, fecha_inicio, fecha_fin } = body;

    if (!titulo || typeof titulo !== 'string' || !titulo.trim()) {
      return err(c, 'titulo es requerido', 400);
    }
    if (!categoria_id || typeof categoria_id !== 'string') {
      return err(c, 'categoria_id es requerido', 400);
    }
    if (
      typeof plazas_disponibles !== 'number' ||
      !Number.isInteger(plazas_disponibles) ||
      plazas_disponibles < 1
    ) {
      return err(c, 'plazas_disponibles debe ser un entero mayor a 0', 400);
    }
    if (typeof fecha_inicio !== 'number') {
      return err(c, 'fecha_inicio es requerido (Unix timestamp)', 400);
    }
    if (
      fecha_fin !== undefined &&
      fecha_fin !== null &&
      (typeof fecha_fin !== 'number' || fecha_fin <= fecha_inicio)
    ) {
      return err(c, 'fecha_fin debe ser mayor que fecha_inicio', 400);
    }

    const cat = await c.env.DB
      .prepare('SELECT id FROM categoria WHERE id = ? AND activo = 1')
      .bind(categoria_id)
      .first<{ id: string }>();
    if (!cat) return err(c, 'categoria_id no existe o está inactiva', 400);

    await c.env.DB
      .prepare(
        `UPDATE convocatoria
         SET titulo = ?, descripcion = ?, categoria_id = ?,
             plazas_disponibles = ?, fecha_inicio = ?, fecha_fin = ?
         WHERE id = ?`,
      )
      .bind(
        titulo.trim(),
        typeof descripcion === 'string' ? descripcion : null,
        categoria_id,
        plazas_disponibles,
        fecha_inicio,
        fecha_fin ?? null,
        id,
      )
      .run();

    const updated = await c.env.DB
      .prepare('SELECT * FROM convocatoria WHERE id = ?')
      .bind(id)
      .first<Convocatoria>();

    return ok(c, updated);
  } catch {
    return err(c, 'Error al actualizar convocatoria', 500);
  }
});

router.patch('/:id/estado', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden cambiar el estado', 403);
  const userId = c.get('userId');
  const id = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { estado } = body;
  if (!estado || !ESTADOS.includes(estado as EstadoConvocatoria)) {
    return err(c, `estado debe ser uno de: ${ESTADOS.join(', ')}`, 400);
  }

  try {
    const existing = await c.env.DB
      .prepare('SELECT empresa_id, estado FROM convocatoria WHERE id = ?')
      .bind(id)
      .first<{ empresa_id: string; estado: EstadoConvocatoria }>();

    if (!existing) return err(c, 'Convocatoria no encontrada', 404);
    if (existing.empresa_id !== userId) return err(c, 'No tienes permiso para cambiar el estado', 403);

    const nuevo = estado as EstadoConvocatoria;
    if (!TRANSICIONES[existing.estado].includes(nuevo)) {
      return err(c, `Transición inválida: ${existing.estado} → ${nuevo}`, 400);
    }

    await c.env.DB
      .prepare('UPDATE convocatoria SET estado = ? WHERE id = ?')
      .bind(nuevo, id)
      .run();

    return ok(c, { id, estado: nuevo });
  } catch {
    return err(c, 'Error al cambiar estado de convocatoria', 500);
  }
});

router.delete('/:id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden eliminar convocatorias', 403);
  const userId = c.get('userId');
  const id = c.req.param('id');

  try {
    const existing = await c.env.DB
      .prepare('SELECT empresa_id, estado FROM convocatoria WHERE id = ?')
      .bind(id)
      .first<{ empresa_id: string; estado: EstadoConvocatoria }>();

    if (!existing) return err(c, 'Convocatoria no encontrada', 404);
    if (existing.empresa_id !== userId) return err(c, 'No tienes permiso para eliminar esta convocatoria', 403);
    if (existing.estado !== 'ABIERTA') {
      return err(c, 'Solo se pueden eliminar convocatorias en estado ABIERTA', 400);
    }

    const colab = await c.env.DB
      .prepare('SELECT COUNT(*) AS total FROM colaboracion WHERE convocatoria_id = ?')
      .bind(id)
      .first<{ total: number }>();

    if (colab && colab.total > 0) {
      return err(c, 'No se puede eliminar una convocatoria con colaboraciones asociadas', 400);
    }

    await c.env.DB.prepare('DELETE FROM convocatoria WHERE id = ?').bind(id).run();

    return ok(c, { message: 'Convocatoria eliminada correctamente' });
  } catch {
    return err(c, 'Error al eliminar convocatoria', 500);
  }
});

router.post('/:id/postulaciones', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden postular', 403);
  const tecnicoId = c.get('userId');
  const convId = c.req.param('id');

  let mensaje: string | null = null;
  try {
    const body = await c.req.json<Record<string, unknown>>();
    mensaje = typeof body.mensaje === 'string' ? body.mensaje.trim() || null : null;
  } catch { /* mensaje optional */ }

  try {
    const conv = await c.env.DB
      .prepare('SELECT id, estado, plazas_disponibles, plazas_ocupadas FROM convocatoria WHERE id = ?')
      .bind(convId)
      .first<{ id: string; estado: string; plazas_disponibles: number; plazas_ocupadas: number }>();

    if (!conv) return err(c, 'Convocatoria no encontrada', 404);
    if (conv.estado === 'CERRADA') return err(c, 'La convocatoria está cerrada', 400);
    if (conv.plazas_ocupadas >= conv.plazas_disponibles) return err(c, 'No hay plazas disponibles', 400);

    const existing = await c.env.DB
      .prepare('SELECT id FROM postulacion WHERE convocatoria_id = ? AND tecnico_id = ?')
      .bind(convId, tecnicoId)
      .first<{ id: string }>();

    if (existing) return err(c, 'Ya postulaste a esta convocatoria', 409);

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO postulacion (id, convocatoria_id, tecnico_id, estado, mensaje, fecha_creacion)
           VALUES (?, ?, ?, 'PENDIENTE', ?, ?)`,
        )
        .bind(id, convId, tecnicoId, mensaje, now),
      c.env.DB
        .prepare('UPDATE convocatoria SET plazas_ocupadas = plazas_ocupadas + 1 WHERE id = ?')
        .bind(convId),
    ]);

    const created = await c.env.DB
      .prepare('SELECT * FROM postulacion WHERE id = ?')
      .bind(id)
      .first<Postulacion>();

    return ok(c, created, 201);
  } catch {
    return err(c, 'Error al postular', 500);
  }
});

router.get('/:id/postulaciones', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden ver las postulaciones', 403);
  const empresaId = c.get('userId');
  const convId = c.req.param('id');

  try {
    const conv = await c.env.DB
      .prepare('SELECT empresa_id FROM convocatoria WHERE id = ?')
      .bind(convId)
      .first<{ empresa_id: string }>();

    if (!conv) return err(c, 'Convocatoria no encontrada', 404);
    if (conv.empresa_id !== empresaId) return err(c, 'No tienes permiso para ver estas postulaciones', 403);

    const { results } = await c.env.DB
      .prepare(
        `SELECT p.*, pt.nombre_completo, pt.foto_key, pt.nivel, pt.calificacion_promedio
         FROM postulacion p
         INNER JOIN perfil_tecnico pt ON pt.usuario_id = p.tecnico_id
         WHERE p.convocatoria_id = ?
         ORDER BY p.fecha_creacion ASC`,
      )
      .bind(convId)
      .all<Record<string, unknown>>();

    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener postulaciones', 500);
  }
});

export default router;
