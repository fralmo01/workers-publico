import { Hono } from 'hono';
import type { HonoEnv, EstadoColaboracion, Colaboracion } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ok, err } from '../lib/responses';

const ESTADOS: EstadoColaboracion[] = ['EN_CURSO', 'FINALIZADA', 'CANCELADA'];

const TRANSICIONES: Record<EstadoColaboracion, EstadoColaboracion[]> = {
  EN_CURSO:   ['FINALIZADA', 'CANCELADA'],
  FINALIZADA: [],
  CANCELADA:  [],
};

const router = new Hono<HonoEnv>();

// GET /api/colaboraciones — listar del usuario autenticado (empresa o técnico)
router.get('/', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const rol = c.get('rol');

  if (rol !== 'EMPRESA' && rol !== 'TECNICO') {
    return err(c, 'Rol no autorizado para listar colaboraciones', 403);
  }

  const col = rol === 'EMPRESA' ? 'empresa_id' : 'tecnico_id';

  try {
    const { results } = await c.env.DB
      .prepare(`SELECT * FROM colaboracion WHERE ${col} = ? ORDER BY fecha_creacion DESC`)
      .bind(userId)
      .all<Colaboracion>();
    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener colaboraciones', 500);
  }
});

// POST /api/colaboraciones — crear (solo EMPRESA)
router.post('/', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden crear colaboraciones', 403);
  const userId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { tecnico_id, convocatoria_id, fecha_inicio } = body;

  if (!tecnico_id || typeof tecnico_id !== 'string') {
    return err(c, 'tecnico_id es requerido', 400);
  }
  if (typeof fecha_inicio !== 'number') {
    return err(c, 'fecha_inicio es requerido (Unix timestamp)', 400);
  }

  try {
    const tecnico = await c.env.DB
      .prepare('SELECT usuario_id FROM perfil_tecnico WHERE usuario_id = ?')
      .bind(tecnico_id)
      .first<{ usuario_id: string }>();
    if (!tecnico) return err(c, 'Técnico no encontrado', 404);

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    if (convocatoria_id != null) {
      if (typeof convocatoria_id !== 'string') {
        return err(c, 'convocatoria_id debe ser string', 400);
      }

      const conv = await c.env.DB
        .prepare(
          'SELECT empresa_id, plazas_disponibles, plazas_ocupadas, estado FROM convocatoria WHERE id = ?',
        )
        .bind(convocatoria_id)
        .first<{ empresa_id: string; plazas_disponibles: number; plazas_ocupadas: number; estado: string }>();

      if (!conv) return err(c, 'Convocatoria no encontrada', 404);
      if (conv.empresa_id !== userId) return err(c, 'La convocatoria no pertenece a tu empresa', 403);
      if (conv.estado === 'CERRADA') return err(c, 'La convocatoria está cerrada', 400);
      if (conv.plazas_ocupadas >= conv.plazas_disponibles) {
        return err(c, 'No hay plazas disponibles en esta convocatoria', 400);
      }

      // Batch atómico: crear colaboración + ocupar plaza
      await c.env.DB.batch([
        c.env.DB
          .prepare(
            `INSERT INTO colaboracion
             (id, convocatoria_id, tecnico_id, empresa_id, estado, fecha_inicio, fecha_creacion)
             VALUES (?, ?, ?, ?, 'EN_CURSO', ?, ?)`,
          )
          .bind(id, convocatoria_id, tecnico_id, userId, fecha_inicio, now),
        c.env.DB
          .prepare('UPDATE convocatoria SET plazas_ocupadas = plazas_ocupadas + 1 WHERE id = ?')
          .bind(convocatoria_id),
      ]);
    } else {
      await c.env.DB
        .prepare(
          `INSERT INTO colaboracion
           (id, convocatoria_id, tecnico_id, empresa_id, estado, fecha_inicio, fecha_creacion)
           VALUES (?, NULL, ?, ?, 'EN_CURSO', ?, ?)`,
        )
        .bind(id, tecnico_id, userId, fecha_inicio, now)
        .run();
    }

    const created = await c.env.DB
      .prepare('SELECT * FROM colaboracion WHERE id = ?')
      .bind(id)
      .first<Colaboracion>();

    return ok(c, created, 201);
  } catch {
    return err(c, 'Error al crear colaboración', 500);
  }
});

// GET /api/colaboraciones/:id — detalle (solo empresa o técnico involucrado)
router.get('/:id', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  try {
    const colab = await c.env.DB
      .prepare('SELECT * FROM colaboracion WHERE id = ?')
      .bind(id)
      .first<Colaboracion>();

    if (!colab) return err(c, 'Colaboración no encontrada', 404);
    if (colab.empresa_id !== userId && colab.tecnico_id !== userId) {
      return err(c, 'No tienes acceso a esta colaboración', 403);
    }

    return ok(c, colab);
  } catch {
    return err(c, 'Error al obtener colaboración', 500);
  }
});

// PATCH /api/colaboraciones/:id/estado — cambiar estado (empresa o técnico involucrado)
router.patch('/:id/estado', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { estado } = body;
  if (!estado || !ESTADOS.includes(estado as EstadoColaboracion)) {
    return err(c, `estado debe ser uno de: ${ESTADOS.join(', ')}`, 400);
  }

  try {
    const colab = await c.env.DB
      .prepare('SELECT empresa_id, tecnico_id, estado FROM colaboracion WHERE id = ?')
      .bind(id)
      .first<{ empresa_id: string; tecnico_id: string; estado: EstadoColaboracion }>();

    if (!colab) return err(c, 'Colaboración no encontrada', 404);
    if (colab.empresa_id !== userId && colab.tecnico_id !== userId) {
      return err(c, 'No tienes acceso a esta colaboración', 403);
    }

    const nuevo = estado as EstadoColaboracion;
    if (!TRANSICIONES[colab.estado].includes(nuevo)) {
      return err(c, `Transición inválida: ${colab.estado} → ${nuevo}`, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const fechaFin = nuevo === 'FINALIZADA' || nuevo === 'CANCELADA' ? now : null;

    // TODO Fase 4: al pasar a FINALIZADA, disparar creación de constancia y solicitud de calificación
    await c.env.DB
      .prepare('UPDATE colaboracion SET estado = ?, fecha_fin = ? WHERE id = ?')
      .bind(nuevo, fechaFin, id)
      .run();

    return ok(c, { id, estado: nuevo, fecha_fin: fechaFin });
  } catch {
    return err(c, 'Error al cambiar estado de colaboración', 500);
  }
});

export default router;
