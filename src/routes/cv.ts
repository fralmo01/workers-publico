import { Hono } from 'hono';
import type { HonoEnv, CV, ExperienciaCV, EducacionCV, Certificado, TipoExperiencia } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ok, err } from '../lib/responses';

const TIPOS: TipoExperiencia[] = ['PROYECTO', 'EMPLEO', 'PRACTICA'];
const URL_RE = /^https?:\/\/.+/;

const router = new Hono<HonoEnv>();

async function getOrCreateCV(db: D1Database, tecnicoId: string): Promise<CV> {
  const existing = await db
    .prepare('SELECT * FROM cv WHERE tecnico_id = ?')
    .bind(tecnicoId)
    .first<CV>();
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare('INSERT INTO cv (id, tecnico_id, pdf_key, ultima_actualizacion) VALUES (?, ?, NULL, ?)')
    .bind(id, tecnicoId, now)
    .run();
  return { id, tecnico_id: tecnicoId, pdf_key: null, ultima_actualizacion: now };
}

async function getCVData(db: D1Database, cvId: string) {
  const [expRes, eduRes, certRes] = await Promise.all([
    db.prepare('SELECT * FROM experiencia_cv WHERE cv_id = ? ORDER BY fecha_inicio DESC').bind(cvId).all<ExperienciaCV>(),
    db.prepare('SELECT * FROM educacion WHERE cv_id = ? ORDER BY fecha_inicio DESC').bind(cvId).all<EducacionCV>(),
    db.prepare('SELECT * FROM certificado WHERE cv_id = ? ORDER BY fecha DESC').bind(cvId).all<Certificado>(),
  ]);
  return {
    experiencias: expRes.results,
    educacion: eduRes.results,
    certificados: certRes.results,
  };
}

// GET /api/cv/mio — CV completo del técnico autenticado
router.get('/mio', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos tienen CV', 403);
  const tecnicoId = c.get('userId');
  try {
    const cv = await getOrCreateCV(c.env.DB, tecnicoId);

    // Habilidades del técnico
    const habRes = await c.env.DB
      .prepare(
        `SELECT h.id, h.nombre, h.categoria_id FROM habilidad h
         INNER JOIN tecnico_habilidad th ON th.habilidad_id = h.id
         WHERE th.tecnico_id = ?`,
      )
      .bind(tecnicoId)
      .all<{ id: string; nombre: string; categoria_id: string }>();

    const data = await getCVData(c.env.DB, cv.id);
    return ok(c, { cv, ...data, habilidades: habRes.results });
  } catch {
    return err(c, 'Error al obtener CV', 500);
  }
});

// GET /api/cv/:tecnicoId — CV público de un técnico
router.get('/:tecnicoId', async (c) => {
  const tecnicoId = c.req.param('tecnicoId');
  try {
    const cv = await c.env.DB
      .prepare('SELECT * FROM cv WHERE tecnico_id = ?')
      .bind(tecnicoId)
      .first<CV>();

    const habRes = await c.env.DB
      .prepare(
        `SELECT h.id, h.nombre, h.categoria_id FROM habilidad h
         INNER JOIN tecnico_habilidad th ON th.habilidad_id = h.id
         WHERE th.tecnico_id = ?`,
      )
      .bind(tecnicoId)
      .all<{ id: string; nombre: string; categoria_id: string }>();

    if (!cv) {
      return ok(c, { cv: null, experiencias: [], educacion: [], certificados: [], habilidades: habRes.results });
    }

    const data = await getCVData(c.env.DB, cv.id);
    return ok(c, { cv, ...data, habilidades: habRes.results });
  } catch {
    return err(c, 'Error al obtener CV', 500);
  }
});

