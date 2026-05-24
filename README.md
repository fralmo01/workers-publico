# Veri-on — Referencia de API

Base URL en desarrollo: `http://localhost:8787/api`  
Base URL en producción: depende del Worker desplegado en Cloudflare.

Todos los endpoints devuelven JSON con este envoltorio:

```json
// Éxito
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": "Mensaje de error" }
```

Los timestamps son **Unix epoch en segundos** (`Math.floor(Date.now() / 1000)`).  
Los IDs son **UUID v4** en texto.  
Las imágenes en R2 se sirven vía el Worker: `GET /api/uploads/<key>`.

---

## Autenticación

Los endpoints protegidos requieren el header:

```
Authorization: Bearer <accessToken>
```

El `accessToken` expira en **15 minutos**. Usa `/auth/refresh` para renovarlo con el `refreshToken` (válido 30 días).

---

## 1. Auth — `/api/auth`

### `POST /api/auth/register`

Registra un nuevo usuario y crea su perfil vacío.

**Body:**
```json
{
  "email": "juan@example.com",
  "password": "min8chars",
  "rol": "TECNICO"
}
```

> `rol` acepta: `"TECNICO"` | `"EMPRESA"`

**Respuesta 201:**
```json
{
  "ok": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "juan@example.com",
    "rol": "TECNICO"
  }
}
```

---

### `POST /api/auth/login`

Inicia sesión y devuelve tokens JWT.

**Body:**
```json
{
  "email": "juan@example.com",
  "password": "mi-password",
  "plataforma": "ANDROID"
}
```

> `plataforma` es opcional. Acepta: `"WEB"` | `"ANDROID"` | `"IOS"`. Default: `"WEB"`.

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "juan@example.com",
      "rol": "TECNICO"
    }
  }
}
```

---

### `POST /api/auth/logout`

Revoca la sesión actual. Requiere auth.

**Respuesta 200:**
```json
{ "ok": true, "data": { "message": "Sesión cerrada correctamente" } }
```

---

### `POST /api/auth/refresh`

Renueva el accessToken usando el refreshToken.

**Body:**
```json
{ "refreshToken": "eyJhbGciOiJIUzI1NiJ9..." }
```

**Respuesta 200:**
```json
{ "ok": true, "data": { "accessToken": "eyJhbGciOiJIUzI1NiJ9..." } }
```

---

### `GET /api/auth/google`

Devuelve la URL de redirección para iniciar OAuth con Google.

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "url": "https://accounts.google.com/o/oauth2/v2/auth?...",
    "state": "uuid-csrf-token"
  }
}
```

> En móvil: abre `url` en un WebView o browser externo. Al finalizar, Google redirige al callback del Worker, que a su vez redirige al frontend con los tokens en query params.

---

### `GET /api/auth/google/callback`

Callback manejado por el Worker — no se llama directamente desde el cliente. El Worker redirige a:

```
<FRONTEND_URL>/oauth-callback?accessToken=...&refreshToken=...&id=...&email=...&rol=...&is_new=1
```

> `is_new=1` indica que es un usuario nuevo que debe pasar por `/onboarding`.

---

### `POST /api/auth/onboarding`

Completa el perfil de un usuario nuevo de Google. Requiere auth.

**Body:**
```json
{
  "rol": "TECNICO",
  "nombre": "Juan Pérez"
}
```

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
    "rol": "TECNICO"
  }
}
```

---

### `DELETE /api/auth/me`

Eliminación lógica de la cuenta (soft delete, 30 días de gracia). Requiere auth.

**Respuesta 200:**
```json
{ "ok": true, "data": { "message": "Cuenta eliminada. Tienes 30 días para restaurarla en /api/auth/restore." } }
```

---

### `POST /api/auth/restore`

Restaura una cuenta eliminada dentro del período de gracia de 30 días.

**Body:**
```json
{
  "email": "juan@example.com",
  "password": "mi-password"
}
```

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "message": "Cuenta restaurada correctamente",
    "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
    "user": { "id": "...", "email": "...", "rol": "TECNICO" }
  }
}
```

