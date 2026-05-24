import { Hono } from 'hono';
import type { HonoEnv } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ok, err } from '../lib/responses';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES  = 10 * 1024 * 1024;

const router = new Hono<HonoEnv>();

router.put('/foto', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden subir foto de perfil', 403);
  const userId = c.get('userId');

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return err(c, 'Se esperaba multipart/form-data', 400);
  }

  const file = formData.get('file') as File | null;
  if (!file) return err(c, 'Campo "file" requerido', 400);
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return err(c, `Tipo de archivo no permitido. Usa: ${ALLOWED_IMAGE_TYPES.join(', ')}`, 400);
  if (file.size > MAX_IMAGE_BYTES) return err(c, 'La imagen no puede superar 5 MB', 400);

  try {
    const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
    const key = `fotos/${userId}.${ext}`;
    const buffer = await file.arrayBuffer();

    await c.env.BUCKET.put(key, buffer, { httpMetadata: { contentType: file.type } });

    await c.env.DB
      .prepare('UPDATE perfil_tecnico SET foto_key = ? WHERE usuario_id = ?')
      .bind(key, userId)
      .run();

    return ok(c, { key });
  } catch {
    return err(c, 'Error al subir foto', 500);
  }
});

router.put('/logo', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Solo empresas pueden subir logo', 403);
  const userId = c.get('userId');

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return err(c, 'Se esperaba multipart/form-data', 400);
  }

  const file = formData.get('file') as File | null;
  if (!file) return err(c, 'Campo "file" requerido', 400);
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return err(c, `Tipo de archivo no permitido. Usa: ${ALLOWED_IMAGE_TYPES.join(', ')}`, 400);
  if (file.size > MAX_IMAGE_BYTES) return err(c, 'El logo no puede superar 5 MB', 400);

  try {
    const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
    const key = `logos/${userId}.${ext}`;
    const buffer = await file.arrayBuffer();

    await c.env.BUCKET.put(key, buffer, { httpMetadata: { contentType: file.type } });

    await c.env.DB
      .prepare('UPDATE perfil_empresa SET logo_key = ? WHERE usuario_id = ?')
      .bind(key, userId)
      .run();

    return ok(c, { key });
  } catch {
    return err(c, 'Error al subir logo', 500);
  }
});

router.put('/cv-pdf', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden subir CV en PDF', 403);
  const userId = c.get('userId');

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return err(c, 'Se esperaba multipart/form-data', 400);
  }

  const file = formData.get('file') as File | null;
  if (!file) return err(c, 'Campo "file" requerido', 400);
  if (file.type !== 'application/pdf') return err(c, 'Solo se permite PDF', 400);
  if (file.size > MAX_PDF_BYTES) return err(c, 'El PDF no puede superar 10 MB', 400);

  try {
    const key = `cvs/${userId}.pdf`;
    const buffer = await file.arrayBuffer();

    await c.env.BUCKET.put(key, buffer, { httpMetadata: { contentType: 'application/pdf' } });

    const now = Math.floor(Date.now() / 1000);
    const existing = await c.env.DB.prepare('SELECT id FROM cv WHERE tecnico_id = ?').bind(userId).first<{ id: string }>();
    if (existing) {
      await c.env.DB.prepare('UPDATE cv SET pdf_key = ?, ultima_actualizacion = ? WHERE tecnico_id = ?').bind(key, now, userId).run();
    } else {
      await c.env.DB.prepare('INSERT INTO cv (id, tecnico_id, pdf_key, ultima_actualizacion) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), userId, key, now).run();
    }

    return ok(c, { key });
  } catch {
    return err(c, 'Error al subir PDF', 500);
  }
});

async function serveR2(c: Parameters<typeof err>[0], key: string, cacheControl: string) {
  try {
    const obj = await (c.env as { BUCKET: R2Bucket }).BUCKET.get(key);
    if (!obj) return err(c, 'Archivo no encontrado', 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('Cache-Control', cacheControl);
    return new Response(obj.body, { headers });
  } catch {
    return err(c, 'Error al obtener archivo', 500);
  }
}

router.get('/fotos/:file', async (c) => {
  return serveR2(c, `fotos/${c.req.param('file')}`, 'public, max-age=86400');
});

router.get('/logos/:file', async (c) => {
  return serveR2(c, `logos/${c.req.param('file')}`, 'public, max-age=86400');
});

router.get('/cvs/:file', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const file = c.req.param('file');
  if (!file.startsWith(`${userId}.`)) return err(c, 'No tienes permiso para acceder a este archivo', 403);
  return serveR2(c, `cvs/${file}`, 'private, max-age=3600');
});

router.put('/portada/:proyectoId', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Solo técnicos pueden subir portadas', 403);
  const userId = c.get('userId');
  const proyectoId = c.req.param('proyectoId');

  const proyecto = await c.env.DB
    .prepare('SELECT tecnico_id FROM proyecto_tecnico WHERE id = ?')
    .bind(proyectoId)
    .first<{ tecnico_id: string }>();

  if (!proyecto) return err(c, 'Proyecto no encontrado', 404);
  if (proyecto.tecnico_id !== userId) return err(c, 'No tienes permiso para subir portada a este proyecto', 403);

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return err(c, 'Se esperaba multipart/form-data', 400);
  }

  const file = formData.get('file') as File | null;
  if (!file) return err(c, 'Campo "file" requerido', 400);
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return err(c, `Tipo no permitido. Usa: ${ALLOWED_IMAGE_TYPES.join(', ')}`, 400);
  if (file.size > MAX_IMAGE_BYTES) return err(c, 'La imagen no puede superar 5 MB', 400);

  try {
    const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
    const key = `portadas/${proyectoId}.${ext}`;
    const buffer = await file.arrayBuffer();
    await c.env.BUCKET.put(key, buffer, { httpMetadata: { contentType: file.type } });
    await c.env.DB
      .prepare('UPDATE proyecto_tecnico SET portada_key = ? WHERE id = ?')
      .bind(key, proyectoId)
      .run();
    return ok(c, { key });
  } catch {
    return err(c, 'Error al subir portada', 500);
  }
});

// GET /api/uploads/portadas/:file — portada de proyecto, acceso público
router.get('/portadas/:file', async (c) => {
  return serveR2(c, `portadas/${c.req.param('file')}`, 'public, max-age=86400');
});

export default router;
