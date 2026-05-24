import { Hono } from 'hono';
import type { HonoEnv, Rol, Plataforma } from '../types';
import { authMiddleware } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../lib/password';
import { signAccess, signRefresh, verifyRefresh, REFRESH_TTL } from '../lib/jwt';
import { ok, err } from '../lib/responses';

const ROLES_REGISTRABLES: Rol[] = ['EMPRESA', 'TECNICO'];
const PLATAFORMAS: Plataforma[] = ['WEB', 'ANDROID', 'IOS'];
const DUMMY_HASH = '100000:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const router = new Hono<HonoEnv>();

router.post('/register', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { email, password, rol } = body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return err(c, 'Email inválido', 400);
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return err(c, 'La contraseña debe tener al menos 8 caracteres', 400);
  }
  if (!rol || !ROLES_REGISTRABLES.includes(rol as Rol)) {
    return err(c, `rol debe ser uno de: ${ROLES_REGISTRABLES.join(', ')}`, 400);
  }

  const emailNorm = email.toLowerCase().trim();
  const rolValue = rol as Rol;

  try {
    const exists = await c.env.DB
      .prepare('SELECT id FROM usuario WHERE email = ?')
      .bind(emailNorm)
      .first<{ id: string }>();
    if (exists) return err(c, 'El email ya está registrado', 409);

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const hash = await hashPassword(password as string);

    const perfilStmt =
      rolValue === 'EMPRESA'
        ? c.env.DB
            .prepare('INSERT INTO perfil_empresa (usuario_id, razon_social) VALUES (?, ?)')
            .bind(id, '')
        : c.env.DB
            .prepare('INSERT INTO perfil_tecnico (usuario_id, nombre_completo) VALUES (?, ?)')
            .bind(id, '');

    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO usuario
           (id, email, password_hash, rol, tema, idioma, fecha_registro, activo, email_verificado)
           VALUES (?, ?, ?, ?, 'CLARO', 'ES', ?, 1, 0)`,
        )
        .bind(id, emailNorm, hash, rolValue, now),
      perfilStmt,
    ]);

    return ok(c, { id, email: emailNorm, rol: rolValue }, 201);
  } catch {
    return err(c, 'Error al registrar usuario', 500);
  }
});

router.post('/login', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { email, password, plataforma } = body;

  if (!email || typeof email !== 'string') return err(c, 'Email requerido', 400);
  if (!password || typeof password !== 'string') return err(c, 'Contraseña requerida', 400);

  const plataformaValue: Plataforma =
    typeof plataforma === 'string' && PLATAFORMAS.includes(plataforma as Plataforma)
      ? (plataforma as Plataforma)
      : 'WEB';

  try {
    const usuario = await c.env.DB
      .prepare(
        'SELECT id, email, password_hash, rol, activo FROM usuario WHERE email = ? AND activo = 1',
      )
      .bind(email.toLowerCase().trim())
      .first<{
        id: string;
        email: string;
        password_hash: string | null;
        rol: Rol;
        activo: 0 | 1;
      }>();

    const hashToVerify = usuario?.password_hash ?? DUMMY_HASH;
    const valid = await verifyPassword(password, hashToVerify);
    if (!usuario || !usuario.password_hash) {
      return err(c, 'Credenciales inválidas', 401);
    }
    if (!valid) return err(c, 'Credenciales inválidas', 401);

    const sesionId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null;
    const userAgent = c.req.header('User-Agent') ?? null;

    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO sesion
           (id, usuario_id, user_agent, ip, plataforma, fecha_creacion, fecha_expiracion, revocada)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .bind(sesionId, usuario.id, userAgent, ip, plataformaValue, now, now + REFRESH_TTL),
      c.env.DB
        .prepare('UPDATE usuario SET ultima_sesion = ? WHERE id = ?')
        .bind(now, usuario.id),
    ]);

    const [accessToken, refreshToken] = await Promise.all([
      signAccess(usuario.id, usuario.rol, sesionId, c.env.JWT_SECRET),
      signRefresh(usuario.id, sesionId, c.env.JWT_SECRET),
    ]);

    return ok(c, {
      accessToken,
      refreshToken,
      user: { id: usuario.id, email: usuario.email, rol: usuario.rol },
    });
  } catch {
    return err(c, 'Error al iniciar sesión', 500);
  }
});

router.post('/logout', authMiddleware, async (c) => {
  try {
    await c.env.DB
      .prepare('UPDATE sesion SET revocada = 1 WHERE id = ?')
      .bind(c.get('sesionId'))
      .run();
    return ok(c, { message: 'Sesión cerrada correctamente' });
  } catch {
    return err(c, 'Error al cerrar sesión', 500);
  }
});

router.post('/refresh', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { refreshToken } = body;
  if (!refreshToken || typeof refreshToken !== 'string') {
    return err(c, 'refreshToken requerido', 400);
  }

  try {
    const payload = await verifyRefresh(refreshToken, c.env.JWT_SECRET);

    const sesion = await c.env.DB
      .prepare('SELECT usuario_id, revocada FROM sesion WHERE id = ?')
      .bind(payload.sid)
      .first<{ usuario_id: string; revocada: 0 | 1 }>();

    if (!sesion || sesion.revocada === 1) {
      return err(c, 'Sesión inválida o revocada', 401);
    }

    const usuario = await c.env.DB
      .prepare('SELECT rol FROM usuario WHERE id = ? AND activo = 1')
      .bind(sesion.usuario_id)
      .first<{ rol: Rol }>();

    if (!usuario) return err(c, 'Usuario no encontrado o inactivo', 401);

    const accessToken = await signAccess(
      sesion.usuario_id,
      usuario.rol,
      payload.sid,
      c.env.JWT_SECRET,
    );

    return ok(c, { accessToken });
  } catch {
    return err(c, 'Refresh token inválido o expirado', 401);
  }
});


const GOOGLE_SCOPES = 'openid email profile';

router.get('/google', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) return err(c, 'Google OAuth no configurado', 503);

  const redirectUri = `${c.env.WORKER_BASE_URL}/api/auth/google/callback`;
  const state = crypto.randomUUID(); // CSRF token básico

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'online');

  return ok(c, { url: url.toString(), state });
});

router.get('/google/callback', async (c) => {
  const clientId     = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  const frontendUrl  = c.env.FRONTEND_URL ?? 'http://localhost:5173';

  if (!clientId || !clientSecret) return err(c, 'Google OAuth no configurado', 503);

  const code  = c.req.query('code');
  const error = c.req.query('error');

  if (error || !code) {
    return Response.redirect(`${frontendUrl}/login?oauth_error=${encodeURIComponent(error ?? 'cancelled')}`, 302);
  }

  try {
    const redirectUri = `${c.env.WORKER_BASE_URL}/api/auth/google/callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const googleErr = await tokenRes.json().catch(() => ({})) as Record<string, unknown>;
      console.error('[OAuth] token_exchange error:', JSON.stringify(googleErr));
      return Response.redirect(`${frontendUrl}/login?oauth_error=${encodeURIComponent((googleErr.error as string) ?? 'token_exchange_failed')}`, 302);
    }

    const tokens = await tokenRes.json() as { id_token?: string; access_token?: string };
    if (!tokens.id_token) {
      return Response.redirect(`${frontendUrl}/login?oauth_error=no_id_token`, 302);
    }

    // Obtener perfil del usuario de Google
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      return Response.redirect(`${frontendUrl}/login?oauth_error=userinfo_failed`, 302);
    }

    const googleUser = await userRes.json() as { sub: string; email: string; email_verified?: boolean };
    const { sub: googleSub, email } = googleUser;

    if (!email || !googleSub) {
      return Response.redirect(`${frontendUrl}/login?oauth_error=missing_email`, 302);
    }

    const emailNorm = email.toLowerCase().trim();

    let usuario = await c.env.DB
      .prepare('SELECT id, email, rol, activo FROM usuario WHERE google_sub = ?')
      .bind(googleSub)
      .first<{ id: string; email: string; rol: Rol; activo: 0 | 1 }>();

    if (!usuario) {
      usuario = await c.env.DB
        .prepare('SELECT id, email, rol, activo FROM usuario WHERE email = ?')
        .bind(emailNorm)
        .first<{ id: string; email: string; rol: Rol; activo: 0 | 1 }>();

      if (usuario) {
        await c.env.DB.prepare('UPDATE usuario SET google_sub = ? WHERE id = ?').bind(googleSub, usuario.id).run();
      }
    }

    let isNew = false;
    if (!usuario) {
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      await c.env.DB
        .prepare(`INSERT INTO usuario (id, email, password_hash, google_sub, rol, tema, idioma, fecha_registro, activo, email_verificado) VALUES (?, ?, NULL, ?, 'TECNICO', 'CLARO', 'ES', ?, 1, 1)`)
        .bind(id, emailNorm, googleSub, now)
        .run();
      usuario = { id, email: emailNorm, rol: 'TECNICO', activo: 1 };
      isNew = true;
    }

    if (!usuario.activo) {
      return Response.redirect(`${frontendUrl}/login?oauth_error=account_disabled`, 302);
    }

    // Crear sesión
    const sesionId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const ip = c.req.header('CF-Connecting-IP') ?? null;
    const userAgent = c.req.header('User-Agent') ?? null;

    await c.env.DB.batch([
      c.env.DB
        .prepare(`INSERT INTO sesion (id, usuario_id, user_agent, ip, plataforma, fecha_creacion, fecha_expiracion, revocada) VALUES (?, ?, ?, ?, 'WEB', ?, ?, 0)`)
        .bind(sesionId, usuario.id, userAgent, ip, now, now + REFRESH_TTL),
      c.env.DB
        .prepare('UPDATE usuario SET ultima_sesion = ? WHERE id = ?')
        .bind(now, usuario.id),
    ]);

    const [accessToken, refreshToken] = await Promise.all([
      signAccess(usuario.id, usuario.rol, sesionId, c.env.JWT_SECRET),
      signRefresh(usuario.id, sesionId, c.env.JWT_SECRET),
    ]);

    // Redirigir al frontend con tokens
    const callbackUrl = new URL(`${frontendUrl}/oauth-callback`);
    callbackUrl.searchParams.set('accessToken', accessToken);
    callbackUrl.searchParams.set('refreshToken', refreshToken);
    callbackUrl.searchParams.set('id', usuario.id);
    callbackUrl.searchParams.set('email', usuario.email);
    callbackUrl.searchParams.set('rol', usuario.rol);
    if (isNew) callbackUrl.searchParams.set('is_new', '1');

    return Response.redirect(callbackUrl.toString(), 302);
  } catch {
    return Response.redirect(`${frontendUrl}/login?oauth_error=server_error`, 302);
  }
});