---

## 2. Perfil — `/api/perfil`

### `GET /api/perfil/me`

Devuelve el usuario autenticado + su perfil completo. Requiere auth.

**Respuesta 200 (técnico):**
```json
{
  "ok": true,
  "data": {
    "id": "550e8400-...",
    "email": "juan@example.com",
    "rol": "TECNICO",
    "tema": "CLARO",
    "idioma": "ES",
    "fecha_registro": 1716000000,
    "email_verificado": 0,
    "perfil": {
      "usuario_id": "550e8400-...",
      "nombre_completo": "Juan Pérez",
      "foto_key": "fotos/550e8400-....jpg",
      "categoria_principal_id": "cat-uuid",
      "nivel": "EGRESADO",
      "descripcion": "Desarrollador web full-stack",
      "disponibilidad": "INMEDIATA",
      "fecha_disponible": null,
      "direccion": "Miraflores, Lima",
      "distrito_id": "dist-uuid",
      "lat": -12.1167,
      "lng": -77.0333,
      "calificacion_promedio": 4.5,
      "total_calificaciones": 12,
      "total_colaboraciones": 8,
      "email_profesional": "juan@gmail.com",
      "github_url": "https://github.com/juan",
      "linkedin_url": "https://linkedin.com/in/juan",
      "instagram_url": null,
      "whatsapp": "51999888777",
      "x_url": null
    }
  }
}
```

---

### `PUT /api/perfil/tecnico`

Actualiza el perfil del técnico autenticado. Requiere auth con rol `TECNICO`.

**Body:**
```json
{
  "nombre_completo": "Juan Pérez",
  "nivel": "EGRESADO",
  "disponibilidad": "INMEDIATA",
  "descripcion": "Desarrollador web full-stack con 3 años de experiencia",
  "direccion": "Miraflores, Lima",
  "distrito_id": "dist-uuid",
  "categoria_principal_id": "cat-uuid",
  "fecha_disponible": null,
  "email_profesional": "juan@gmail.com",
  "github_url": "https://github.com/juan",
  "linkedin_url": "https://linkedin.com/in/juan",
  "instagram_url": null,
  "whatsapp": "51999888777",
  "x_url": null
}
```

> `nivel`: `"PRACTICANTE"` | `"EGRESADO"` | `"CERTIFICADO"`  
> `disponibilidad`: `"INMEDIATA"` | `"FECHA"` | `"NO_DISPONIBLE"`  
> Si `disponibilidad = "FECHA"`, proveer `fecha_disponible` como Unix timestamp.  
> `direccion` se geocodifica automáticamente a `lat`/`lng` vía Nominatim.

**Respuesta 200:** perfil técnico actualizado (mismo esquema de `/me`).

---

### `PUT /api/perfil/empresa`

Actualiza el perfil de la empresa autenticada. Requiere auth con rol `EMPRESA`.

**Body:**
```json
{
  "razon_social": "Tech Solutions SAC",
  "ruc": "20512345678",
  "sector": "Tecnología",
  "descripcion": "Empresa de desarrollo de software",
  "sitio_web": "https://techsolutions.pe",
  "direccion": "San Isidro, Lima",
  "distrito_id": "dist-uuid",
  "email_profesional": "contacto@techsolutions.pe",
  "linkedin_url": "https://linkedin.com/company/techsolutions",
  "instagram_url": null,
  "facebook_url": null,
  "whatsapp": "51999888777"
}
```

**Respuesta 200:** perfil empresa actualizado.

---

### `PUT /api/perfil/ubicacion`

Guarda la ubicación GPS actual del usuario (técnico o empresa). Requiere auth.

