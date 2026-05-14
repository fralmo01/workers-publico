import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../src/index';
import schema from '../db/modelo.sql';
import migration003 from '../db/migrations/003_email_profesional.sql';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

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

  const migStmts = migration003
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  await env.DB.batch(migStmts.map((s) => env.DB.prepare(s)));
});

// ─── Helpers ────────────────────────────────────────────────────────────────

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

async function get(path: string, headers: Record<string, string> = {}) {
  return request(path, { headers });
}

async function del(path: string, headers: Record<string, string> = {}) {
  return request(path, { method: 'DELETE', headers });
}

async function registerAndLogin(email: string, password: string, rol: 'EMPRESA' | 'TECNICO') {
  await post('/api/auth/register', { email, password, rol });
  const loginRes = await post('/api/auth/login', { email, password });
  const { data } = await loginRes.json() as {
    data: { accessToken: string; user: { id: string } };
  };
  return { accessToken: data.accessToken, userId: data.user.id };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ─── Tests — Favoritos ───────────────────────────────────────────────────────

describe('Favoritos — guardar', () => {
  it('empresa guarda tecnico como favorito → 201 TECNICO_GUARDADO', async () => {
    const { accessToken: tokE } = await registerAndLogin('fav-emp-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('fav-emp-t@t.pe', 'password123', 'TECNICO');

    const res = await post('/api/favoritos', { objetivo_id: tecId, tipo: 'TECNICO_GUARDADO' }, auth(tokE));
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; data: { tipo: string } };
    expect(body.success).toBe(true);
    expect(body.data.tipo).toBe('TECNICO_GUARDADO');
  });

  it('tecnico guarda empresa como favorita → 201 EMPRESA_GUARDADA', async () => {
    const { userId: empId } = await registerAndLogin('fav-tec-e@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokT } = await registerAndLogin('fav-tec-t@t.pe', 'password123', 'TECNICO');

    const res = await post('/api/favoritos', { objetivo_id: empId, tipo: 'EMPRESA_GUARDADA' }, auth(tokT));
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { tipo: string } };
    expect(body.data.tipo).toBe('EMPRESA_GUARDADA');
  });

  it('empresa intenta guardar con tipo EMPRESA_GUARDADA → 400 (tipo incoherente con rol)', async () => {
    const { accessToken: tokE } = await registerAndLogin('fav-tipo-e@t.pe', 'password123', 'EMPRESA');
    const { userId: empId2 } = await registerAndLogin('fav-tipo-e2@t.pe', 'password123', 'EMPRESA');

    const res = await post('/api/favoritos', { objetivo_id: empId2, tipo: 'EMPRESA_GUARDADA' }, auth(tokE));
    expect(res.status).toBe(400);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });

  it('tecnico intenta guardar con tipo TECNICO_GUARDADO → 400 (tipo incoherente con rol)', async () => {
    const { accessToken: tokT } = await registerAndLogin('fav-tipo-t@t.pe', 'password123', 'TECNICO');
    const { userId: tecId2 } = await registerAndLogin('fav-tipo-t2@t.pe', 'password123', 'TECNICO');

    const res = await post('/api/favoritos', { objetivo_id: tecId2, tipo: 'TECNICO_GUARDADO' }, auth(tokT));
    expect(res.status).toBe(400);
  });

  it('objetivo con perfil incorrecto → 404', async () => {
    const { accessToken: tokE } = await registerAndLogin('fav-rol-e@t.pe', 'password123', 'EMPRESA');
    const { userId: empId2 } = await registerAndLogin('fav-rol-e2@t.pe', 'password123', 'EMPRESA');

    // empresa (tipo TECNICO_GUARDADO es válido para EMPRESA) pero objetivo es otra empresa
    // → no tiene perfil_tecnico → 404
    const res = await post('/api/favoritos', { objetivo_id: empId2, tipo: 'TECNICO_GUARDADO' }, auth(tokE));
    expect(res.status).toBe(404);
  });

  it('favorito duplicado → 409', async () => {
    const { accessToken: tokE } = await registerAndLogin('fav-dup-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('fav-dup-t@t.pe', 'password123', 'TECNICO');

    await post('/api/favoritos', { objetivo_id: tecId, tipo: 'TECNICO_GUARDADO' }, auth(tokE));
    const res = await post('/api/favoritos', { objetivo_id: tecId, tipo: 'TECNICO_GUARDADO' }, auth(tokE));
    expect(res.status).toBe(409);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });
});

describe('Favoritos — listar', () => {
  it('lista solo los favoritos del usuario autenticado', async () => {
    const { accessToken: tokA } = await registerAndLogin('fav-list-a@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokB } = await registerAndLogin('fav-list-b@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId1 } = await registerAndLogin('fav-list-t1@t.pe', 'password123', 'TECNICO');
    const { userId: tecId2 } = await registerAndLogin('fav-list-t2@t.pe', 'password123', 'TECNICO');

    await post('/api/favoritos', { objetivo_id: tecId1, tipo: 'TECNICO_GUARDADO' }, auth(tokA));
    await post('/api/favoritos', { objetivo_id: tecId2, tipo: 'TECNICO_GUARDADO' }, auth(tokB));

    const res = await get('/api/favoritos', auth(tokA));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });
});

describe('Favoritos — eliminar', () => {
  it('dueño puede eliminar su favorito', async () => {
    const { accessToken: tokE } = await registerAndLogin('fav-del-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('fav-del-t@t.pe', 'password123', 'TECNICO');

    const { data: { id } } = await (
      await post('/api/favoritos', { objetivo_id: tecId, tipo: 'TECNICO_GUARDADO' }, auth(tokE))
    ).json() as { data: { id: string } };

    expect((await del(`/api/favoritos/${id}`, auth(tokE))).status).toBe(200);

    const check = await get('/api/favoritos', auth(tokE));
    const body = await check.json() as { data: unknown[] };
    expect(body.data.length).toBe(0);
  });

  it('otro usuario no puede eliminar favorito ajeno → 403', async () => {
    const { accessToken: tokA } = await registerAndLogin('fav-del2-a@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokB } = await registerAndLogin('fav-del2-b@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('fav-del2-t@t.pe', 'password123', 'TECNICO');

    const { data: { id } } = await (
      await post('/api/favoritos', { objetivo_id: tecId, tipo: 'TECNICO_GUARDADO' }, auth(tokA))
    ).json() as { data: { id: string } };

    const res = await del(`/api/favoritos/${id}`, auth(tokB));
    expect(res.status).toBe(403);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });
});

// ─── Tests — Recomendaciones ─────────────────────────────────────────────────

describe('Recomendaciones — crear', () => {
  it('empresa recomienda tecnico → 201', async () => {
    const { accessToken: tokE } = await registerAndLogin('rec-cre-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('rec-cre-t@t.pe', 'password123', 'TECNICO');

    const res = await post('/api/recomendaciones', { tecnico_id: tecId }, auth(tokE));
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { empresa_id: string; tecnico_id: string } };
    expect(body.data.tecnico_id).toBe(tecId);
  });

  it('recomendar dos veces es idempotente → 200 la segunda vez', async () => {
    const { accessToken: tokE } = await registerAndLogin('rec-dup-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('rec-dup-t@t.pe', 'password123', 'TECNICO');

    await post('/api/recomendaciones', { tecnico_id: tecId }, auth(tokE));
    const res = await post('/api/recomendaciones', { tecnico_id: tecId }, auth(tokE));
    expect(res.status).toBe(200);
    expect((await res.json() as { success: boolean }).success).toBe(true);
  });

  it('tecnico no puede recomendar → 403', async () => {
    const { accessToken: tokT } = await registerAndLogin('rec-tec-t@t.pe', 'password123', 'TECNICO');
    const { userId: tecId2 } = await registerAndLogin('rec-tec-t2@t.pe', 'password123', 'TECNICO');

    const res = await post('/api/recomendaciones', { tecnico_id: tecId2 }, auth(tokT));
    expect(res.status).toBe(403);
  });

  it('tecnico_id inexistente → 404', async () => {
    const { accessToken: tokE } = await registerAndLogin('rec-notec-e@t.pe', 'password123', 'EMPRESA');
    const res = await post('/api/recomendaciones', { tecnico_id: 'no-existe' }, auth(tokE));
    expect(res.status).toBe(404);
  });
});

describe('Recomendaciones — eliminar', () => {
  it('empresa puede quitar recomendacion propia', async () => {
    const { accessToken: tokE } = await registerAndLogin('rec-del-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('rec-del-t@t.pe', 'password123', 'TECNICO');

    await post('/api/recomendaciones', { tecnico_id: tecId }, auth(tokE));
    const res = await del(`/api/recomendaciones/${tecId}`, auth(tokE));
    expect(res.status).toBe(200);
  });

  it('quitar recomendacion inexistente → 404', async () => {
    const { accessToken: tokE } = await registerAndLogin('rec-del2-e@t.pe', 'password123', 'EMPRESA');
    const res = await del('/api/recomendaciones/no-existe-uuid', auth(tokE));
    expect(res.status).toBe(404);
  });
});
