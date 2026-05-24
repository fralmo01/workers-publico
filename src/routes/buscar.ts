import { Hono } from 'hono';
import type { HonoEnv, NivelTecnico, Disponibilidad, EstadoConvocatoria } from '../types';
import { ok, err } from '../lib/responses';

const NIVELES: NivelTecnico[] = ['PRACTICANTE', 'EGRESADO', 'CERTIFICADO'];
const DISPONIBILIDADES: Disponibilidad[] = ['INMEDIATA', 'FECHA', 'NO_DISPONIBLE'];
const ESTADOS_CONV: EstadoConvocatoria[] = ['ABIERTA', 'EN_SELECCION', 'CERRADA'];
const ORDENES_TECNICOS = ['calificacion', 'recientes', 'colaboraciones', 'ranking'] as const;
const ORDENES_CONV = ['recientes', 'plazas'] as const;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const router = new Hono<HonoEnv>();

router.get('/tecnicos', async (c) => {
  const q = c.req.query.bind(c.req);

  const rawLimit = parseInt(q('limit') ?? '', 10);
  const rawOffset = parseInt(q('offset') ?? '', 10);
  const limit = Number.isNaN(rawLimit) ? DEFAULT_LIMIT : Math.min(Math.max(rawLimit, 1), MAX_LIMIT);
  const offset = Number.isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

  const categoria = q('categoria') ?? null;
  const nivelParam = q('nivel') ?? null;
  const dispParam = q('disponibilidad') ?? null;
  const distrito = q('distrito') ?? null;
  const calMinParam = q('calificacion_min') ?? null;
  const habilidadesParam = q('habilidades') ?? null;
  const orden = (q('orden') ?? 'calificacion') as typeof ORDENES_TECNICOS[number];

  if (nivelParam && !NIVELES.includes(nivelParam as NivelTecnico)) {
    return err(c, `nivel debe ser uno de: ${NIVELES.join(', ')}`, 400);
  }
  if (dispParam && !DISPONIBILIDADES.includes(dispParam as Disponibilidad)) {
    return err(c, `disponibilidad debe ser uno de: ${DISPONIBILIDADES.join(', ')}`, 400);
  }
  if (!ORDENES_TECNICOS.includes(orden as typeof ORDENES_TECNICOS[number])) {
    return err(c, `orden debe ser uno de: ${ORDENES_TECNICOS.join(', ')}`, 400);
  }

  const calMin = calMinParam !== null ? parseFloat(calMinParam) : null;
  if (calMin !== null && (Number.isNaN(calMin) || calMin < 0 || calMin > 5)) {
    return err(c, 'calificacion_min debe ser un número entre 0 y 5', 400);
  }

  const habilidades = habilidadesParam
    ? habilidadesParam.split(',').map((h) => h.trim()).filter(Boolean)
    : [];

  const latParam  = q('lat')      ?? null;
  const lngParam  = q('lng')      ?? null;
  const radioParam = q('radio_km') ?? null;
  const latRef  = latParam  !== null ? parseFloat(latParam)  : null;
  const lngRef  = lngParam  !== null ? parseFloat(lngParam)  : null;
  const radioKm = radioParam !== null ? parseFloat(radioParam) : null;
  const usarDistancia = latRef !== null && lngRef !== null && radioKm !== null
    && !Number.isNaN(latRef) && !Number.isNaN(lngRef) && !Number.isNaN(radioKm) && radioKm > 0;

  try {
    const conditions: string[] = ['u.activo = 1'];
    const bindings: (string | number)[] = [];

    if (categoria) {
      conditions.push('pt.categoria_principal_id = ?');
      bindings.push(categoria);
    }
    if (nivelParam) {
      conditions.push('pt.nivel = ?');
      bindings.push(nivelParam);
    }
    if (dispParam) {
      conditions.push('pt.disponibilidad = ?');
      bindings.push(dispParam);
    }
    if (distrito) {
      conditions.push('pt.distrito_id = ?');
      bindings.push(distrito);
    }
    if (calMin !== null) {
      conditions.push('pt.calificacion_promedio >= ?');
      bindings.push(calMin);
    }

    if (habilidades.length > 0) {
      const placeholders = habilidades.map(() => '?').join(', ');
      conditions.push(
        `pt.usuario_id IN (
          SELECT tecnico_id FROM tecnico_habilidad
          WHERE habilidad_id IN (${placeholders})
          GROUP BY tecnico_id
          HAVING COUNT(DISTINCT habilidad_id) = ${habilidades.length}
        )`,
      );
      bindings.push(...habilidades);
    }

    if (usarDistancia) {
      const latDelta = radioKm! / 111;
      const lngDelta = radioKm! / (111 * Math.cos((latRef! * Math.PI) / 180));
      conditions.push('pt.lat IS NOT NULL AND pt.lng IS NOT NULL');
      conditions.push('pt.lat BETWEEN ? AND ?');
      bindings.push(latRef! - latDelta, latRef! + latDelta);
      conditions.push('pt.lng BETWEEN ? AND ?');
      bindings.push(lngRef! - lngDelta, lngRef! + lngDelta);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const usarRanking = orden === 'ranking';
    const orderBy =
      orden === 'recientes'
        ? 'u.fecha_registro DESC'
        : orden === 'colaboraciones'
          ? 'pt.total_colaboraciones DESC'
          : usarRanking
            ? 'COALESCE(rt.score_final, 0) DESC'
            : 'pt.calificacion_promedio DESC';

    const rankingJoin = usarRanking ? 'LEFT JOIN ranking_tecnico rt ON rt.tecnico_id = pt.usuario_id' : '';

    const dataSQL = `
      SELECT
        pt.usuario_id,
        pt.nombre_completo,
        pt.foto_key,
        pt.categoria_principal_id,
        pt.nivel,
        pt.disponibilidad,
        pt.distrito_id,
        pt.lat,
        pt.lng,
        pt.calificacion_promedio,
        pt.total_calificaciones,
        pt.total_colaboraciones,
        pt.github_url,
        pt.linkedin_url,
        pt.instagram_url,
        pt.whatsapp,
        pt.x_url,
        CASE WHEN pt.email_profesional IS NOT NULL THEN pt.email_profesional ELSE NULL END AS email_profesional,
        (SELECT COUNT(*) FROM favorito WHERE objetivo_id = pt.usuario_id AND tipo = 'TECNICO_GUARDADO') AS favoritos_count
        ${usarRanking ? ', COALESCE(rt.score_final, 0) AS score_final' : ''}
      FROM perfil_tecnico pt
      INNER JOIN usuario u ON u.id = pt.usuario_id
      ${rankingJoin}
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const countSQL = `
      SELECT COUNT(*) AS total
      FROM perfil_tecnico pt
      INNER JOIN usuario u ON u.id = pt.usuario_id
      ${rankingJoin}
      ${where}
    `;

    const [dataResult, countResult] = await Promise.all([
      c.env.DB.prepare(dataSQL).bind(...bindings, limit, offset).all<Record<string, unknown>>(),
      c.env.DB.prepare(countSQL).bind(...bindings).first<{ total: number }>(),
    ]);

    return ok(c, {
      items: dataResult.results,
      total: countResult?.total ?? 0,
      limit,
      offset,
    });
  } catch {
    return err(c, 'Error al buscar técnicos', 500);
  }
});

router.get('/convocatorias', async (c) => {
  const q = c.req.query.bind(c.req);

  const rawLimit = parseInt(q('limit') ?? '', 10);
  const rawOffset = parseInt(q('offset') ?? '', 10);
  const limit = Number.isNaN(rawLimit) ? DEFAULT_LIMIT : Math.min(Math.max(rawLimit, 1), MAX_LIMIT);
  const offset = Number.isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

  const categoria = q('categoria') ?? null;
  const distrito = q('distrito') ?? null;
  const estadoParam = q('estado') ?? 'ABIERTA';
  const orden = q('orden') ?? 'recientes';

  if (!ESTADOS_CONV.includes(estadoParam as EstadoConvocatoria)) {
    return err(c, `estado debe ser uno de: ${ESTADOS_CONV.join(', ')}`, 400);
  }
  if (!ORDENES_CONV.includes(orden as typeof ORDENES_CONV[number])) {
    return err(c, `orden debe ser uno de: ${ORDENES_CONV.join(', ')}`, 400);
  }

  const latParam2   = c.req.query('lat')      ?? null;
  const lngParam2   = c.req.query('lng')      ?? null;
  const radioParam2 = c.req.query('radio_km') ?? null;
  const latRef2   = latParam2   !== null ? parseFloat(latParam2)   : null;
  const lngRef2   = lngParam2   !== null ? parseFloat(lngParam2)   : null;
  const radioKm2  = radioParam2 !== null ? parseFloat(radioParam2) : null;
  const usarDistancia2 = latRef2 !== null && lngRef2 !== null && radioKm2 !== null
    && !Number.isNaN(latRef2) && !Number.isNaN(lngRef2) && !Number.isNaN(radioKm2) && radioKm2 > 0;

  try {
    const conditions: string[] = ['c.estado = ?', 'u_emp.activo = 1'];
    const bindings: (string | number)[] = [estadoParam];

    if (categoria) {
      conditions.push('c.categoria_id = ?');
      bindings.push(categoria);
    }
    if (distrito) {
      conditions.push('pe.distrito_id = ?');
      bindings.push(distrito);
    }
    if (usarDistancia2) {
      const latDelta = radioKm2! / 111;
      const lngDelta = radioKm2! / (111 * Math.cos((latRef2! * Math.PI) / 180));
      conditions.push('pe.lat IS NOT NULL AND pe.lng IS NOT NULL');
      conditions.push('pe.lat BETWEEN ? AND ?');
      bindings.push(latRef2! - latDelta, latRef2! + latDelta);
      conditions.push('pe.lng BETWEEN ? AND ?');
      bindings.push(lngRef2! - lngDelta, lngRef2! + lngDelta);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const orderBy = orden === 'plazas' ? '(c.plazas_disponibles - c.plazas_ocupadas) DESC' : 'c.fecha_creacion DESC';

    const dataSQL = `
      SELECT c.*,
             pe.razon_social, pe.logo_key, pe.descripcion AS empresa_descripcion,
             pe.distrito_id AS empresa_distrito_id,
             pe.lat AS empresa_lat, pe.lng AS empresa_lng, pe.direccion AS empresa_direccion,
             pe.usuario_id AS empresa_usuario_id
      FROM convocatoria c
      INNER JOIN perfil_empresa pe ON pe.usuario_id = c.empresa_id
      INNER JOIN usuario u_emp ON u_emp.id = c.empresa_id
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const countSQL = `
      SELECT COUNT(*) AS total
      FROM convocatoria c
      INNER JOIN perfil_empresa pe ON pe.usuario_id = c.empresa_id
      INNER JOIN usuario u_emp ON u_emp.id = c.empresa_id
      ${where}
    `;

    const [dataResult, countResult] = await Promise.all([
      c.env.DB.prepare(dataSQL).bind(...bindings, limit, offset).all<Record<string, unknown>>(),
      c.env.DB.prepare(countSQL).bind(...bindings).first<{ total: number }>(),
    ]);

    return ok(c, {
      items: dataResult.results,
      total: countResult?.total ?? 0,
      limit,
      offset,
    });
  } catch {
    return err(c, 'Error al buscar convocatorias', 500);
  }
});

export default router;