**Body:**
```json
{
  "lat": -12.1167,
  "lng": -77.0333
}
```

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "lat": -12.1167,
    "lng": -77.0333,
    "direccion": "Av. Larco 123, Miraflores, Lima, Peru"
  }
}
```

---

### `GET /api/perfil/tecnico/:id`

Perfil público de un técnico. Sin auth.

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "id": "550e8400-...",
    "rol": "TECNICO",
    "perfil": {
      "usuario_id": "550e8400-...",
      "nombre_completo": "Juan Pérez",
      "foto_key": "fotos/550e8400-....jpg",
      "nivel": "EGRESADO",
      "calificacion_promedio": 4.5,
      "total_colaboraciones": 8,
      "email_profesional": "juan@gmail.com"
    },
    "favoritos_count": 24
  }
}
```

> `email_profesional` solo aparece si el técnico lo configuró. `usuario.email` nunca se expone.

---

### `GET /api/perfil/empresa/:id`

Perfil público de una empresa. Sin auth.

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "id": "emp-uuid",
    "rol": "EMPRESA",
    "perfil": {
      "usuario_id": "emp-uuid",
      "razon_social": "Tech Solutions SAC",
      "logo_key": "logos/emp-uuid.png",
      "sector": "Tecnología",
      "descripcion": "...",
      "calificacion_promedio": 4.0,
      "total_contrataciones": 35
    },
    "favoritos_count": 10
  }
}
```

---

## 3. Catálogos — `/api`

Endpoints de solo lectura, sin auth.

### `GET /api/categorias`

```json
{
  "ok": true,
  "data": [
    { "id": "cat-uuid", "nombre": "Desarrollo Web", "icono_key": null, "orden": 1, "activo": 1 }
  ]
}
```

### `GET /api/habilidades`

```json
{
  "ok": true,
  "data": [
    { "id": "hab-uuid", "categoria_id": "cat-uuid", "nombre": "React", "activo": 1 }
  ]
}
```

### `GET /api/distritos`

```json
{
  "ok": true,
  "data": [
    { "id": "dist-uuid", "nombre": "Miraflores", "provincia": "Lima", "pais": "PE", "lat": -12.1167, "lng": -77.0333, "activo": 1 }
  ]
}
```

---

## 4. Búsqueda — `/api/buscar`

Endpoints públicos, sin auth, con paginación.

### `GET /api/buscar/tecnicos`

**Query params (todos opcionales):**

| Param | Tipo | Descripción |
|---|---|---|
| `categoria` | string | UUID de categoría |
| `nivel` | string | `PRACTICANTE` \| `EGRESADO` \| `CERTIFICADO` |
| `disponibilidad` | string | `INMEDIATA` \| `FECHA` \| `NO_DISPONIBLE` |
| `distrito` | string | UUID de distrito |
| `calificacion_min` | number | Mínimo de calificación (0-5) |
| `habilidades` | string | UUIDs separados por coma. AND lógico. |
| `lat` | number | Latitud del punto de referencia |
| `lng` | number | Longitud del punto de referencia |
| `radio_km` | number | Radio de búsqueda en km (requiere `lat`+`lng`) |
| `orden` | string | `calificacion` \| `recientes` \| `colaboraciones` \| `ranking` |
| `limit` | number | Items por página. Max 50. Default 20. |
| `offset` | number | Saltar N items. Default 0. |

**Ejemplo:** `GET /api/buscar/tecnicos?categoria=cat-uuid&nivel=EGRESADO&orden=ranking&limit=10`

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "usuario_id": "550e8400-...",
        "nombre_completo": "Juan Pérez",
        "foto_key": "fotos/550e8400-....jpg",
        "categoria_principal_id": "cat-uuid",
        "nivel": "EGRESADO",
        "disponibilidad": "INMEDIATA",
        "distrito_id": "dist-uuid",
        "lat": -12.1167,
        "lng": -77.0333,
        "calificacion_promedio": 4.5,
        "total_calificaciones": 12,
        "total_colaboraciones": 8,
        "github_url": "https://github.com/juan",
        "linkedin_url": null,
        "whatsapp": "51999888777",
        "email_profesional": null,
        "favoritos_count": 24,
        "score_final": 3.82
      }
    ],
    "total": 142,
    "limit": 10,
    "offset": 0
  }
}
```

