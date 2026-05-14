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

async function put(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
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

const NOW = Math.floor(Date.now() / 1000);
const convBase = {
  titulo: 'Técnico Electricista',
  categoria_id: 'cat_electricidad',
  plazas_disponibles: 2,
  fecha_inicio: NOW,
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Convocatorias — crear', () => {
  it('empresa crea convocatoria → 201 con estado ABIERTA', async () => {
    const { accessToken } = await registerAndLogin('conv-crear-e@t.pe', 'password123', 'EMPRESA');
    const res = await post('/api/convocatorias', convBase, auth(accessToken));
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; data: { id: string; estado: string } };
    expect(body.success).toBe(true);
    expect(body.data.estado).toBe('ABIERTA');
    expect(typeof body.data.id).toBe('string');
  });

  it('técnico intenta crear → 403', async () => {
    const { accessToken } = await registerAndLogin('conv-crear-t@t.pe', 'password123', 'TECNICO');
    const res = await post('/api/convocatorias', convBase, auth(accessToken));
    expect(res.status).toBe(403);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });

  it('sin autenticación → 401', async () => {
    const res = await post('/api/convocatorias', convBase);
    expect(res.status).toBe(401);
  });

  it('plazas_disponibles = 0 → 400', async () => {
    const { accessToken } = await registerAndLogin('conv-plaza0@t.pe', 'password123', 'EMPRESA');
    const res = await post('/api/convocatorias', { ...convBase, plazas_disponibles: 0 }, auth(accessToken));
    expect(res.status).toBe(400);
  });

  it('categoria_id inexistente → 400', async () => {
    const { accessToken } = await registerAndLogin('conv-catbad@t.pe', 'password123', 'EMPRESA');
    const res = await post('/api/convocatorias', { ...convBase, categoria_id: 'cat_xxx' }, auth(accessToken));
    expect(res.status).toBe(400);
  });

  it('fecha_fin menor que fecha_inicio → 400', async () => {
    const { accessToken } = await registerAndLogin('conv-fechas@t.pe', 'password123', 'EMPRESA');
    const res = await post(
      '/api/convocatorias',
      { ...convBase, fecha_fin: NOW - 1000 },
      auth(accessToken),
    );
    expect(res.status).toBe(400);
  });
});

