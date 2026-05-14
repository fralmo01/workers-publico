# Documentación del Modelo de Base de Datos

Este documento describe la estructura y el propósito de las tablas en la base de datos definida en `modelo.sql`. El esquema está diseñado para una plataforma que conecta **Empresas** con **Técnicos** para trabajos o convocatorias, e incluye módulos de perfiles, colaboraciones, calificaciones, mensajería y gamificación.

## 1. Tablas Base y Catálogos

*   **`distrito`**: Almacena información geográfica de los distritos (nombre, provincia, coordenadas lat/lng). Útil para la búsqueda y filtrado por ubicación.
*   **`categoria`**: Clasificaciones generales de trabajo (ej. Electricidad, Sistemas, Mecánica).
*   **`habilidad`**: Habilidades específicas asociadas a cada categoría (ej. "Instalaciones domiciliarias" dentro de "Electricidad").

## 2. Usuarios y Perfiles

El sistema de usuarios se divide en una tabla principal de autenticación y tablas secundarias para los perfiles específicos según el rol.

*   **`usuario`**: Tabla central de autenticación. Guarda email, contraseña, rol (`EMPRESA`, `TECNICO`, `ADMIN`), preferencias de UI (tema, idioma) y estado de verificación.
*   **`perfil_empresa`**: Información detallada de las empresas (RUC, razón social, dirección, distrito, calificación promedio, etc.). Vinculada 1 a 1 con `usuario`.
*   **`perfil_tecnico`**: Información detallada de los técnicos (nombre, nivel, disponibilidad, categoría principal, ubicación, calificación promedio). Vinculada 1 a 1 con `usuario`.
*   **`tecnico_habilidad`**: Tabla intermedia que relaciona los técnicos con sus respectivas habilidades.

## 3. Currículum Vitae (CV)

*   **`cv`**: Registro central del currículum de un técnico. Permite enlazar un PDF (vía `pdf_key`).
*   **`experiencia_cv`**: Experiencias laborales o proyectos de un técnico, asociadas a su CV.
*   **`educacion`**: Historial académico de un técnico, asociado a su CV.

## 4. Convocatorias y Colaboraciones

*   **`convocatoria`**: Ofertas de trabajo o proyectos publicados por una empresa. Define plazas disponibles, categoría requerida y su estado (`ABIERTA`, `EN_SELECCION`, `CERRADA`).
*   **`colaboracion`**: Representa el vínculo o la contratación entre un técnico y una empresa, generalmente originada por una convocatoria. Controla el estado del trabajo (`EN_CURSO`, `FINALIZADA`, `CANCELADA`).

## 5. Calificaciones, Reseñas y Consultas

*   **`calificacion`**: Puntuación (1 a 5 estrellas) y comentario otorgado al finalizar una colaboración. Se puede dar de empresa a técnico y viceversa.
*   **`resena`**: Comentarios abiertos e independientes entre usuarios, con posibilidad de respuesta.
*   **`consulta`**: Solicitudes de contacto directo de una empresa hacia un técnico sin necesidad de una convocatoria previa.

## 6. Sistema de Retención y Valoración

*   **`favorito`**: Permite a las empresas guardar técnicos (lista de favoritos) y a los técnicos guardar empresas (lista blanca).
*   **`recomendacion_empresa`**: Registro explícito de que una empresa recomienda a un técnico en particular.

## 7. Constancias y Gamificación (Insignias)

*   **`constancia`**: Certificado digital emitido al concluir exitosamente una colaboración, enlazando empresa, técnico y un archivo PDF.
*   **`insignia`**: Catálogo de logros u objetivos del sistema (ej. "Primera colaboración", "Calificación 4.8+").
*   **`tecnico_insignia`**: Registro de las insignias que han sido desbloqueadas por los técnicos.

## 8. Comunicación y Notificaciones

*   **`mensaje`**: Sistema de mensajería interna (chat) directa entre usuarios.
*   **`notificacion`**: Alertas del sistema dirigidas a los usuarios (ej. nuevas convocatorias, mensajes, calificaciones, obtención de insignias).

## 9. Ranking y Búsqueda

*   **`ranking_tecnico`**: Tabla optimizada (potencialmente sincronizada mediante procesos en segundo plano) que consolida puntajes, ubicación y disponibilidad para ordenar rápidamente los resultados en las búsquedas de técnicos.

## 10. Seguridad y Sesiones

*   **`sesion`**: Control de sesiones activas de los usuarios, incluyendo origen (`IP`, `user_agent`), plataforma (`WEB`, `ANDROID`, `IOS`) y tiempos de expiración para manejo de tokens/seguridad.