// PUT /api/cv/habilidades — reemplaza las habilidades del técnico
router.put('/habilidades', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden modificar habilidades', 403);
  const tecnicoId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const ids = body.habilidad_ids;
  if (!Array.isArray(ids) || ids.some((h) => typeof h !== 'string')) {
    return err(c, 'habilidad_ids debe ser un array de strings', 400);
  }

  try {
    const stmts: D1PreparedStatement[] = [
      c.env.DB.prepare('DELETE FROM tecnico_habilidad WHERE tecnico_id = ?').bind(tecnicoId),
    ];
    for (const habId of ids as string[]) {
      stmts.push(
        c.env.DB
          .prepare('INSERT OR IGNORE INTO tecnico_habilidad (tecnico_id, habilidad_id) VALUES (?, ?)')
          .bind(tecnicoId, habId),
      );
    }
    await c.env.DB.batch(stmts);
    return ok(c, { habilidades_guardadas: ids.length });
  } catch {
    return err(c, 'Error al actualizar habilidades', 500);
  }
});

// POST /api/cv/experiencia — agregar experiencia
router.post('/experiencia', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden editar su CV', 403);
  const tecnicoId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { tipo, titulo, descripcion, fecha_inicio, fecha_fin } = body;

  if (!tipo || !TIPOS.includes(tipo as TipoExperiencia)) {
    return err(c, `tipo debe ser uno de: ${TIPOS.join(', ')}`, 400);
  }
  if (!titulo || typeof titulo !== 'string' || !titulo.trim()) {
    return err(c, 'titulo es requerido', 400);
  }
  if (typeof fecha_inicio !== 'number') {
    return err(c, 'fecha_inicio es requerido (Unix timestamp)', 400);
  }
  if (fecha_fin !== undefined && fecha_fin !== null && (typeof fecha_fin !== 'number' || fecha_fin < fecha_inicio)) {
    return err(c, 'fecha_fin debe ser >= fecha_inicio', 400);
  }

  try {
    const cv = await getOrCreateCV(c.env.DB, tecnicoId);
    const id = crypto.randomUUID();
    await c.env.DB
      .prepare(
        'INSERT INTO experiencia_cv (id, cv_id, tipo, titulo, descripcion, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, cv.id, tipo, titulo.trim(), typeof descripcion === 'string' ? descripcion : null, fecha_inicio, fecha_fin ?? null)
      .run();
    const created = await c.env.DB.prepare('SELECT * FROM experiencia_cv WHERE id = ?').bind(id).first<ExperienciaCV>();
    return ok(c, created, 201);
  } catch {
    return err(c, 'Error al agregar experiencia', 500);
  }
});

// PUT /api/cv/experiencia/:id — actualizar experiencia
router.put('/experiencia/:id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden editar su CV', 403);
  const tecnicoId = c.get('userId');
  const expId = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { tipo, titulo, descripcion, fecha_inicio, fecha_fin } = body;

  if (!tipo || !TIPOS.includes(tipo as TipoExperiencia)) {
    return err(c, `tipo debe ser uno de: ${TIPOS.join(', ')}`, 400);
  }
  if (!titulo || typeof titulo !== 'string' || !titulo.trim()) {
    return err(c, 'titulo es requerido', 400);
  }
  if (typeof fecha_inicio !== 'number') {
    return err(c, 'fecha_inicio es requerido (Unix timestamp)', 400);
  }

  try {
    const cv = await c.env.DB.prepare('SELECT id FROM cv WHERE tecnico_id = ?').bind(tecnicoId).first<{ id: string }>();
    if (!cv) return err(c, 'CV no encontrado', 404);

    const exp = await c.env.DB.prepare('SELECT cv_id FROM experiencia_cv WHERE id = ?').bind(expId).first<{ cv_id: string }>();
    if (!exp || exp.cv_id !== cv.id) return err(c, 'Experiencia no encontrada', 404);

    await c.env.DB
      .prepare('UPDATE experiencia_cv SET tipo = ?, titulo = ?, descripcion = ?, fecha_inicio = ?, fecha_fin = ? WHERE id = ?')
      .bind(tipo, titulo.trim(), typeof descripcion === 'string' ? descripcion : null, fecha_inicio, fecha_fin ?? null, expId)
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM experiencia_cv WHERE id = ?').bind(expId).first<ExperienciaCV>();
    return ok(c, updated);
  } catch {
    return err(c, 'Error al actualizar experiencia', 500);
  }
});