---

### `GET /api/buscar/convocatorias`

**Query params (todos opcionales):**

| Param | Tipo | Descripción |
|---|---|---|
| `categoria` | string | UUID de categoría |
| `distrito` | string | UUID de distrito de la empresa |
| `estado` | string | `ABIERTA` \| `EN_SELECCION` \| `CERRADA`. Default: `ABIERTA` |
| `lat` | number | Latitud del punto de referencia |
| `lng` | number | Longitud del punto de referencia |
| `radio_km` | number | Radio de búsqueda en km |
| `orden` | string | `recientes` \| `plazas` |
| `limit` / `offset` | number | Paginación |

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "conv-uuid",
        "empresa_id": "emp-uuid",
        "titulo": "Desarrollador React Junior",
        "descripcion": "Buscamos...",
        "categoria_id": "cat-uuid",
        "plazas_disponibles": 3,
        "plazas_ocupadas": 1,
        "estado": "ABIERTA",
        "fecha_inicio": 1716000000,
        "fecha_fin": 1718000000,
        "fecha_creacion": 1715900000,
        "razon_social": "Tech Solutions SAC",
        "logo_key": "logos/emp-uuid.png",
        "empresa_descripcion": "...",
        "empresa_distrito_id": "dist-uuid",
        "empresa_lat": -12.1167,
        "empresa_lng": -77.0333,
        "empresa_direccion": "San Isidro, Lima",
        "empresa_usuario_id": "emp-uuid"
      }
    ],
    "total": 56,
    "limit": 20,
    "offset": 0
  }
}
```

---

## 5. Convocatorias — `/api/convocatorias`

### `GET /api/convocatorias`

Lista las convocatorias de la empresa autenticada. Requiere auth con rol `EMPRESA`.

**Respuesta 200:** array de objetos `Convocatoria`.

---

### `POST /api/convocatorias`

Crea una convocatoria. Requiere auth con rol `EMPRESA`.

**Body:**
```json
{
  "titulo": "Desarrollador React Junior",
  "descripcion": "Buscamos un técnico con experiencia en React...",
  "categoria_id": "cat-uuid",
  "plazas_disponibles": 3,
  "fecha_inicio": 1716000000,
  "fecha_fin": 1718000000
}
```

> `fecha_fin` es opcional.

**Respuesta 201:**
```json
{
  "ok": true,
  "data": {
    "id": "conv-uuid",
    "empresa_id": "emp-uuid",
    "titulo": "Desarrollador React Junior",
    "descripcion": "...",
    "categoria_id": "cat-uuid",
    "plazas_disponibles": 3,
    "plazas_ocupadas": 0,
    "estado": "ABIERTA",
    "fecha_inicio": 1716000000,
    "fecha_fin": 1718000000,
    "fecha_creacion": 1715900000
  }
}
```

---

### `GET /api/convocatorias/:id`

Detalle público de una convocatoria (incluye datos de la empresa). Sin auth.

**Respuesta 200:** objeto `Convocatoria` + campos `razon_social`, `logo_key`, `empresa_descripcion`, `empresa_sector`, `empresa_calificacion`, etc.

---

### `PUT /api/convocatorias/:id`

Edita una convocatoria (empresa dueña, no editable si está `CERRADA`). Requiere auth con rol `EMPRESA`.

**Body:** mismo que `POST /api/convocatorias`.

---

### `PATCH /api/convocatorias/:id/estado`

Cambia el estado. Requiere auth con rol `EMPRESA`.

**Body:**
```json
{ "estado": "EN_SELECCION" }
```

> Transiciones válidas: `ABIERTA → EN_SELECCION | CERRADA`, `EN_SELECCION → ABIERTA | CERRADA`.

**Respuesta 200:**
```json
{ "ok": true, "data": { "id": "conv-uuid", "estado": "EN_SELECCION" } }
```

---

### `DELETE /api/convocatorias/:id`

Elimina la convocatoria. Solo si está en estado `ABIERTA` y sin colaboraciones. Requiere auth con rol `EMPRESA`.

---

### `POST /api/convocatorias/:id/postulaciones`

Técnico postula a la convocatoria. Requiere auth con rol `TECNICO`.

**Body (opcional):**
```json
{ "mensaje": "Estoy muy interesado en esta posición..." }
```

**Respuesta 201:**
```json
{
  "ok": true,
  "data": {
    "id": "post-uuid",
    "convocatoria_id": "conv-uuid",
    "tecnico_id": "tec-uuid",
    "estado": "PENDIENTE",
    "mensaje": "Estoy muy interesado...",
    "fecha_creacion": 1715900000
  }
}
```

---

### `GET /api/convocatorias/:id/postulaciones`

Empresa lista las postulaciones de su convocatoria. Requiere auth con rol `EMPRESA`.

**Respuesta 200:** array de postulaciones + `nombre_completo`, `foto_key`, `nivel`, `calificacion_promedio` del técnico.

---

## 6. Postulaciones — `/api/postulaciones`

### `GET /api/postulaciones/mis-postulaciones`

Técnico ve todas sus postulaciones. Requiere auth con rol `TECNICO`.

**Respuesta 200:** array de postulaciones + `titulo` y datos de la empresa de la convocatoria.

---

### `GET /api/postulaciones/mi-estado?convocatoria_id=conv-uuid`

Estado de la postulación del técnico en una convocatoria. Requiere auth con rol `TECNICO`.

**Respuesta 200:** objeto `Postulacion` o `null` si no postulo.

---

### `PATCH /api/postulaciones/:id/estado`

Empresa acepta o rechaza una postulación `PENDIENTE`. Requiere auth con rol `EMPRESA`.

**Body:**
```json
{ "estado": "ACEPTADA" }
```

> `estado` acepta: `"ACEPTADA"` | `"RECHAZADA"`.  
> Aceptar crea automáticamente una `colaboracion` en estado `EN_CURSO`.

**Respuesta 200 (ACEPTADA):**
```json
{
  "ok": true,
  "data": {
    "id": "post-uuid",
    "estado": "ACEPTADA",
    "colaboracion_id": "colab-uuid"
  }
}
```

---

## 7. Colaboraciones — `/api/colaboraciones`

### `GET /api/colaboraciones`

Lista las colaboraciones del usuario autenticado (empresa o técnico). Requiere auth.

---

### `POST /api/colaboraciones`

Empresa crea una colaboración directa (sin postulación). Requiere auth con rol `EMPRESA`.

**Body:**
```json
{
  "tecnico_id": "tec-uuid",
  "fecha_inicio": 1716000000,
  "convocatoria_id": "conv-uuid"
}
```

> `convocatoria_id` es opcional. Si se omite, la colaboración no está asociada a ninguna convocatoria.

**Respuesta 201:**
```json
{
  "ok": true,
  "data": {
    "id": "colab-uuid",
    "convocatoria_id": "conv-uuid",
    "tecnico_id": "tec-uuid",
    "empresa_id": "emp-uuid",
    "estado": "EN_CURSO",
    "fecha_inicio": 1716000000,
    "fecha_fin": null,
    "fecha_creacion": 1715900000
  }
}
```

---

### `GET /api/colaboraciones/:id`

Detalle de una colaboración. Solo empresa o técnico involucrado. Requiere auth.

---

### `PATCH /api/colaboraciones/:id/estado`

Cambia el estado de la colaboración. Empresa o técnico involucrado. Requiere auth.

**Body:**
```json
{ "estado": "FINALIZADA" }
```

> Transiciones: `EN_CURSO → FINALIZADA | CANCELADA`.  
> `FINALIZADA` incrementa automáticamente `perfil_tecnico.total_colaboraciones` y `perfil_empresa.total_contrataciones`.

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "id": "colab-uuid",
    "estado": "FINALIZADA",
    "fecha_fin": 1718000000
  }
}
```

