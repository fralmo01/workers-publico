import { Hono } from 'hono';
import type {
  HonoEnv,
  Usuario,
  PerfilEmpresa,
  PerfilTecnico,
  NivelTecnico,
  Disponibilidad,
} from '../types';
import { authMiddleware } from '../middleware/auth';
import { ok, err } from '../lib/responses';

const NIVELES: NivelTecnico[] = ['PRACTICANTE', 'EGRESADO', 'CERTIFICADO'];
const DISPONIBILIDADES: Disponibilidad[] = ['INMEDIATA', 'FECHA', 'NO_DISPONIBLE'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/;

const router = new Hono<HonoEnv>();

async function geocodificar(
  direccion: string,
): Promise<{ lat: number; lng: number; place_id: string } | null> {
  try {
    const q = encodeURIComponent(`${direccion}, Peru`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=pe`,
      { headers: { 'User-Agent': 'ProLink/1.0 (contact@prolink.pe)' } },
    );
    if (!res.ok) return null;
    const data = await res.json() as { lat: string; lon: string; place_id: number }[];
    if (!data.length) return null;
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      place_id: String(data[0].place_id),
    };
  } catch {
    return null;
  }
}

router.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const rol = c.get('rol');
  try {
    const usuario = await c.env.DB
      .prepare(
        'SELECT id, email, rol, tema, idioma, fecha_registro, email_verificado FROM usuario WHERE id = ?',
      )
      .bind(userId)
      .first<Pick<Usuario, 'id' | 'email' | 'rol' | 'tema' | 'idioma' | 'fecha_registro' | 'email_verificado'>>();

    if (!usuario) return err(c, 'Usuario no encontrado', 404);

    let perfil: PerfilEmpresa | PerfilTecnico | null = null;
    if (rol === 'EMPRESA') {
      perfil = await c.env.DB
        .prepare('SELECT * FROM perfil_empresa WHERE usuario_id = ?')
        .bind(userId)
        .first<PerfilEmpresa>();
    } else if (rol === 'TECNICO') {
      perfil = await c.env.DB
        .prepare('SELECT * FROM perfil_tecnico WHERE usuario_id = ?')
        .bind(userId)
        .first<PerfilTecnico>();
    }

    return ok(c, { ...usuario, perfil });
  } catch {
    return err(c, 'Error al obtener perfil', 500);
  }
});

router.on(['PUT', 'POST'], '/tecnico', authMiddleware, async (c) => {
  if (c.get('rol') !== 'TECNICO') return err(c, 'Acceso no autorizado', 403);
  const userId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const nombre_completo = body.nombre_completo;
  if (!nombre_completo || typeof nombre_completo !== 'string' || !nombre_completo.trim()) {
    return err(c, 'nombre_completo es requerido', 400);
  }

  const nivel = body.nivel as NivelTecnico | undefined;
  if (nivel !== undefined && !NIVELES.includes(nivel)) {
    return err(c, `nivel debe ser uno de: ${NIVELES.join(', ')}`, 400);
  }

  const disponibilidad = body.disponibilidad as Disponibilidad | undefined;
  if (disponibilidad !== undefined && !DISPONIBILIDADES.includes(disponibilidad)) {
    return err(c, `disponibilidad debe ser uno de: ${DISPONIBILIDADES.join(', ')}`, 400);
  }

  const descripcion            = typeof body.descripcion            === 'string' ? body.descripcion : null;
  const direccion              = typeof body.direccion              === 'string' ? body.direccion.trim() || null : null;
  const distrito_id            = typeof body.distrito_id            === 'string' ? body.distrito_id : null;
  const categoria_principal_id = typeof body.categoria_principal_id === 'string' ? body.categoria_principal_id : null;
  const fecha_disponible       = typeof body.fecha_disponible       === 'number' ? body.fecha_disponible : null;
  const email_profesional      = typeof body.email_profesional      === 'string' ? body.email_profesional.trim() || null : null;
  const github_url             = typeof body.github_url             === 'string' ? body.github_url.trim() || null : null;
  const linkedin_url           = typeof body.linkedin_url           === 'string' ? body.linkedin_url.trim() || null : null;
  const instagram_url          = typeof body.instagram_url          === 'string' ? body.instagram_url.trim() || null : null;
  const whatsapp               = typeof body.whatsapp               === 'string' ? body.whatsapp.trim() || null : null;
  const x_url                  = typeof body.x_url                  === 'string' ? body.x_url.trim() || null : null;

  if (email_profesional !== null && !EMAIL_RE.test(email_profesional)) {
    return err(c, 'Formato de email_profesional inválido', 400);
  }
  for (const [campo, val] of [['github_url', github_url], ['linkedin_url', linkedin_url], ['instagram_url', instagram_url], ['x_url', x_url]] as [string, string | null][]) {
    if (val !== null && !URL_RE.test(val)) {
      return err(c, `${campo} debe ser una URL válida (https://...)`, 400);
    }
  }

  // Geocodificar dirección si fue provista
  let lat: number | null = null;
  let lng: number | null = null;
  let place_id: string | null = null;
  if (direccion) {
    const geo = await geocodificar(direccion);
    if (geo) { lat = geo.lat; lng = geo.lng; place_id = geo.place_id; }
  }

  try {
    await c.env.DB
      .prepare(
        `UPDATE perfil_tecnico
         SET nombre_completo = ?, nivel = ?, disponibilidad = ?,
             descripcion = ?, direccion = ?, distrito_id = ?,
             categoria_principal_id = ?, fecha_disponible = ?, email_profesional = ?,
             github_url = ?, linkedin_url = ?, instagram_url = ?, whatsapp = ?, x_url = ?,
             lat = COALESCE(?, lat), lng = COALESCE(?, lng), place_id = COALESCE(?, place_id)
         WHERE usuario_id = ?`,
      )
      .bind(
        nombre_completo.trim(),
        nivel ?? 'PRACTICANTE',
        disponibilidad ?? 'INMEDIATA',
        descripcion, direccion, distrito_id,
        categoria_principal_id, fecha_disponible, email_profesional,
        github_url, linkedin_url, instagram_url, whatsapp, x_url,
        lat, lng, place_id,
        userId,
      )
      .run();

    const updated = await c.env.DB
      .prepare('SELECT * FROM perfil_tecnico WHERE usuario_id = ?')
      .bind(userId)
      .first<PerfilTecnico>();

    return ok(c, updated);
  } catch {
    return err(c, 'Error al actualizar perfil de técnico', 500);
  }
});

router.put('/empresa', authMiddleware, async (c) => {
  if (c.get('rol') !== 'EMPRESA') return err(c, 'Acceso no autorizado', 403);
  const userId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const razon_social = body.razon_social;
  if (!razon_social || typeof razon_social !== 'string' || !razon_social.trim()) {
    return err(c, 'razon_social es requerido', 400);
  }

  const ruc              = typeof body.ruc              === 'string' ? body.ruc : null;
  const sector           = typeof body.sector           === 'string' ? body.sector : null;
  const descripcion      = typeof body.descripcion      === 'string' ? body.descripcion : null;
  const sitio_web        = typeof body.sitio_web        === 'string' ? body.sitio_web : null;
  const direccion        = typeof body.direccion        === 'string' ? body.direccion.trim() || null : null;
  const distrito_id      = typeof body.distrito_id      === 'string' ? body.distrito_id : null;
  const email_profesional = typeof body.email_profesional === 'string' ? body.email_profesional.trim() || null : null;
  const linkedin_url     = typeof body.linkedin_url     === 'string' ? body.linkedin_url.trim() || null : null;
  const instagram_url    = typeof body.instagram_url    === 'string' ? body.instagram_url.trim() || null : null;
  const facebook_url     = typeof body.facebook_url     === 'string' ? body.facebook_url.trim() || null : null;
  const whatsapp         = typeof body.whatsapp         === 'string' ? body.whatsapp.trim() || null : null;

  if (email_profesional !== null && !EMAIL_RE.test(email_profesional)) {
    return err(c, 'Formato de email_profesional inválido', 400);
  }

  let lat: number | null = null;
  let lng: number | null = null;
  let place_id: string | null = null;
  if (direccion) {
    const geo = await geocodificar(direccion);
    if (geo) { lat = geo.lat; lng = geo.lng; place_id = geo.place_id; }
  }

  try {
    await c.env.DB
      .prepare(
        `UPDATE perfil_empresa
         SET razon_social = ?, ruc = ?, sector = ?, descripcion = ?,
             sitio_web = ?, direccion = ?, distrito_id = ?, email_profesional = ?,
             linkedin_url = ?, instagram_url = ?, facebook_url = ?, whatsapp = ?,
             lat = COALESCE(?, lat), lng = COALESCE(?, lng), place_id = COALESCE(?, place_id)
         WHERE usuario_id = ?`,
      )
      .bind(
        razon_social.trim(), ruc, sector, descripcion,
        sitio_web, direccion, distrito_id, email_profesional,
        linkedin_url, instagram_url, facebook_url, whatsapp,
        lat, lng, place_id,
        userId,
      )
      .run();

    const updated = await c.env.DB
      .prepare('SELECT * FROM perfil_empresa WHERE usuario_id = ?')
      .bind(userId)
      .first<PerfilEmpresa>();

    return ok(c, updated);
  } catch {
    return err(c, 'Error al actualizar perfil de empresa', 500);
  }
});

// Rutas públicas
router.get('/tecnico/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const usuario = await c.env.DB
      .prepare("SELECT id, rol FROM usuario WHERE id = ? AND activo = 1 AND rol = 'TECNICO'")
      .bind(id)
      .first<Pick<Usuario, 'id' | 'rol'>>();

    if (!usuario) return err(c, 'Técnico no encontrado', 404);

    const perfil = await c.env.DB
      .prepare('SELECT * FROM perfil_tecnico WHERE usuario_id = ?')
      .bind(id)
      .first<PerfilTecnico>();

    const favoritosCount = await c.env.DB
      .prepare("SELECT COUNT(*) AS total FROM favorito WHERE objetivo_id = ? AND tipo = 'TECNICO_GUARDADO'")
      .bind(id)
      .first<{ total: number }>();

    const { email_profesional, ...perfilBase } = perfil ?? ({} as PerfilTecnico);
    const perfilPublico = email_profesional
      ? { ...perfilBase, email_profesional }
      : perfilBase;

    return ok(c, {
      id: usuario.id,
      rol: usuario.rol,
      perfil: perfilPublico,
      favoritos_count: favoritosCount?.total ?? 0,
    });
  } catch {
    return err(c, 'Error al obtener perfil del técnico', 500);
  }
});

router.get('/empresa/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const usuario = await c.env.DB
      .prepare("SELECT id, rol FROM usuario WHERE id = ? AND activo = 1 AND rol = 'EMPRESA'")
      .bind(id)
      .first<Pick<Usuario, 'id' | 'rol'>>();

    if (!usuario) return err(c, 'Empresa no encontrada', 404);

    const perfil = await c.env.DB
      .prepare('SELECT * FROM perfil_empresa WHERE usuario_id = ?')
      .bind(id)
      .first<PerfilEmpresa>();

    const favoritosCount = await c.env.DB
      .prepare("SELECT COUNT(*) AS total FROM favorito WHERE objetivo_id = ? AND tipo = 'EMPRESA_GUARDADA'")
      .bind(id)
      .first<{ total: number }>();

    const { email_profesional, ...perfilBase } = perfil ?? ({} as PerfilEmpresa);
    const perfilPublico = email_profesional
      ? { ...perfilBase, email_profesional }
      : perfilBase;

    return ok(c, {
      id: usuario.id,
      rol: usuario.rol,
      perfil: perfilPublico,
      favoritos_count: favoritosCount?.total ?? 0,
    });
  } catch {
    return err(c, 'Error al obtener perfil de empresa', 500);
  }
});

export default router;
