import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types';
import { verifyAccess } from '../lib/jwt';
import { err } from '../lib/responses';

export const authMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return err(c, 'Se requiere autenticación', 401);
  }
  const token = header.slice(7);
  try {
    const payload = await verifyAccess(token, c.env.JWT_SECRET);

    // Una sola consulta: verifica sesión no revocada Y usuario activo
    const row = await c.env.DB
      .prepare(
        'SELECT s.revocada, u.activo FROM sesion s INNER JOIN usuario u ON u.id = s.usuario_id WHERE s.id = ?',
      )
      .bind(payload.sid)
      .first<{ revocada: 0 | 1; activo: 0 | 1 }>();

    if (!row || row.revocada === 1 || row.activo === 0) {
      return err(c, 'Sesión inválida o revocada', 401);
    }

    c.set('userId', payload.sub);
    c.set('rol', payload.rol);
    c.set('sesionId', payload.sid);
    await next();
  } catch {
    return err(c, 'Token inválido o expirado', 401);
  }
};