---

## 8. Calificaciones y Reseñas — `/api/calificaciones`

### `POST /api/calificaciones`

Califica a la contraparte tras una colaboración `FINALIZADA`. Requiere auth.

> Empresa califica al técnico; técnico califica a la empresa. Una sola calificación por colaboración por autor.

**Body:**
```json
{
  "colaboracion_id": "colab-uuid",
  "puntaje": 4.5,
  "comentario": "Excelente trabajo, muy profesional."
}
```

> `puntaje`: número entre 1 y 5. Se redondea a múltiplos de 0.5.

**Respuesta 201:**
```json
{
  "ok": true,
  "data": {
    "id": "cal-uuid",
    "colaboracion_id": "colab-uuid",
    "autor_id": "emp-uuid",
    "destinatario_id": "tec-uuid",
    "puntaje": 4.5,
    "comentario": "Excelente trabajo...",
    "fecha": 1718000000
  }
}
```

---

### `GET /api/calificaciones/:destinatarioId`

Lista las calificaciones recibidas por un usuario. Sin auth. Máximo 50 resultados.

---

### `POST /api/calificaciones/resenas`

Escribe una reseña abierta (sin necesidad de colaboración previa). Requiere auth.

> Una sola reseña por par autor→destinatario, para siempre.

**Body:**
```json
{
  "destinatario_id": "tec-uuid",
  "contenido": "Trabajé con Juan en un proyecto y fue muy profesional.",
  "puntaje": 4
}
```

