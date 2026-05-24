import { Hono } from 'hono';
import type { HonoEnv, Calificacion, Resena } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ok, err } from '../lib/responses';
import { syncRankingTecnico } from '../lib/ranking';

const router = new Hono<HonoEnv>();

router.post('/', authMiddleware, async (c) => {
  const autorId = c.get('userId');
  const rol = c.get('rol');
  if (rol !== 'EMPRESA' && rol !== 'TECNICO') return err(c, 'Rol no autorizado', 403);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { colaboracion_id, puntaje, comentario } = body;
  if (!colaboracion_id || typeof colaboracion_id !== 'string') return err(c, 'colaboracion_id es requerido', 400);
  if (typeof puntaje !== 'number' || puntaje < 1 || puntaje > 5) return err(c, 'puntaje debe ser un número entre 1 y 5', 400);

  try {
    const colab = await c.env.DB
      .prepare('SELECT tecnico_id, empresa_id, estado FROM colaboracion WHERE id = ?')
      .bind(colaboracion_id)
      .first<{ tecnico_id: string; empresa_id: string; estado: string }>();

    if (!colab) return err(c, 'Colaboración no encontrada', 404);
    if (colab.estado !== 'FINALIZADA') return err(c, 'Solo se puede calificar una colaboración FINALIZADA', 400);
    if (colab.tecnico_id !== autorId && colab.empresa_id !== autorId) {
      return err(c, 'No participaste en esta colaboración', 403);
    }

    const destinatarioId = rol === 'EMPRESA' ? colab.tecnico_id : colab.empresa_id;

    const existing = await c.env.DB
      .prepare('SELECT id FROM calificacion WHERE colaboracion_id = ? AND autor_id = ?')
      .bind(colaboracion_id, autorId)
      .first<{ id: string }>();
    if (existing) return err(c, 'Ya calificaste esta colaboración', 409);

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const puntajeRedondeado = Math.round(puntaje * 2) / 2;

    await c.env.DB
      .prepare(
        'INSERT INTO calificacion (id, colaboracion_id, autor_id, destinatario_id, puntaje, comentario, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, colaboracion_id, autorId, destinatarioId, puntajeRedondeado, typeof comentario === 'string' ? comentario : null, now)
      .run();

    const tabla = rol === 'EMPRESA' ? 'perfil_tecnico' : 'perfil_empresa';
    await c.env.DB
      .prepare(
        `UPDATE ${tabla}
         SET calificacion_promedio = (
           SELECT ROUND(AVG(puntaje) * 2) / 2 FROM calificacion WHERE destinatario_id = ?
         ),
         total_calificaciones = (
           SELECT COUNT(*) FROM calificacion WHERE destinatario_id = ?
         )
         WHERE usuario_id = ?`,
      )
      .bind(destinatarioId, destinatarioId, destinatarioId)
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM calificacion WHERE id = ?').bind(id).first<Calificacion>();

    if (rol === 'EMPRESA') {
      syncRankingTecnico(c.env.DB, destinatarioId).catch(() => {});
    }

    return ok(c, created, 201);
  } catch {
    return err(c, 'Error al crear calificación', 500);
  }
});

router.get('/:destinatarioId', async (c) => {
  const destinatarioId = c.req.param('destinatarioId');
  try {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM calificacion WHERE destinatario_id = ? ORDER BY fecha DESC LIMIT 50')
      .bind(destinatarioId)
      .all<Calificacion>();
    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener calificaciones', 500);
  }
});

router.post('/resenas', authMiddleware, async (c) => {
  const autorId = c.get('userId');
  const rol = c.get('rol');
  if (rol !== 'EMPRESA' && rol !== 'TECNICO') return err(c, 'Rol no autorizado', 403);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { destinatario_id, contenido, puntaje } = body;
  if (!destinatario_id || typeof destinatario_id !== 'string') return err(c, 'destinatario_id es requerido', 400);
  if (!contenido || typeof contenido !== 'string' || !contenido.trim()) return err(c, 'contenido es requerido', 400);

  const puntajeVal = typeof puntaje === 'number' ? puntaje : null;
  if (puntajeVal !== null && (puntajeVal < 1 || puntajeVal > 5)) {
    return err(c, 'puntaje debe ser un número entre 1 y 5', 400);
  }

  try {
    const existing = await c.env.DB
      .prepare('SELECT id FROM resena WHERE autor_id = ? AND destinatario_id = ?')
      .bind(autorId, destinatario_id)
      .first<{ id: string }>();
    if (existing) return err(c, 'Ya dejaste una reseña a este usuario', 409);

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB
      .prepare(
        'INSERT INTO resena (id, autor_id, destinatario_id, contenido, puntaje, respuesta, fecha, fecha_respuesta) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL)',
      )
      .bind(id, autorId, destinatario_id, contenido.trim(), puntajeVal, now)
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM resena WHERE id = ?').bind(id).first<Resena>();
    return ok(c, created, 201);
  } catch {
    return err(c, 'Error al crear reseña', 500);
  }
});

router.get('/resenas/:destinatarioId', async (c) => {
  const destinatarioId = c.req.param('destinatarioId');
  try {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM resena WHERE destinatario_id = ? ORDER BY fecha DESC LIMIT 50')
      .bind(destinatarioId)
      .all<Resena>();
    return ok(c, results);
  } catch {
    return err(c, 'Error al obtener reseñas', 500);
  }
});

router.patch('/resenas/:id/respuesta', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const resenaId = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { respuesta } = body;
  if (!respuesta || typeof respuesta !== 'string' || !respuesta.trim()) return err(c, 'respuesta es requerida', 400);

  try {
    const resena = await c.env.DB
      .prepare('SELECT destinatario_id FROM resena WHERE id = ?')
      .bind(resenaId)
      .first<{ destinatario_id: string }>();

    if (!resena) return err(c, 'Reseña no encontrada', 404);
    if (resena.destinatario_id !== userId) return err(c, 'Solo el destinatario puede responder', 403);

    const now = Math.floor(Date.now() / 1000);
    await c.env.DB
      .prepare('UPDATE resena SET respuesta = ?, fecha_respuesta = ? WHERE id = ?')
      .bind(respuesta.trim(), now, resenaId)
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM resena WHERE id = ?').bind(resenaId).first<Resena>();
    return ok(c, updated);
  } catch {
    return err(c, 'Error al responder reseña', 500);
  }
});

export default router;
