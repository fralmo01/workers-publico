import { Hono } from 'hono';
import type { HonoEnv, Rol, Plataforma } from '../types';
import { authMiddleware } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../lib/password';
import { signAccess, signRefresh, verifyRefresh, REFRESH_TTL } from '../lib/jwt';
import { ok, err } from '../lib/responses';

const ROLES_REGISTRABLES: Rol[] = ['EMPRESA', 'TECNICO'];
const PLATAFORMAS: Plataforma[] = ['WEB', 'ANDROID', 'IOS'];
// Hash ficticio para mantener tiempo constante cuando el email no existe (evitar timing oracle)
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

    // Crear usuario + perfil en un batch atómico
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

    // Siempre ejecutar PBKDF2 para mantener tiempo constante (evitar timing oracle)
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

// TODO(seguridad): implementar refresh token rotation antes de producción
// (emitir nuevo refreshToken + revocar el anterior en cada llamada)
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

// ── Google OAuth ────────────────────────────────────────────────────────────

const GOOGLE_SCOPES = 'openid email profile';

// GET /api/auth/google — devuelve la URL de autorización de Google
router.get('/google', (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) return err(c, 'Google OAuth no configurado', 503);

  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;
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

// GET /api/auth/google/callback — callback tras autenticación con Google
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
    const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;

    // Intercambiar código por tokens
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
      return Response.redirect(`${frontendUrl}/login?oauth_error=token_exchange_failed`, 302);
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

    // Buscar usuario por google_sub o email
    let usuario = await c.env.DB
      .prepare('SELECT id, email, rol, activo FROM usuario WHERE google_sub = ?')
      .bind(googleSub)
      .first<{ id: string; email: string; rol: Rol; activo: 0 | 1 }>();

    if (!usuario) {
      // Buscar por email (puede vincular cuenta existente)
      usuario = await c.env.DB
        .prepare('SELECT id, email, rol, activo FROM usuario WHERE email = ?')
        .bind(emailNorm)
        .first<{ id: string; email: string; rol: Rol; activo: 0 | 1 }>();

      if (usuario) {
        // Vincular google_sub al usuario existente
        await c.env.DB.prepare('UPDATE usuario SET google_sub = ? WHERE id = ?').bind(googleSub, usuario.id).run();
      }
    }

    if (!usuario) {
      // Nuevo usuario — por defecto rol TECNICO (puede cambiar en onboarding)
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.batch([
        c.env.DB
          .prepare(`INSERT INTO usuario (id, email, password_hash, google_sub, rol, tema, idioma, fecha_registro, activo, email_verificado) VALUES (?, ?, NULL, ?, 'TECNICO', 'CLARO', 'ES', ?, 1, 1)`)
          .bind(id, emailNorm, googleSub, now),
        c.env.DB
          .prepare('INSERT INTO perfil_tecnico (usuario_id, nombre_completo) VALUES (?, ?)')
          .bind(id, emailNorm.split('@')[0]),
      ]);
      usuario = { id, email: emailNorm, rol: 'TECNICO', activo: 1 };
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

    return Response.redirect(callbackUrl.toString(), 302);
  } catch {
    return Response.redirect(`${frontendUrl}/login?oauth_error=server_error`, 302);
  }
});

export default router;