router.delete('/me', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const now = Math.floor(Date.now() / 1000);
  try {
    await c.env.DB.batch([
      c.env.DB
        .prepare('UPDATE usuario SET activo = 0, fecha_eliminacion = ? WHERE id = ?')
        .bind(now, userId),
      c.env.DB
        .prepare('UPDATE sesion SET revocada = 1 WHERE usuario_id = ?')
        .bind(userId),
    ]);
    return ok(c, { message: 'Cuenta eliminada. Tienes 30 días para restaurarla en /api/auth/restore.' });
  } catch {
    return err(c, 'Error al eliminar la cuenta', 500);
  }
});

router.post('/restore', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { email, password } = body;
  if (!email || typeof email !== 'string') return err(c, 'Email requerido', 400);
  if (!password || typeof password !== 'string') return err(c, 'Contraseña requerida', 400);

  try {
    const usuario = await c.env.DB
      .prepare('SELECT id, email, password_hash, rol, activo, fecha_eliminacion FROM usuario WHERE email = ?')
      .bind(email.toLowerCase().trim())
      .first<{ id: string; email: string; password_hash: string | null; rol: Rol; activo: 0 | 1; fecha_eliminacion: number | null }>();

    const hashToVerify = usuario?.password_hash ?? DUMMY_HASH;
    const valid = await verifyPassword(password, hashToVerify);

    if (!usuario || !usuario.password_hash || !valid) {
      return err(c, 'Credenciales inválidas', 401);
    }
    if (usuario.activo === 1) {
      return err(c, 'La cuenta está activa, no necesita restauración', 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const TREINTA_DIAS = 30 * 24 * 60 * 60;
    if (!usuario.fecha_eliminacion || now - usuario.fecha_eliminacion > TREINTA_DIAS) {
      return err(c, 'El período de gracia de 30 días ha expirado', 400);
    }

    const sesionId = crypto.randomUUID();
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null;
    const userAgent = c.req.header('User-Agent') ?? null;

    await c.env.DB.batch([
      c.env.DB
        .prepare('UPDATE usuario SET activo = 1, fecha_eliminacion = NULL, ultima_sesion = ? WHERE id = ?')
        .bind(now, usuario.id),
      c.env.DB
        .prepare(
          `INSERT INTO sesion (id, usuario_id, user_agent, ip, plataforma, fecha_creacion, fecha_expiracion, revocada)
           VALUES (?, ?, ?, ?, 'WEB', ?, ?, 0)`,
        )
        .bind(sesionId, usuario.id, userAgent, ip, now, now + REFRESH_TTL),
    ]);

    const [accessToken, refreshToken] = await Promise.all([
      signAccess(usuario.id, usuario.rol, sesionId, c.env.JWT_SECRET),
      signRefresh(usuario.id, sesionId, c.env.JWT_SECRET),
    ]);

    return ok(c, {
      message: 'Cuenta restaurada correctamente',
      accessToken,
      refreshToken,
      user: { id: usuario.id, email: usuario.email, rol: usuario.rol },
    });
  } catch {
    return err(c, 'Error al restaurar la cuenta', 500);
  }
});

router.post('/onboarding', authMiddleware, async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return err(c, 'Cuerpo JSON inválido', 400);
  }

  const { rol, nombre } = body;
  if (!rol || !ROLES_REGISTRABLES.includes(rol as Rol)) {
    return err(c, `rol debe ser EMPRESA o TECNICO`, 400);
  }
  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
    return err(c, 'nombre requerido', 400);
  }

  const userId = c.get('userId');
  const rolValue = rol as Rol;
  const nombreTrim = (nombre as string).trim();

  try {
    if (rolValue === 'TECNICO') {
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE usuario SET rol = ? WHERE id = ?').bind('TECNICO', userId),
        c.env.DB.prepare(
          'INSERT INTO perfil_tecnico (usuario_id, nombre_completo) VALUES (?, ?) ON CONFLICT(usuario_id) DO UPDATE SET nombre_completo = excluded.nombre_completo',
        ).bind(userId, nombreTrim),
      ]);
    } else {
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE usuario SET rol = ? WHERE id = ?').bind('EMPRESA', userId),
        c.env.DB.prepare('DELETE FROM perfil_tecnico WHERE usuario_id = ?').bind(userId),
        c.env.DB.prepare(
          'INSERT INTO perfil_empresa (usuario_id, razon_social) VALUES (?, ?) ON CONFLICT(usuario_id) DO UPDATE SET razon_social = excluded.razon_social',
        ).bind(userId, nombreTrim),
      ]);
    }

    const sesionId = c.get('sesionId');
    const newAccessToken = await signAccess(userId, rolValue, sesionId, c.env.JWT_SECRET);

    return ok(c, { accessToken: newAccessToken, rol: rolValue });
  } catch {
    return err(c, 'Error al completar el perfil', 500);
  }
});

export default router;
