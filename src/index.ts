import { Hono } from 'hono';
import type { HonoEnv } from './types';
import authRouter from './routes/auth';
import perfilRouter from './routes/perfil';
import catalogosRouter from './routes/catalogos';
import convocatoriasRouter from './routes/convocatorias';
import colaboracionesRouter from './routes/colaboraciones';
import favoritosRouter from './routes/favoritos';
import recomendacionesRouter from './routes/recomendaciones';
import buscarRouter from './routes/buscar';
import postulacionesRouter from './routes/postulaciones';
import cvRouter from './routes/cv';
import calificacionesRouter from './routes/calificaciones';
import uploadsRouter from './routes/uploads';

const app = new Hono<HonoEnv>();

// Fail-fast: si JWT_SECRET no está configurado ninguna ruta debe responder
app.use('*', async (c, next) => {
  if (!c.env.JWT_SECRET) {
    console.error('[startup] JWT_SECRET no configurado — añádelo a .dev.vars o wrangler secret put');
    return c.json({ success: false, error: 'Configuración del servidor incompleta' }, 500);
  }
  await next();
});

app.route('/api/auth', authRouter);
app.route('/api/perfil', perfilRouter);
app.route('/api', catalogosRouter);
app.route('/api/convocatorias', convocatoriasRouter);
app.route('/api/colaboraciones', colaboracionesRouter);
app.route('/api/favoritos', favoritosRouter);
app.route('/api/recomendaciones', recomendacionesRouter);
app.route('/api/buscar', buscarRouter);
app.route('/api/postulaciones', postulacionesRouter);
app.route('/api/cv', cvRouter);
app.route('/api/calificaciones', calificacionesRouter);
app.route('/api/uploads', uploadsRouter);
// TODO Fase 6: mensajería, notificaciones ranking_tecnico scoring POST /api/calificaciones, GET /api/resenas/:usuarioId
// TODO Fase 5: ranking_tecnico scoring + geocoding Google Maps
// TODO Fase 6: mensajería (GET/POST /api/mensajes), notificaciones, consultas directas
// TODO Fase 7: constancias (PDF en R2), insignias (lógica de trigger)

app.notFound((c) => c.json({ success: false, error: 'Ruta no encontrada' }, 404));
app.onError((error, c) => {
  console.error('[unhandled]', error);
  return c.json({ success: false, error: 'Error interno del servidor' }, 500);
});

export default app;
