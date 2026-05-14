// Actualiza o crea la fila en ranking_tecnico para un técnico dado.
// Llamar tras: calificación nueva, favorito nuevo/eliminado, perfil actualizado.
export async function syncRankingTecnico(db: D1Database, tecnicoId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const dia30 = now - 30 * 24 * 3600;

  const [perfilRow, favRow, cvRow, recRow, regRow] = await Promise.all([
    db.prepare(
      `SELECT calificacion_promedio, total_calificaciones, disponibilidad, categoria_principal_id, distrito_id, lat, lng
       FROM perfil_tecnico WHERE usuario_id = ?`,
    ).bind(tecnicoId).first<{
      calificacion_promedio: number;
      total_calificaciones: number;
      disponibilidad: string;
      categoria_principal_id: string | null;
      distrito_id: string | null;
      lat: number | null;
      lng: number | null;
    }>(),
    db.prepare("SELECT COUNT(*) AS n FROM favorito WHERE objetivo_id = ? AND tipo = 'TECNICO_GUARDADO'").bind(tecnicoId).first<{ n: number }>(),
    db.prepare('SELECT id FROM cv WHERE tecnico_id = ?').bind(tecnicoId).first<{ id: string } | null>(),
    db.prepare('SELECT COUNT(*) AS n FROM recomendacion_empresa WHERE tecnico_id = ?').bind(tecnicoId).first<{ n: number }>(),
    db.prepare('SELECT fecha_registro FROM usuario WHERE id = ?').bind(tecnicoId).first<{ fecha_registro: number }>(),
  ]);

  if (!perfilRow) return;

  const disponible = perfilRow.disponibilidad !== 'NO_DISPONIBLE' ? 1 : 0;

  // score_calificacion: 0-1 normalizado sobre 5
  const scoreCalif = Math.min(perfilRow.calificacion_promedio / 5, 1);

  // score_experiencia: basado en si tiene CV con entradas
  let scoreExp = 0;
  if (cvRow?.id) {
    const cntRes = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM experiencia_cv WHERE cv_id = ?) + (SELECT COUNT(*) FROM educacion WHERE cv_id = ?) AS total`,
    ).bind(cvRow.id, cvRow.id).first<{ total: number }>();
    scoreExp = Math.min((cntRes?.total ?? 0) / 5, 1); // máx 5 entradas = score 1.0
  }

  // score_favoritos: normalizado (cap en 20)
  const scoreFav = Math.min((favRow?.n ?? 0) / 20, 1);

  // boost_nuevo: 1.0 si se registró en los últimos 30 días
  const boostNuevo = (regRow?.fecha_registro ?? 0) >= dia30 ? 1.0 : 0.0;

  // boost_recomendado: 1.0 si al menos una empresa lo recomendó
  const boostRec = (recRow?.n ?? 0) > 0 ? 1.0 : 0.0;

  // score_final ponderado
  const scoreFinal =
    scoreCalif * 0.4 +
    scoreExp   * 0.2 +
    scoreFav   * 0.2 +
    boostNuevo * 0.1 +
    boostRec   * 0.1;

  await db.prepare(
    `INSERT INTO ranking_tecnico
       (tecnico_id, categoria_id, distrito_id, lat, lng, disponible,
        score_calificacion, score_experiencia, score_favoritos,
        boost_nuevo, boost_recomendado, score_final, ultima_actualizacion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tecnico_id) DO UPDATE SET
       categoria_id          = excluded.categoria_id,
       distrito_id           = excluded.distrito_id,
       lat                   = excluded.lat,
       lng                   = excluded.lng,
       disponible            = excluded.disponible,
       score_calificacion    = excluded.score_calificacion,
       score_experiencia     = excluded.score_experiencia,
       score_favoritos       = excluded.score_favoritos,
       boost_nuevo           = excluded.boost_nuevo,
       boost_recomendado     = excluded.boost_recomendado,
       score_final           = excluded.score_final,
       ultima_actualizacion  = excluded.ultima_actualizacion`,
  ).bind(
    tecnicoId,
    perfilRow.categoria_principal_id,
    perfilRow.distrito_id,
    perfilRow.lat,
    perfilRow.lng,
    disponible,
    scoreCalif,
    scoreExp,
    scoreFav,
    boostNuevo,
    boostRec,
    scoreFinal,
    now,
  ).run();
}
