// Tipos derivados de db/modelo.sql — NO editar a mano los enums, deben coincidir con los CHECK del schema

export type Rol = 'EMPRESA' | 'TECNICO' | 'ADMIN';
export type Tema = 'OSCURO' | 'CLARO';
export type Idioma = 'ES' | 'EN';
export type Plataforma = 'WEB' | 'ANDROID' | 'IOS';
export type NivelTecnico = 'PRACTICANTE' | 'EGRESADO' | 'CERTIFICADO';
export type Disponibilidad = 'INMEDIATA' | 'FECHA' | 'NO_DISPONIBLE';

export interface Usuario {
  id: string;
  email: string;
  password_hash: string | null;
  google_sub: string | null;
  rol: Rol;
  tema: Tema;
  idioma: Idioma;
  fecha_registro: number;
  ultima_sesion: number | null;
  activo: 0 | 1;
  email_verificado: 0 | 1;
}

export interface PerfilEmpresa {
  usuario_id: string;
  razon_social: string;
  ruc: string | null;
  sector: string | null;
  descripcion: string | null;
  logo_key: string | null;
  direccion: string | null;
  place_id: string | null;
  sitio_web: string | null;
  distrito_id: string | null;
  lat: number | null;
  lng: number | null;
  calificacion_promedio: number;
  total_calificaciones: number;
  total_contrataciones: number;
  email_profesional: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  whatsapp: string | null;
}

export interface PerfilTecnico {
  usuario_id: string;
  nombre_completo: string;
  foto_key: string | null;
  categoria_principal_id: string | null;
  nivel: NivelTecnico;
  descripcion: string | null;
  disponibilidad: Disponibilidad;
  fecha_disponible: number | null;
  direccion: string | null;
  place_id: string | null;
  distrito_id: string | null;
  lat: number | null;
  lng: number | null;
  consultas_habilitadas: 0 | 1;
  calificacion_promedio: number;
  total_calificaciones: number;
  total_colaboraciones: number;
  email_profesional: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  whatsapp: string | null;
  x_url: string | null;
}

export interface Sesion {
  id: string;
  usuario_id: string;
  user_agent: string | null;
  ip: string | null;
  plataforma: Plataforma | null;
  fecha_creacion: number;
  fecha_expiracion: number;
  revocada: 0 | 1;
}

export interface Categoria {
  id: string;
  nombre: string;
  icono_key: string | null;
  orden: number;
  activo: 0 | 1;
}

export interface Habilidad {
  id: string;
  categoria_id: string;
  nombre: string;
  activo: 0 | 1;
}

export interface Distrito {
  id: string;
  nombre: string;
  provincia: string;
  pais: string;
  lat: number;
  lng: number;
  activo: 0 | 1;
}

export interface JWTPayload {
  sub: string;  // usuario.id
  rol: Rol;
  sid: string;  // sesion.id
  iat: number;
  exp: number;
}

export interface RefreshPayload {
  sub: string;
  sid: string;
  type: 'refresh';
  iat: number;
  exp: number;
}

// ── Fase 2: nuevos enums ────────────────────────────────────────────────────

export type EstadoConvocatoria = 'ABIERTA' | 'EN_SELECCION' | 'CERRADA';
export type EstadoColaboracion = 'EN_CURSO' | 'FINALIZADA' | 'CANCELADA';
export type TipoFavorito = 'TECNICO_GUARDADO' | 'EMPRESA_GUARDADA';

// ── Fase 2: nuevas entidades ─────────────────────────────────────────────────

export interface Convocatoria {
  id: string;
  empresa_id: string;
  titulo: string;
  descripcion: string | null;
  categoria_id: string;
  plazas_disponibles: number;
  plazas_ocupadas: number;
  estado: EstadoConvocatoria;
  fecha_inicio: number;
  fecha_fin: number | null;
  fecha_creacion: number;
}

export interface Colaboracion {
  id: string;
  convocatoria_id: string | null;
  tecnico_id: string;
  empresa_id: string;
  estado: EstadoColaboracion;
  fecha_inicio: number;
  fecha_fin: number | null;
  fecha_creacion: number;
}

export interface Favorito {
  id: string;
  usuario_id: string;
  objetivo_id: string;
  tipo: TipoFavorito;
  fecha: number;
}

export interface RecomendacionEmpresa {
  empresa_id: string;
  tecnico_id: string;
  fecha: number;
}

export type EstadoPostulacion = 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA';

export interface Postulacion {
  id: string;
  convocatoria_id: string;
  tecnico_id: string;
  estado: EstadoPostulacion;
  mensaje: string | null;
  fecha_creacion: number;
}

export interface Calificacion {
  id: string;
  colaboracion_id: string;
  autor_id: string;
  destinatario_id: string;
  puntaje: number;
  comentario: string | null;
  fecha: number;
}

export interface Resena {
  id: string;
  autor_id: string;
  destinatario_id: string;
  contenido: string;
  respuesta: string | null;
  fecha: number;
  fecha_respuesta: number | null;
}

export type TipoExperiencia = 'PROYECTO' | 'EMPLEO' | 'PRACTICA';

export interface CV {
  id: string;
  tecnico_id: string;
  pdf_key: string | null;
  ultima_actualizacion: number;
}

export interface ExperienciaCV {
  id: string;
  cv_id: string;
  tipo: TipoExperiencia;
  titulo: string;
  descripcion: string | null;
  fecha_inicio: number;
  fecha_fin: number | null;
}

export interface EducacionCV {
  id: string;
  cv_id: string;
  institucion: string;
  titulo: string;
  fecha_inicio: number;
  fecha_fin: number | null;
}

export interface Certificado {
  id: string;
  cv_id: string;
  nombre: string;
  institucion: string;
  fecha: number;
  url: string | null;
}

// ── Tipo central del app Hono — bindings explícitos, no depende del Env auto-generado
export type HonoEnv = {
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
    BUCKET: R2Bucket;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    FRONTEND_URL: string;
  };
  Variables: {
    userId: string;
    rol: Rol;
    sesionId: string;
  };
};