> `puntaje` es opcional (1-5).

**Respuesta 201:** objeto `Resena`.

---

### `GET /api/calificaciones/resenas/:destinatarioId`

Lista las reseñas de un usuario. Sin auth. Máximo 50 resultados.

**Respuesta 200:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "res-uuid",
      "autor_id": "emp-uuid",
      "destinatario_id": "tec-uuid",
      "contenido": "Muy profesional...",
      "puntaje": 4,
      "respuesta": "Gracias por la oportunidad!",
      "fecha": 1716000000,
      "fecha_respuesta": 1716100000
    }
  ]
}
```

---

### `PATCH /api/calificaciones/resenas/:id/respuesta`

Destinatario responde a una reseña. Requiere auth.

**Body:**
```json
{ "respuesta": "Gracias por tu comentario, fue un placer trabajar juntos." }
```

---

## 9. CV Digital — `/api/cv`

Todos los endpoints de escritura requieren auth con rol `TECNICO`.

### `GET /api/cv/mio`

CV completo del técnico autenticado. Requiere auth.

**Respuesta 200:**
```json
{
  "ok": true,
  "data": {
    "cv": {
      "id": "cv-uuid",
      "tecnico_id": "tec-uuid",
      "pdf_key": "cvs/tec-uuid.pdf",
      "ultima_actualizacion": 1716000000
    },
    "experiencias": [
      {
        "id": "exp-uuid",
        "cv_id": "cv-uuid",
        "tipo": "EMPLEO",
        "titulo": "Desarrollador Backend en StartupPe",
        "descripcion": "Desarrollé APIs REST con Node.js",
        "fecha_inicio": 1680000000,
        "fecha_fin": 1710000000
      }
    ],
    "educacion": [
      {
        "id": "edu-uuid",
        "cv_id": "cv-uuid",
        "institucion": "SENATI",
        "titulo": "Técnico en Computación e Informática",
        "fecha_inicio": 1609459200,
        "fecha_fin": 1672531200
      }
    ],
    "certificados": [
      {
        "id": "cert-uuid",
        "cv_id": "cv-uuid",
        "nombre": "AWS Cloud Practitioner",
        "institucion": "Amazon Web Services",
        "fecha": 1710000000,
        "url": "https://aws.amazon.com/verify/..."
      }
    ],
    "habilidades": [
      { "id": "hab-uuid", "nombre": "React", "categoria_id": "cat-uuid" }
    ]
  }
}
```

---

### `GET /api/cv/:tecnicoId`

CV público de un técnico. Sin auth. Mismo esquema que `/cv/mio`.

---

### `PUT /api/cv/habilidades`

Reemplaza la lista completa de habilidades del técnico. Requiere auth.

**Body:**
```json
{ "habilidad_ids": ["hab-uuid-1", "hab-uuid-2", "hab-uuid-3"] }
```

**Respuesta 200:**
```json
{ "ok": true, "data": { "habilidades_guardadas": 3 } }
```

---

### `POST /api/cv/experiencia`

Agrega una experiencia. Requiere auth.

**Body:**
```json
{
  "tipo": "EMPLEO",
  "titulo": "Desarrollador Backend en StartupPe",
  "descripcion": "Desarrollé APIs REST con Node.js y PostgreSQL",
  "fecha_inicio": 1680000000,
  "fecha_fin": 1710000000
}
```

> `tipo`: `"PROYECTO"` | `"EMPLEO"` | `"PRACTICA"`  
> `fecha_fin` es opcional (null = trabajo actual).

**Respuesta 201:** objeto `ExperienciaCV`.

---

### `PUT /api/cv/experiencia/:id`

Actualiza una experiencia. Requiere auth.

### `DELETE /api/cv/experiencia/:id`

Elimina una experiencia. Requiere auth.

---

### `POST /api/cv/educacion`

**Body:**
```json
{
  "institucion": "SENATI",
  "titulo": "Técnico en Computación e Informática",
  "fecha_inicio": 1609459200,
  "fecha_fin": 1672531200
}
```

**Respuesta 201:** objeto `EducacionCV`.

### `PUT /api/cv/educacion/:id` / `DELETE /api/cv/educacion/:id`

Actualizar o eliminar una entrada de educación. Requiere auth.

---

### `POST /api/cv/certificado`

**Body:**
```json
{
  "nombre": "AWS Cloud Practitioner",
  "institucion": "Amazon Web Services",
  "fecha": 1710000000,
  "url": "https://aws.amazon.com/verify/..."
}
```

> `url` es opcional.

**Respuesta 201:** objeto `Certificado`.

### `PUT /api/cv/certificado/:id` / `DELETE /api/cv/certificado/:id`

Actualizar o eliminar un certificado. Requiere auth.

---

## 10. Proyectos — `/api/proyectos`

### `GET /api/proyectos/:tecnicoId`

Lista pública de proyectos de un técnico. Sin auth.

**Respuesta 200:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "proy-uuid",
      "tecnico_id": "tec-uuid",
      "titulo": "App de gestión de inventario",
      "descripcion": "Sistema web con React y Node.js",
      "portada_key": "portadas/proy-uuid.jpg",
      "url": "https://github.com/juan/inventario",
      "fecha_creacion": 1715900000
    }
  ]
}
```