describe('Convocatorias — detalle público', () => {
  it('GET /:id retorna datos sin autenticación', async () => {
    const { accessToken } = await registerAndLogin('conv-det-e@t.pe', 'password123', 'EMPRESA');
    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(accessToken))
    ).json() as { data: { id: string } };

    const res = await get(`/api/convocatorias/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { titulo: string } };
    expect(body.data.titulo).toBe('Técnico Electricista');
  });

  it('id inexistente → 404', async () => {
    const res = await get('/api/convocatorias/no-existe-uuid');
    expect(res.status).toBe(404);
  });
});

describe('Convocatorias — listar propias', () => {
  it('empresa obtiene solo sus convocatorias', async () => {
    const { accessToken: tokA } = await registerAndLogin('conv-list-a@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokB } = await registerAndLogin('conv-list-b@t.pe', 'password123', 'EMPRESA');

    await post('/api/convocatorias', { ...convBase, titulo: 'Oferta A' }, auth(tokA));
    await post('/api/convocatorias', { ...convBase, titulo: 'Oferta B' }, auth(tokB));

    const res = await get('/api/convocatorias', auth(tokA));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { titulo: string }[] };
    expect(body.data.length).toBe(1);
    expect(body.data[0].titulo).toBe('Oferta A');
  });
});

describe('Convocatorias — editar', () => {
  it('empresa dueña puede editar título', async () => {
    const { accessToken } = await registerAndLogin('conv-edit-a@t.pe', 'password123', 'EMPRESA');
    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(accessToken))
    ).json() as { data: { id: string } };

    const res = await put(
      `/api/convocatorias/${id}`,
      { ...convBase, titulo: 'Título Actualizado' },
      auth(accessToken),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { titulo: string } };
    expect(body.data.titulo).toBe('Título Actualizado');
  });

  it('empresa ajena no puede editar → 403', async () => {
    const { accessToken: tokA } = await registerAndLogin('conv-edit-b@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokB } = await registerAndLogin('conv-edit-c@t.pe', 'password123', 'EMPRESA');

    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(tokA))
    ).json() as { data: { id: string } };

    const res = await put(`/api/convocatorias/${id}`, { ...convBase, titulo: 'Hack' }, auth(tokB));
    expect(res.status).toBe(403);
  });
});

describe('Convocatorias — cambiar estado', () => {
  it('ABIERTA → EN_SELECCION es válido → 200', async () => {
    const { accessToken } = await registerAndLogin('conv-est-a@t.pe', 'password123', 'EMPRESA');
    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(accessToken))
    ).json() as { data: { id: string } };

    const res = await patch(`/api/convocatorias/${id}/estado`, { estado: 'EN_SELECCION' }, auth(accessToken));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { estado: string } };
    expect(body.data.estado).toBe('EN_SELECCION');
  });

  it('CERRADA → ABIERTA es transición inválida → 400', async () => {
    const { accessToken } = await registerAndLogin('conv-est-b@t.pe', 'password123', 'EMPRESA');
    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(accessToken))
    ).json() as { data: { id: string } };

    await patch(`/api/convocatorias/${id}/estado`, { estado: 'EN_SELECCION' }, auth(accessToken));
    await patch(`/api/convocatorias/${id}/estado`, { estado: 'CERRADA' }, auth(accessToken));

    const res = await patch(`/api/convocatorias/${id}/estado`, { estado: 'ABIERTA' }, auth(accessToken));
    expect(res.status).toBe(400);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });

  it('ABIERTA → CERRADA directo permitido (cancelación) → 200', async () => {
    const { accessToken } = await registerAndLogin('conv-est-c@t.pe', 'password123', 'EMPRESA');
    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(accessToken))
    ).json() as { data: { id: string } };

    const res = await patch(`/api/convocatorias/${id}/estado`, { estado: 'CERRADA' }, auth(accessToken));
    expect(res.status).toBe(200);
  });

  it('empresa ajena no puede cambiar estado → 403', async () => {
    const { accessToken: tokA } = await registerAndLogin('conv-est-d@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokB } = await registerAndLogin('conv-est-e@t.pe', 'password123', 'EMPRESA');

    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(tokA))
    ).json() as { data: { id: string } };

    const res = await patch(`/api/convocatorias/${id}/estado`, { estado: 'EN_SELECCION' }, auth(tokB));
    expect(res.status).toBe(403);
  });

  it('valor de estado inválido → 400', async () => {
    const { accessToken } = await registerAndLogin('conv-est-f@t.pe', 'password123', 'EMPRESA');
    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(accessToken))
    ).json() as { data: { id: string } };

    const res = await patch(`/api/convocatorias/${id}/estado`, { estado: 'INVALIDO' }, auth(accessToken));
    expect(res.status).toBe(400);
  });
});

describe('Convocatorias — eliminar', () => {
  it('eliminar convocatoria ABIERTA sin colaboraciones → 200', async () => {
    const { accessToken } = await registerAndLogin('conv-del-a@t.pe', 'password123', 'EMPRESA');
    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(accessToken))
    ).json() as { data: { id: string } };

    expect((await del(`/api/convocatorias/${id}`, auth(accessToken))).status).toBe(200);
    expect((await get(`/api/convocatorias/${id}`)).status).toBe(404);
  });

  it('no se puede eliminar convocatoria EN_SELECCION → 400', async () => {
    const { accessToken } = await registerAndLogin('conv-del-b@t.pe', 'password123', 'EMPRESA');
    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(accessToken))
    ).json() as { data: { id: string } };

    await patch(`/api/convocatorias/${id}/estado`, { estado: 'EN_SELECCION' }, auth(accessToken));

    const res = await del(`/api/convocatorias/${id}`, auth(accessToken));
    expect(res.status).toBe(400);
  });

  it('empresa ajena no puede eliminar → 403', async () => {
    const { accessToken: tokA } = await registerAndLogin('conv-del-c@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokB } = await registerAndLogin('conv-del-d@t.pe', 'password123', 'EMPRESA');

    const { data: { id } } = await (
      await post('/api/convocatorias', convBase, auth(tokA))
    ).json() as { data: { id: string } };

    const res = await del(`/api/convocatorias/${id}`, auth(tokB));
    expect(res.status).toBe(403);
  });
});
