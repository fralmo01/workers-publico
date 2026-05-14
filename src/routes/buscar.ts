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

// GET /api/buscar/tecnicos
// Búsqueda pública de técnicos con filtros acumulativos.
// habilidades: AND lógico — el técnico debe tener TODAS las habilidades listadas (separadas por coma).
// TODO Fase 5: reemplazar ORDER BY calificacion_promedio por ranking_tecnico.score_final
router.get('/tecnicos', async (c) => {
  const q = c.req.query.bind(c.req);

  // Parsear y validar paginación
  const rawLimit = parseInt(q('limit') ?? '', 10);
  const rawOffset = parseInt(q('offset') ?? '', 10);
  const limit = Number.isNaN(rawLimit) ? DEFAULT_LIMIT : Math.min(Math.max(rawLimit, 1), MAX_LIMIT);
  const offset = Number.isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);

  // Filtros opcionales
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

  // Filtro de distancia (bounding box sobre lat/lng del técnico)
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

    // Filtro de habilidades: AND lógico usando subquery con HAVING COUNT
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

    // Bounding box distance filter (avoids trig functions not available in D1)
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
            : 'pt.calificacion_promedio DESC'; // default: calificacion

    const rankingJoin = usarRanking ? 'LEFT JOIN ranking_tecnico rt ON rt.tecnico_id = pt.usuario_id' : '';

    // Query de datos (sin email de login; email_profesional solo si no es null)
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

    // Query de total (para paginación)
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

// GET /api/buscar/convocatorias
// Búsqueda pública de convocatorias con filtros.
// Filtro distrito: aplica sobre la ubicación de la empresa publicante.
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

  try {
    const conditions: string[] = ['c.estado = ?'];
    const bindings: (string | number)[] = [estadoParam];

    if (categoria) {
      conditions.push('c.categoria_id = ?');
      bindings.push(categoria);
    }
    if (distrito) {
      // Filtrar por distrito de la empresa dueña de la convocatoria
      conditions.push('pe.distrito_id = ?');
      bindings.push(distrito);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const orderBy = orden === 'plazas' ? '(c.plazas_disponibles - c.plazas_ocupadas) DESC' : 'c.fecha_creacion DESC';

    const join = distrito ? 'INNER JOIN perfil_empresa pe ON pe.usuario_id = c.empresa_id' : '';

    const dataSQL = `
      SELECT c.*
      FROM convocatoria c
      ${join}
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const countSQL = `
      SELECT COUNT(*) AS total
      FROM convocatoria c
      ${join}
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