// DELETE /api/cv/experiencia/:id
router.delete('/experiencia/:id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden editar su CV', 403);
  const tecnicoId = c.get('userId');
  const expId = c.req.param('id');

  try {
    const cv = await c.env.DB.prepare('SELECT id FROM cv WHERE tecnico_id = ?').bind(tecnicoId).first<{ id: string }>();
    if (!cv) return err(c, 'CV no encontrado', 404);

    const exp = await c.env.DB.prepare('SELECT cv_id FROM experiencia_cv WHERE id = ?').bind(expId).first<{ cv_id: string }>();
    if (!exp || exp.cv_id !== cv.id) return err(c, 'Experiencia no encontrada', 404);

    await c.env.DB.prepare('DELETE FROM experiencia_cv WHERE id = ?').bind(expId).run();
    return ok(c, { id: expId });
  } catch {
    return err(c, 'Error al eliminar experiencia', 500);
  }
});

// POST /api/cv/educacion
router.post('/educacion', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden editar su CV', 403);
  const tecnicoId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { institucion, titulo, fecha_inicio, fecha_fin } = body;
  if (!institucion || typeof institucion !== 'string' || !institucion.trim()) return err(c, 'institucion es requerido', 400);
  if (!titulo || typeof titulo !== 'string' || !titulo.trim()) return err(c, 'titulo es requerido', 400);
  if (typeof fecha_inicio !== 'number') return err(c, 'fecha_inicio es requerido (Unix timestamp)', 400);

  try {
    const cv = await getOrCreateCV(c.env.DB, tecnicoId);
    const id = crypto.randomUUID();
    await c.env.DB
      .prepare('INSERT INTO educacion (id, cv_id, institucion, titulo, fecha_inicio, fecha_fin) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, cv.id, institucion.trim(), titulo.trim(), fecha_inicio, fecha_fin ?? null)
      .run();
    const created = await c.env.DB.prepare('SELECT * FROM educacion WHERE id = ?').bind(id).first<EducacionCV>();
    return ok(c, created, 201);
  } catch {
    return err(c, 'Error al agregar educación', 500);
  }
});

// PUT /api/cv/educacion/:id
router.put('/educacion/:id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden editar su CV', 403);
  const tecnicoId = c.get('userId');
  const eduId = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { institucion, titulo, fecha_inicio, fecha_fin } = body;
  if (!institucion || typeof institucion !== 'string' || !institucion.trim()) return err(c, 'institucion es requerido', 400);
  if (!titulo || typeof titulo !== 'string' || !titulo.trim()) return err(c, 'titulo es requerido', 400);
  if (typeof fecha_inicio !== 'number') return err(c, 'fecha_inicio es requerido (Unix timestamp)', 400);

  try {
    const cv = await c.env.DB.prepare('SELECT id FROM cv WHERE tecnico_id = ?').bind(tecnicoId).first<{ id: string }>();
    if (!cv) return err(c, 'CV no encontrado', 404);
    const edu = await c.env.DB.prepare('SELECT cv_id FROM educacion WHERE id = ?').bind(eduId).first<{ cv_id: string }>();
    if (!edu || edu.cv_id !== cv.id) return err(c, 'Educación no encontrada', 404);

    await c.env.DB
      .prepare('UPDATE educacion SET institucion = ?, titulo = ?, fecha_inicio = ?, fecha_fin = ? WHERE id = ?')
      .bind(institucion.trim(), titulo.trim(), fecha_inicio, fecha_fin ?? null, eduId)
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM educacion WHERE id = ?').bind(eduId).first<EducacionCV>();
    return ok(c, updated);
  } catch {
    return err(c, 'Error al actualizar educación', 500);
  }
});

// DELETE /api/cv/educacion/:id
router.delete('/educacion/:id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden editar su CV', 403);
  const tecnicoId = c.get('userId');
  const eduId = c.req.param('id');

  try {
    const cv = await c.env.DB.prepare('SELECT id FROM cv WHERE tecnico_id = ?').bind(tecnicoId).first<{ id: string }>();
    if (!cv) return err(c, 'CV no encontrado', 404);
    const edu = await c.env.DB.prepare('SELECT cv_id FROM educacion WHERE id = ?').bind(eduId).first<{ cv_id: string }>();
    if (!edu || edu.cv_id !== cv.id) return err(c, 'Educación no encontrada', 404);

    await c.env.DB.prepare('DELETE FROM educacion WHERE id = ?').bind(eduId).run();
    return ok(c, { id: eduId });
  } catch {
    return err(c, 'Error al eliminar educación', 500);
  }
});

