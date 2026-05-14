import { Hono } from 'hono';
import type { HonoEnv, EstadoPostulacion, Postulacion } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ok, err } from '../lib/responses';

const ESTADOS_VALIDOS: EstadoPostulacion[] = ['PENDIENTE', 'ACEPTADA', 'RECHAZADA'];

const router = new Hono<HonoEnv>();

// GET /api/postulaciones/mis-postulaciones — técnico ve sus postulaciones con info de convocatoria
router.get('/mis-postulaciones', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden ver sus postulaciones', 403);
  const tecnicoId = c.get('userId');

  try {
    const { results } = await c.env.DB
      .prepare(
        `SELECT p.*, c.titulo, c.estado AS conv_estado, c.empresa_id,
                pe.razon_social, pe.logo_key
         FROM postulacion p
         INNER JOIN convocatoria c ON c.id = p.convocatoria_id
         INNER JOIN perfil_empresa pe ON pe.usuario_id = c.empresa_id
         WHERE p.tecnico_id = ?
         ORDER BY p.fecha_creacion DESC`,
      )
      .bind(tecnicoId)
      .all<Record<string, unknown>>();

    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener postulaciones', 500);
  }
});

// GET /api/postulaciones/mi-estado?convocatoria_id=xxx — estado de la postulación del técnico
router.get('/mi-estado', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden consultar su estado', 403);
  const tecnicoId = c.get('userId');
  const convId = c.req.query('convocatoria_id');

  if (!convId) return err(c, 'convocatoria_id es requerido', 400);

  try {
    const post = await c.env.DB
      .prepare('SELECT * FROM postulacion WHERE convocatoria_id = ? AND tecnico_id = ?')
      .bind(convId, tecnicoId)
      .first<Postulacion>();

    return ok(c, post ?? null);
  } catch {
    return err(c, 'Error al consultar estado', 500);
  }
});

// PATCH /api/postulaciones/:id/estado — empresa acepta o rechaza
router.patch('/:id/estado', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden gestionar postulaciones', 403);
  const empresaId = c.get('userId');
  const postId = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const nuevoEstado = body.estado as EstadoPostulacion | undefined;
  if (!nuevoEstado || !ESTADOS_VALIDOS.includes(nuevoEstado) || nuevoEstado === 'PENDIENTE') {
    return err(c, 'estado debe ser ACEPTADA o RECHAZADA', 400);
  }

  try {
    const post = await c.env.DB
      .prepare(
        `SELECT p.*, c.empresa_id, c.estado AS conv_estado, c.plazas_disponibles, c.plazas_ocupadas
         FROM postulacion p
         INNER JOIN convocatoria c ON c.id = p.convocatoria_id
         WHERE p.id = ?`,
      )
      .bind(postId)
      .first<Postulacion & { empresa_id: string; conv_estado: string; plazas_disponibles: number; plazas_ocupadas: number }>();

    if (!post) return err(c, 'Postulación no encontrada', 404);
    if (post.empresa_id !== empresaId) return err(c, 'No tienes permiso para gestionar esta postulación', 403);
    if (post.estado !== 'PENDIENTE') return err(c, 'Solo se pueden gestionar postulaciones PENDIENTE', 400);

    if (nuevoEstado === 'ACEPTADA') {
      if (post.plazas_ocupadas >= post.plazas_disponibles) {
        return err(c, 'No hay plazas disponibles en esta convocatoria', 400);
      }

      const colaboracionId = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);

      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE postulacion SET estado = ? WHERE id = ?').bind('ACEPTADA', postId),
        c.env.DB
          .prepare(
            `INSERT INTO colaboracion (id, convocatoria_id, tecnico_id, empresa_id, estado, fecha_inicio, fecha_creacion)
             VALUES (?, ?, ?, ?, 'EN_CURSO', ?, ?)`,
          )
          .bind(colaboracionId, post.convocatoria_id, post.tecnico_id, empresaId, now, now),
        c.env.DB
          .prepare('UPDATE convocatoria SET plazas_ocupadas = plazas_ocupadas + 1 WHERE id = ?')
          .bind(post.convocatoria_id),
      ]);

      return ok(c, { id: postId, estado: 'ACEPTADA', colaboracion_id: colaboracionId });
    }

    // RECHAZADA
    await c.env.DB
      .prepare('UPDATE postulacion SET estado = ? WHERE id = ?')
      .bind('RECHAZADA', postId)
      .run();

    return ok(c, { id: postId, estado: 'RECHAZADA' });
  } catch {
    return err(c, 'Error al actualizar postulación', 500);
  }
});

export default router;