---

### `POST /api/proyectos`

Crea un proyecto. Requiere auth con rol `TECNICO`.

**Body:**
```json
{
  "titulo": "App de gestión de inventario",
  "descripcion": "Sistema web con React y Node.js",
  "url": "https://github.com/juan/inventario"
}
```

> `descripcion` y `url` son opcionales.

**Respuesta 201:** objeto `ProyectoTecnico`.

---

### `PUT /api/proyectos/:id`

Actualiza un proyecto (dueño). Requiere auth. **Body:** mismo que POST.

### `DELETE /api/proyectos/:id`

Elimina un proyecto y su portada en R2 si la tiene. Requiere auth.

---

## 11. Archivos (R2) — `/api/uploads`

### `PUT /api/uploads/foto`

Técnico sube su foto de perfil. Requiere auth con rol `TECNICO`.

**Request:** `multipart/form-data` con campo `file` (imagen JPEG/PNG/WebP/GIF, máx 5 MB).

**Respuesta 200:**
```json
{ "ok": true, "data": { "key": "fotos/tec-uuid.jpg" } }
```

> Para mostrar la imagen: `<img src="/api/uploads/fotos/tec-uuid.jpg" />`

---

### `PUT /api/uploads/logo`

Empresa sube su logo. Requiere auth con rol `EMPRESA`.