// POST /api/cv/certificado
router.post('/certificado', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden editar su CV', 403);
  const tecnicoId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { nombre, institucion, fecha, url } = body;
  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) return err(c, 'nombre es requerido', 400);
  if (!institucion || typeof institucion !== 'string' || !institucion.trim()) return err(c, 'institucion es requerido', 400);
  if (typeof fecha !== 'number') return err(c, 'fecha es requerido (Unix timestamp)', 400);
  const urlVal = typeof url === 'string' ? url.trim() || null : null;
  if (urlVal && !URL_RE.test(urlVal)) return err(c, 'url debe ser una URL válida', 400);

  try {
    const cv = await getOrCreateCV(c.env.DB, tecnicoId);
    const id = crypto.randomUUID();
    await c.env.DB
      .prepare('INSERT INTO certificado (id, cv_id, nombre, institucion, fecha, url) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, cv.id, nombre.trim(), institucion.trim(), fecha, urlVal)
      .run();
    const created = await c.env.DB.prepare('SELECT * FROM certificado WHERE id = ?').bind(id).first<Certificado>();
    return ok(c, created, 201);
  } catch {
    return err(c, 'Error al agregar certificado', 500);
  }
});

// PUT /api/cv/certificado/:id
router.put('/certificado/:id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden editar su CV', 403);
  const tecnicoId = c.get('userId');
  const certId = c.req.param('id');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { nombre, institucion, fecha, url } = body;
  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) return err(c, 'nombre es requerido', 400);
  if (!institucion || typeof institucion !== 'string' || !institucion.trim()) return err(c, 'institucion es requerido', 400);
  if (typeof fecha !== 'number') return err(c, 'fecha es requerido (Unix timestamp)', 400);
  const urlVal = typeof url === 'string' ? url.trim() || null : null;
  if (urlVal && !URL_RE.test(urlVal)) return err(c, 'url debe ser una URL válida', 400);

  try {
    const cv = await c.env.DB.prepare('SELECT id FROM cv WHERE tecnico_id = ?').bind(tecnicoId).first<{ id: string }>();
    if (!cv) return err(c, 'CV no encontrado', 404);
    const cert = await c.env.DB.prepare('SELECT cv_id FROM certificado WHERE id = ?').bind(certId).first<{ cv_id: string }>();
    if (!cert || cert.cv_id !== cv.id) return err(c, 'Certificado no encontrado', 404);

    await c.env.DB
      .prepare('UPDATE certificado SET nombre = ?, institucion = ?, fecha = ?, url = ? WHERE id = ?')
      .bind(nombre.trim(), institucion.trim(), fecha, urlVal, certId)
      .run();
    const updated = await c.env.DB.prepare('SELECT * FROM certificado WHERE id = ?').bind(certId).first<Certificado>();
    return ok(c, updated);
  } catch {
    return err(c, 'Error al actualizar certificado', 500);
  }
});

// DELETE /api/cv/certificado/:id
router.delete('/certificado/:id', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden editar su CV', 403);
  const tecnicoId = c.get('userId');
  const certId = c.req.param('id');

  try {
    const cv = await c.env.DB.prepare('SELECT id FROM cv WHERE tecnico_id = ?').bind(tecnicoId).first<{ id: string }>();
    if (!cv) return err(c, 'CV no encontrado', 404);
    const cert = await c.env.DB.prepare('SELECT cv_id FROM certificado WHERE id = ?').bind(certId).first<{ cv_id: string }>();
    if (!cert || cert.cv_id !== cv.id) return err(c, 'Certificado no encontrado', 404);

    await c.env.DB.prepare('DELETE FROM certificado WHERE id = ?').bind(certId).run();
    return ok(c, { id: certId });
  } catch {
    return err(c, 'Error al eliminar certificado', 500);
  }
});

export default router;
