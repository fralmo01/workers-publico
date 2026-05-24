PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS distrito (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    provincia     TEXT NOT NULL,
    pais          TEXT NOT NULL DEFAULT 'PE',
    lat           REAL NOT NULL,
    lng           REAL NOT NULL,
    activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_distrito_pais ON distrito(pais, activo);

CREATE TABLE IF NOT EXISTS categoria (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL UNIQUE,
    icono_key     TEXT,
    orden         INTEGER NOT NULL DEFAULT 0,
    activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))
);
CREATE TABLE IF NOT EXISTS habilidad (
    id            TEXT PRIMARY KEY,
    categoria_id  TEXT NOT NULL,
    nombre        TEXT NOT NULL,
    activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    FOREIGN KEY (categoria_id) REFERENCES categoria(id) ON DELETE RESTRICT,
    UNIQUE (categoria_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_habilidad_categoria ON habilidad(categoria_id, activo);

-- 2. USUARIOS Y PERFILES

CREATE TABLE IF NOT EXISTS usuario (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT,
    google_sub      TEXT UNIQUE,
    rol             TEXT NOT NULL CHECK (rol IN ('EMPRESA', 'TECNICO', 'ADMIN')),
    tema            TEXT NOT NULL DEFAULT 'CLARO' CHECK (tema IN ('OSCURO', 'CLARO')),
    idioma          TEXT NOT NULL DEFAULT 'ES' CHECK (idioma IN ('ES', 'EN')),
    fecha_registro  INTEGER NOT NULL,
    ultima_sesion   INTEGER,
    activo          INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    email_verificado INTEGER NOT NULL DEFAULT 0 CHECK (email_verificado IN (0, 1)),
    fecha_eliminacion INTEGER
);

CREATE INDEX IF NOT EXISTS idx_usuario_rol ON usuario(rol, activo);
CREATE INDEX IF NOT EXISTS idx_usuario_fecha_registro ON usuario(fecha_registro DESC);

CREATE TABLE IF NOT EXISTS perfil_empresa (
    usuario_id          TEXT PRIMARY KEY,
    razon_social        TEXT NOT NULL,
    ruc                 TEXT UNIQUE,
    sector              TEXT,
    descripcion         TEXT,
    logo_key            TEXT,
    direccion           TEXT,
    place_id            TEXT,
    sitio_web           TEXT,
    distrito_id         TEXT,
    lat                 REAL,
    lng                 REAL,
    calificacion_promedio REAL NOT NULL DEFAULT 0.0,
    total_calificaciones  INTEGER NOT NULL DEFAULT 0,
    total_contrataciones  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (distrito_id) REFERENCES distrito(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_empresa_distrito ON perfil_empresa(distrito_id);
CREATE INDEX IF NOT EXISTS idx_empresa_geo ON perfil_empresa(lat, lng);
CREATE INDEX IF NOT EXISTS idx_empresa_place_id ON perfil_empresa(place_id);

CREATE TABLE IF NOT EXISTS perfil_tecnico (
    usuario_id            TEXT PRIMARY KEY,
    nombre_completo       TEXT NOT NULL,
    foto_key              TEXT,
    categoria_principal_id TEXT,
    nivel                 TEXT NOT NULL DEFAULT 'PRACTICANTE'
                          CHECK (nivel IN ('PRACTICANTE', 'EGRESADO', 'CERTIFICADO')),
    descripcion           TEXT,
    disponibilidad        TEXT NOT NULL DEFAULT 'INMEDIATA'
                          CHECK (disponibilidad IN ('INMEDIATA', 'FECHA', 'NO_DISPONIBLE')),
    fecha_disponible      INTEGER,
    direccion             TEXT,
    place_id              TEXT,
    distrito_id           TEXT,
    lat                   REAL,
    lng                   REAL,
    consultas_habilitadas INTEGER NOT NULL DEFAULT 1 CHECK (consultas_habilitadas IN (0, 1)),
    calificacion_promedio REAL NOT NULL DEFAULT 0.0,
    total_calificaciones  INTEGER NOT NULL DEFAULT 0,
    total_colaboraciones  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (categoria_principal_id) REFERENCES categoria(id) ON DELETE SET NULL,
    FOREIGN KEY (distrito_id) REFERENCES distrito(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tecnico_categoria ON perfil_tecnico(categoria_principal_id, disponibilidad);
CREATE INDEX IF NOT EXISTS idx_tecnico_distrito ON perfil_tecnico(distrito_id);
CREATE INDEX IF NOT EXISTS idx_tecnico_geo ON perfil_tecnico(lat, lng);
CREATE INDEX IF NOT EXISTS idx_tecnico_disponibilidad ON perfil_tecnico(disponibilidad);
CREATE INDEX IF NOT EXISTS idx_tecnico_place_id ON perfil_tecnico(place_id);

CREATE TABLE IF NOT EXISTS tecnico_habilidad (
    tecnico_id    TEXT NOT NULL,
    habilidad_id  TEXT NOT NULL,
    PRIMARY KEY (tecnico_id, habilidad_id),
    FOREIGN KEY (tecnico_id) REFERENCES perfil_tecnico(usuario_id) ON DELETE CASCADE,
    FOREIGN KEY (habilidad_id) REFERENCES habilidad(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tecnico_habilidad_habilidad ON tecnico_habilidad(habilidad_id);

CREATE TABLE IF NOT EXISTS cv (
    id                   TEXT PRIMARY KEY,
    tecnico_id           TEXT NOT NULL UNIQUE,
    pdf_key              TEXT,
    ultima_actualizacion INTEGER NOT NULL,
    FOREIGN KEY (tecnico_id) REFERENCES perfil_tecnico(usuario_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS experiencia_cv (
    id            TEXT PRIMARY KEY,
    cv_id         TEXT NOT NULL,
    tipo          TEXT NOT NULL CHECK (tipo IN ('PROYECTO', 'EMPLEO', 'PRACTICA')),
    titulo        TEXT NOT NULL,
    descripcion   TEXT,
    fecha_inicio  INTEGER NOT NULL,
    fecha_fin     INTEGER,
    FOREIGN KEY (cv_id) REFERENCES cv(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_experiencia_cv ON experiencia_cv(cv_id, fecha_inicio DESC);

CREATE TABLE IF NOT EXISTS educacion (
    id            TEXT PRIMARY KEY,
    cv_id         TEXT NOT NULL,
    institucion   TEXT NOT NULL,
    titulo        TEXT NOT NULL,
    fecha_inicio  INTEGER NOT NULL,
    fecha_fin     INTEGER,
    FOREIGN KEY (cv_id) REFERENCES cv(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_educacion_cv ON educacion(cv_id, fecha_inicio DESC);

-- 4. CONVOCATORIAS Y COLABORACIONES

CREATE TABLE IF NOT EXISTS convocatoria (
    id                  TEXT PRIMARY KEY,
    empresa_id          TEXT NOT NULL,
    titulo              TEXT NOT NULL,
    descripcion         TEXT,
    categoria_id        TEXT NOT NULL,
    plazas_disponibles  INTEGER NOT NULL DEFAULT 1,
    plazas_ocupadas     INTEGER NOT NULL DEFAULT 0,
    estado              TEXT NOT NULL DEFAULT 'ABIERTA'
                        CHECK (estado IN ('ABIERTA', 'EN_SELECCION', 'CERRADA')),
    fecha_inicio        INTEGER NOT NULL,
    fecha_fin           INTEGER,
    fecha_creacion      INTEGER NOT NULL,
    FOREIGN KEY (empresa_id) REFERENCES perfil_empresa(usuario_id) ON DELETE CASCADE,
    FOREIGN KEY (categoria_id) REFERENCES categoria(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_convocatoria_empresa ON convocatoria(empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_convocatoria_estado ON convocatoria(estado, fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS idx_convocatoria_categoria ON convocatoria(categoria_id, estado);

CREATE TABLE IF NOT EXISTS colaboracion (
    id                TEXT PRIMARY KEY,
    convocatoria_id   TEXT,
    tecnico_id        TEXT NOT NULL,
    empresa_id        TEXT NOT NULL,
    estado            TEXT NOT NULL DEFAULT 'EN_CURSO'
                      CHECK (estado IN ('EN_CURSO', 'FINALIZADA', 'CANCELADA')),
    fecha_inicio      INTEGER NOT NULL,
    fecha_fin         INTEGER,
    fecha_creacion    INTEGER NOT NULL,
    FOREIGN KEY (convocatoria_id) REFERENCES convocatoria(id) ON DELETE SET NULL,
    FOREIGN KEY (tecnico_id) REFERENCES perfil_tecnico(usuario_id) ON DELETE CASCADE,
    FOREIGN KEY (empresa_id) REFERENCES perfil_empresa(usuario_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_colaboracion_tecnico ON colaboracion(tecnico_id, estado);
CREATE INDEX IF NOT EXISTS idx_colaboracion_empresa ON colaboracion(empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_colaboracion_convocatoria ON colaboracion(convocatoria_id);

-- 5. CALIFICACIONES Y RESEÑAS

CREATE TABLE IF NOT EXISTS calificacion (
    id              TEXT PRIMARY KEY,
    colaboracion_id TEXT NOT NULL,
    autor_id        TEXT NOT NULL,
    destinatario_id TEXT NOT NULL,
    puntaje         REAL NOT NULL CHECK (puntaje >= 1.0 AND puntaje <= 5.0),
    comentario      TEXT,
    fecha           INTEGER NOT NULL,
    FOREIGN KEY (colaboracion_id) REFERENCES colaboracion(id) ON DELETE CASCADE,
    FOREIGN KEY (autor_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (destinatario_id) REFERENCES usuario(id) ON DELETE CASCADE,
    UNIQUE (colaboracion_id, autor_id)
);

CREATE INDEX IF NOT EXISTS idx_calificacion_destinatario ON calificacion(destinatario_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_calificacion_colaboracion ON calificacion(colaboracion_id);

-- Reseña abierta
CREATE TABLE IF NOT EXISTS resena (
    id              TEXT PRIMARY KEY,
    autor_id        TEXT NOT NULL,
    destinatario_id TEXT NOT NULL,
    contenido       TEXT NOT NULL,
    respuesta       TEXT,
    fecha           INTEGER NOT NULL,
    fecha_respuesta INTEGER,
    FOREIGN KEY (autor_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (destinatario_id) REFERENCES usuario(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resena_destinatario ON resena(destinatario_id, fecha DESC);

-- 6. FAVORITOS Y LISTA BLANCA

-- Empresa marca técnicos como favoritos; técnico marca empresas como favoritas (lista blanca).
CREATE TABLE IF NOT EXISTS favorito (
    id            TEXT PRIMARY KEY,
    usuario_id    TEXT NOT NULL,               -- quien guarda
    objetivo_id   TEXT NOT NULL,               -- a quién guarda
    tipo          TEXT NOT NULL CHECK (tipo IN ('TECNICO_GUARDADO', 'EMPRESA_GUARDADA')),
    fecha         INTEGER NOT NULL,
    FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (objetivo_id) REFERENCES usuario(id) ON DELETE CASCADE,
    UNIQUE (usuario_id, objetivo_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_favorito_usuario ON favorito(usuario_id, tipo);
CREATE INDEX IF NOT EXISTS idx_favorito_objetivo ON favorito(objetivo_id, tipo);

-- 7. CONSTANCIAS DIGITALES E INSIGNIAS

CREATE TABLE IF NOT EXISTS constancia (
    id              TEXT PRIMARY KEY,
    colaboracion_id TEXT NOT NULL,
    tecnico_id      TEXT NOT NULL,
    empresa_id      TEXT NOT NULL,
    descripcion     TEXT,
    pdf_key         TEXT,
    fecha_emision   INTEGER NOT NULL,
    FOREIGN KEY (colaboracion_id) REFERENCES colaboracion(id) ON DELETE CASCADE,
    FOREIGN KEY (tecnico_id) REFERENCES perfil_tecnico(usuario_id) ON DELETE CASCADE,
    FOREIGN KEY (empresa_id) REFERENCES perfil_empresa(usuario_id) ON DELETE CASCADE,
    UNIQUE (colaboracion_id)
);

CREATE INDEX IF NOT EXISTS idx_constancia_tecnico ON constancia(tecnico_id, fecha_emision DESC);

CREATE TABLE IF NOT EXISTS insignia (
    id            TEXT PRIMARY KEY,
    codigo        TEXT NOT NULL UNIQUE,
    nombre        TEXT NOT NULL,
    descripcion   TEXT,
    icono_key     TEXT,
    activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))
);

CREATE TABLE IF NOT EXISTS tecnico_insignia (
    tecnico_id    TEXT NOT NULL,
    insignia_id   TEXT NOT NULL,
    fecha         INTEGER NOT NULL,
    PRIMARY KEY (tecnico_id, insignia_id),
    FOREIGN KEY (tecnico_id) REFERENCES perfil_tecnico(usuario_id) ON DELETE CASCADE,
    FOREIGN KEY (insignia_id) REFERENCES insignia(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mensaje (
    id              TEXT PRIMARY KEY,
    remitente_id    TEXT NOT NULL,
    destinatario_id TEXT NOT NULL,
    contenido       TEXT NOT NULL,
    leido           INTEGER NOT NULL DEFAULT 0 CHECK (leido IN (0, 1)),
    fecha           INTEGER NOT NULL,
    FOREIGN KEY (remitente_id) REFERENCES usuario(id) ON DELETE CASCADE,
    FOREIGN KEY (destinatario_id) REFERENCES usuario(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mensaje_destinatario ON mensaje(destinatario_id, leido, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_mensaje_conversacion ON mensaje(remitente_id, destinatario_id, fecha DESC);

CREATE TABLE IF NOT EXISTS notificacion (
    id            TEXT PRIMARY KEY,
    usuario_id    TEXT NOT NULL,
    tipo          TEXT NOT NULL CHECK (tipo IN (
        'NUEVA_CONVOCATORIA',
        'CALIFICACION',
        'MENSAJE',
        'RECOMENDADO',
        'CONSTANCIA',
        'INSIGNIA',
        'COLABORACION_INICIADA',
        'COLABORACION_FINALIZADA'
    )),
    contenido     TEXT NOT NULL,
    referencia_id TEXT,
    leido         INTEGER NOT NULL DEFAULT 0 CHECK (leido IN (0, 1)),
    fecha         INTEGER NOT NULL,
    FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notificacion_usuario ON notificacion(usuario_id, leido, fecha DESC);

-- 10. CONSULTAS DIRECTAS

CREATE TABLE IF NOT EXISTS consulta (
    id            TEXT PRIMARY KEY,
    empresa_id    TEXT NOT NULL,
    tecnico_id    TEXT NOT NULL,
    asunto        TEXT NOT NULL,
    contenido     TEXT NOT NULL,
    estado        TEXT NOT NULL DEFAULT 'PENDIENTE'
                  CHECK (estado IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'EXPIRADA')),
    fecha         INTEGER NOT NULL,
    fecha_respuesta INTEGER,
    FOREIGN KEY (empresa_id) REFERENCES perfil_empresa(usuario_id) ON DELETE CASCADE,
    FOREIGN KEY (tecnico_id) REFERENCES perfil_tecnico(usuario_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_consulta_tecnico ON consulta(tecnico_id, estado, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_consulta_empresa ON consulta(empresa_id, fecha DESC);

-- 11. RANKING

CREATE TABLE IF NOT EXISTS ranking_tecnico (
    tecnico_id            TEXT PRIMARY KEY,
    categoria_id          TEXT,
    distrito_id           TEXT,
    lat                   REAL,
    lng                   REAL,
    disponible            INTEGER NOT NULL DEFAULT 1 CHECK (disponible IN (0, 1)),

    score_calificacion    REAL NOT NULL DEFAULT 0.0,
    score_experiencia     REAL NOT NULL DEFAULT 0.0,
    score_favoritos       REAL NOT NULL DEFAULT 0.0,
    boost_nuevo           REAL NOT NULL DEFAULT 0.0,
    boost_recomendado     REAL NOT NULL DEFAULT 0.0,

    score_final           REAL NOT NULL DEFAULT 0.0,

    ultima_actualizacion  INTEGER NOT NULL,
    FOREIGN KEY (tecnico_id) REFERENCES perfil_tecnico(usuario_id) ON DELETE CASCADE,
    FOREIGN KEY (categoria_id) REFERENCES categoria(id) ON DELETE SET NULL,
    FOREIGN KEY (distrito_id) REFERENCES distrito(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ranking_busqueda ON ranking_tecnico(categoria_id, disponible, score_final DESC);
CREATE INDEX IF NOT EXISTS idx_ranking_distrito ON ranking_tecnico(distrito_id, disponible, score_final DESC);
CREATE INDEX IF NOT EXISTS idx_ranking_geo ON ranking_tecnico(lat, lng, disponible);
CREATE INDEX IF NOT EXISTS idx_ranking_global ON ranking_tecnico(disponible, score_final DESC);

-- 12. MARCADO "RECOMENDADO POR OTRA EMPRESA"
CREATE TABLE IF NOT EXISTS recomendacion_empresa (
    empresa_id  TEXT NOT NULL,
    tecnico_id  TEXT NOT NULL,
    fecha       INTEGER NOT NULL,
    PRIMARY KEY (empresa_id, tecnico_id),
    FOREIGN KEY (empresa_id) REFERENCES perfil_empresa(usuario_id) ON DELETE CASCADE,
    FOREIGN KEY (tecnico_id) REFERENCES perfil_tecnico(usuario_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recomendacion_tecnico ON recomendacion_empresa(tecnico_id);

CREATE TABLE IF NOT EXISTS sesion (
    id              TEXT PRIMARY KEY,
    usuario_id      TEXT NOT NULL,
    user_agent      TEXT,
    ip              TEXT,
    plataforma      TEXT CHECK (plataforma IN ('WEB', 'ANDROID', 'IOS')),
    fecha_creacion  INTEGER NOT NULL,
    fecha_expiracion INTEGER NOT NULL,
    revocada        INTEGER NOT NULL DEFAULT 0 CHECK (revocada IN (0, 1)),
    FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sesion_usuario ON sesion(usuario_id, revocada);
CREATE INDEX IF NOT EXISTS idx_sesion_expiracion ON sesion(fecha_expiracion);


-- DATOS — Catálogos base
INSERT INTO categoria (id, nombre, orden) VALUES
  ('cat_electricidad',  'Electricidad',           1),
  ('cat_sistemas',      'Sistemas e Informática', 2),
  ('cat_mecanica',      'Mecánica',               3),
  ('cat_administracion','Administración',         4),
  ('cat_construccion',  'Construcción',           5),
  ('cat_diseno',        'Diseño',                 6),
  ('cat_contabilidad',  'Contabilidad',           7),
  ('cat_marketing',     'Marketing y Ventas',     8),
  ('cat_logistica',     'Logística',              9),
  ('cat_gastronomia',   'Gastronomía',           10);

INSERT INTO habilidad (id, categoria_id, nombre) VALUES
  ('hab_inst_domiciliaria', 'cat_electricidad', 'Instalaciones domiciliarias'),
  ('hab_tableros',          'cat_electricidad', 'Tableros eléctricos'),
  ('hab_motores',           'cat_electricidad', 'Motores y bobinado'),
  ('hab_automatizacion',    'cat_electricidad', 'Automatización industrial');

INSERT INTO habilidad (id, categoria_id, nombre) VALUES
  ('hab_soporte_tecnico', 'cat_sistemas', 'Soporte técnico'),
  ('hab_redes',           'cat_sistemas', 'Redes y cableado'),
  ('hab_desarrollo_web',  'cat_sistemas', 'Desarrollo web'),
  ('hab_desarrollo_movil','cat_sistemas', 'Desarrollo móvil'),
  ('hab_bases_datos',     'cat_sistemas', 'Bases de datos'),
  ('hab_ciberseguridad',  'cat_sistemas', 'Ciberseguridad');

INSERT INTO habilidad (id, categoria_id, nombre) VALUES
  ('hab_mec_automotriz', 'cat_mecanica', 'Mecánica automotriz'),
  ('hab_soldadura',      'cat_mecanica', 'Soldadura'),
  ('hab_tornero',        'cat_mecanica', 'Tornería'),
  ('hab_mec_industrial', 'cat_mecanica', 'Mecánica industrial');

INSERT INTO habilidad (id, categoria_id, nombre) VALUES
  ('hab_secretariado',   'cat_administracion', 'Secretariado'),
  ('hab_rrhh',           'cat_administracion', 'Recursos humanos'),
  ('hab_atencion_publico','cat_administracion','Atención al público'),
  ('hab_office',         'cat_administracion', 'Microsoft Office');

INSERT INTO distrito (id, nombre, provincia, pais, lat, lng) VALUES
  ('dist_lima_cercado',   'Lima Cercado',     'Lima', 'PE', -12.0464, -77.0428),
  ('dist_miraflores',     'Miraflores',       'Lima', 'PE', -12.1196, -77.0287),
  ('dist_san_isidro',     'San Isidro',       'Lima', 'PE', -12.0976, -77.0365),
  ('dist_surco',          'Santiago de Surco','Lima', 'PE', -12.1391, -76.9897),
  ('dist_la_molina',      'La Molina',        'Lima', 'PE', -12.0867, -76.9484),
  ('dist_san_borja',      'San Borja',        'Lima', 'PE', -12.1097, -76.9985),
  ('dist_san_miguel',     'San Miguel',       'Lima', 'PE', -12.0776, -77.0826),
  ('dist_pueblo_libre',   'Pueblo Libre',     'Lima', 'PE', -12.0764, -77.0631),
  ('dist_magdalena',      'Magdalena del Mar','Lima', 'PE', -12.0921, -77.0721),
  ('dist_jesus_maria',    'Jesús María',      'Lima', 'PE', -12.0732, -77.0496),
  ('dist_lince',          'Lince',            'Lima', 'PE', -12.0853, -77.0353),
  ('dist_la_victoria',    'La Victoria',      'Lima', 'PE', -12.0691, -77.0148),
  ('dist_san_juan_lurigancho','San Juan de Lurigancho','Lima','PE', -12.0156, -77.0044),
  ('dist_san_juan_miraflores','San Juan de Miraflores','Lima','PE', -12.1574, -76.9690),
  ('dist_villa_salvador', 'Villa El Salvador','Lima', 'PE', -12.2154, -76.9356),
  ('dist_villa_maria',    'Villa María del Triunfo','Lima','PE', -12.1640, -76.9359),
  ('dist_comas',          'Comas',            'Lima', 'PE', -11.9425, -77.0500),
  ('dist_los_olivos',     'Los Olivos',       'Lima', 'PE', -11.9921, -77.0696),
  ('dist_san_martin',     'San Martín de Porres','Lima','PE', -12.0066, -77.0844),
  ('dist_independencia',  'Independencia',    'Lima', 'PE', -11.9885, -77.0530),
  ('dist_callao',         'Callao',           'Callao','PE',-12.0566, -77.1181),
  ('dist_bellavista',     'Bellavista',       'Callao','PE',-12.0613, -77.1148);

INSERT INTO insignia (id, codigo, nombre, descripcion) VALUES
  ('ins_colab_1',   'COLAB_1',   'Primera colaboración', 'Completaste tu primera colaboración en la plataforma'),
  ('ins_colab_5',   'COLAB_5',   '5 colaboraciones',     'Has completado 5 colaboraciones'),
  ('ins_colab_10',  'COLAB_10',  '10 colaboraciones',    'Has completado 10 colaboraciones'),
  ('ins_colab_25',  'COLAB_25',  '25 colaboraciones',    'Has completado 25 colaboraciones'),
  ('ins_rating_45', 'RATING_45', 'Calificación 4.5+',    'Mantienes una calificación promedio de 4.5 o más'),
  ('ins_rating_48', 'RATING_48', 'Calificación 4.8+',    'Mantienes una calificación promedio de 4.8 o más'),
  ('ins_recomendado_5','RECOMENDADO_5','Recomendado 5 veces','5 empresas te han marcado como recomendado'),
  ('ins_perfil_completo','PERFIL_COMPLETO','Perfil completo','CV, foto, habilidades y disponibilidad configurados');