**Request:** `multipart/form-data` con campo `file` (imagen, máx 5 MB).

**Respuesta 200:**
```json
{ "ok": true, "data": { "key": "logos/emp-uuid.png" } }
```

---

### `PUT /api/uploads/cv-pdf`

Técnico sube su CV en PDF. Requiere auth con rol `TECNICO`.

**Request:** `multipart/form-data` con campo `file` (PDF, máx 10 MB).

**Respuesta 200:**
```json
{ "ok": true, "data": { "key": "cvs/tec-uuid.pdf" } }
```

---

### `PUT /api/uploads/portada/:proyectoId`

Técnico sube portada de un proyecto (debe ser dueño). Requiere auth con rol `TECNICO`.

**Request:** `multipart/form-data` con campo `file` (imagen, máx 5 MB).

---

### Rutas de descarga (sin auth salvo CV)

| Ruta | Auth | Descripción |
|---|---|---|
| `GET /api/uploads/fotos/:file` | No | Foto de perfil del técnico |
| `GET /api/uploads/logos/:file` | No | Logo de empresa |
| `GET /api/uploads/portadas/:file` | No | Portada de proyecto |
| `GET /api/uploads/cvs/:file` | Sí (propietario) | PDF de CV |

---

## Resumen de Enums

| Enum | Valores |
|---|---|
| `Rol` | `EMPRESA` \| `TECNICO` \| `ADMIN` |
| `Plataforma` | `WEB` \| `ANDROID` \| `IOS` |
| `NivelTecnico` | `PRACTICANTE` \| `EGRESADO` \| `CERTIFICADO` |
| `Disponibilidad` | `INMEDIATA` \| `FECHA` \| `NO_DISPONIBLE` |
| `EstadoConvocatoria` | `ABIERTA` \| `EN_SELECCION` \| `CERRADA` |
| `EstadoPostulacion` | `PENDIENTE` \| `ACEPTADA` \| `RECHAZADA` |
| `EstadoColaboracion` | `EN_CURSO` \| `FINALIZADA` \| `CANCELADA` |
| `TipoExperiencia` | `PROYECTO` \| `EMPLEO` \| `PRACTICA` |
| `TipoFavorito` | `TECNICO_GUARDADO` \| `EMPRESA_GUARDADA` |

---

## Flujo típico en móvil

```
1. POST /auth/login  →  guardar accessToken + refreshToken en SecureStorage
2. GET /buscar/tecnicos?...  →  mostrar resultados
3. GET /convocatorias/:id  →  detalle de convocatoria
4. POST /convocatorias/:id/postulaciones  →  postular
5. GET /postulaciones/mis-postulaciones  →  revisar estado
6. PATCH /colaboraciones/:id/estado { estado: "FINALIZADA" }
7. POST /calificaciones  →  calificar al contraparte
8. POST /auth/refresh  →  renovar accessToken cuando expire (cada 15 min)
```

## Flujo típico en empresa

```
1. POST /auth/register { rol: "EMPRESA" }  →  crear cuenta
2. PUT /perfil/empresa  →  completar perfil + subir logo via PUT /uploads/logo
3. POST /convocatorias  →  publicar oferta
4. GET /convocatorias/:id/postulaciones  →  revisar candidatos
5. PATCH /postulaciones/:id/estado { estado: "ACEPTADA" }  →  acepta y crea colaboración
6. PATCH /colaboraciones/:id/estado { estado: "FINALIZADA" }
7. POST /calificaciones  →  calificar al técnico
```
