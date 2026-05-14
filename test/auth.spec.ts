import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../src/index';
import schema from '../db/modelo.sql';
import migration003 from '../db/migrations/003_email_profesional.sql';
import migration004 from '../db/migrations/004_redes_categorias.sql';
import migration005 from '../db/migrations/005_postulaciones.sql';
import migration006 from '../db/migrations/006_certificados.sql';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function applySQL(sql: string) {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// D1 local (Miniflare) no soporta exec() multi-sentencia; dividir por ";" y ejecutar en batches.
beforeAll(async () => {
  const statements = schema
    .replace(/PRAGMA[^;]+;/g, '')
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const CHUNK = 50;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await env.DB.batch(statements.slice(i, i + CHUNK).map((s) => env.DB.prepare(s)));
  }

  for (const mig of [migration003, migration004, migration005, migration006]) {
    const stmts = applySQL(mig);
    if (stmts.length > 0) await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function put(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function request(path: string, init?: RequestInit) {
  const req = new IncomingRequest(`http://localhost${path}`, init);
  const ctx = createExecutionContext();
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function registerUser(email: string, password: string, rol: 'EMPRESA' | 'TECNICO') {
  return post('/api/auth/register', { email, password, rol });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Auth — register', () => {
  const password = 'password123';

  it('crea usuario + perfil_empresa correctamente', async () => {
    const res = await registerUser('empresa-1@prolink.pe', password, 'EMPRESA');
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; data: { id: string; email: string; rol: string } };
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('empresa-1@prolink.pe');
    expect(body.data.rol).toBe('EMPRESA');

    const perfil = await env.DB
      .prepare('SELECT usuario_id FROM perfil_empresa WHERE usuario_id = ?')
      .bind(body.data.id)
      .first();
    expect(perfil).not.toBeNull();
  });

  // Cada test parte del estado de beforeAll (sin usuarios), por eso creamos el usuario
  // dentro del mismo test antes de intentar el duplicado.
  it('email duplicado → 409', async () => {
    const email = 'empresa-dup@prolink.pe';
    const first = await registerUser(email, password, 'EMPRESA');
    expect(first.status).toBe(201);

    const second = await registerUser(email, password, 'EMPRESA');
    expect(second.status).toBe(409);
    const body = await second.json() as { success: boolean };
    expect(body.success).toBe(false);
  });

  it('crea usuario + perfil_tecnico correctamente', async () => {
    const res = await registerUser('tecnico-1@prolink.pe', password, 'TECNICO');
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; data: { id: string; rol: string } };
    expect(body.data.rol).toBe('TECNICO');

    const perfil = await env.DB
      .prepare('SELECT usuario_id FROM perfil_tecnico WHERE usuario_id = ?')
      .bind(body.data.id)
      .first();
    expect(perfil).not.toBeNull();
  });
});

describe('Auth — login', () => {
  const email = 'login-test@prolink.pe';
  const password = 'password123';

  it('credenciales correctas → JWT válido', async () => {
    await registerUser(email, password, 'EMPRESA');

    const res = await post('/api/auth/login', { email, password });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      data: { accessToken: string; refreshToken: string; user: { rol: string } };
    };
    expect(body.success).toBe(true);
    expect(body.data.accessToken.split('.').length).toBe(3);
    expect(body.data.refreshToken.split('.').length).toBe(3);
    expect(body.data.user.rol).toBe('EMPRESA');
  });

  it('contraseña incorrecta → 401', async () => {
    await registerUser(email, password, 'EMPRESA');

    const res = await post('/api/auth/login', { email, password: 'contraseña-incorrecta' });
    expect(res.status).toBe(401);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });
});

describe('Auth — endpoints protegidos', () => {
  it('sin token → 401', async () => {
    const res = await request('/api/perfil/me');
    expect(res.status).toBe(401);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });
});

describe('Catálogos — seed', () => {
  it('GET /api/categorias devuelve ≥10 categorías del seed', async () => {
    const res = await request('/api/categorias');
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(10);
  });
});

describe('Auth — timing oracle', () => {
  it('email no registrado → 401 (PBKDF2 se ejecuta igual)', async () => {
    const res = await post('/api/auth/login', {
      email: 'noexiste-timing@prolink.pe',
      password: 'password123',
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });
});

describe('Auth — usuario inactivo', () => {
  it('token válido pero usuario con activo=0 → 401', async () => {
    const email = 'inactivo@prolink.pe';
    const password = 'password123';
    await registerUser(email, password, 'EMPRESA');

    const loginRes = await post('/api/auth/login', { email, password });
    const { data: { accessToken } } = await loginRes.json() as {
      data: { accessToken: string };
    };

    await env.DB.prepare('UPDATE usuario SET activo = 0 WHERE email = ?').bind(email).run();

    const res = await request('/api/perfil/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });
});

describe('Perfil público — email_profesional', () => {
  const password = 'password123';

  it('GET /perfil/tecnico/:id no expone email de login', async () => {
    const regRes = await registerUser('pub-nomail@prolink.pe', password, 'TECNICO');
    const { data: { id } } = await regRes.json() as { data: { id: string } };

    const res = await request(`/api/perfil/tecnico/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect('email' in body.data).toBe(false);
  });

  it('GET /perfil/tecnico/:id expone email_profesional cuando está configurado', async () => {
    const email = 'pub-emailpro@prolink.pe';
    const regRes = await registerUser(email, password, 'TECNICO');
    const { data: { id } } = await regRes.json() as { data: { id: string } };

    const loginRes = await post('/api/auth/login', { email, password });
    const { data: { accessToken } } = await loginRes.json() as { data: { accessToken: string } };

    await put(
      '/api/perfil/tecnico',
      { nombre_completo: 'Test Tecnico', email_profesional: 'trabajo@empresa.pe' },
      { Authorization: `Bearer ${accessToken}` },
    );

    const res = await request(`/api/perfil/tecnico/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { perfil: { email_profesional?: string } } };
    expect(body.data.perfil?.email_profesional).toBe('trabajo@empresa.pe');
  });
});
