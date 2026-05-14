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

async function patch(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
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

async function crearConvocatoria(token: string, plazas = 2) {
  const res = await post(
    '/api/convocatorias',
    { titulo: 'Oferta Test', categoria_id: 'cat_electricidad', plazas_disponibles: plazas, fecha_inicio: NOW },
    auth(token),
  );
  const { data } = await res.json() as { data: { id: string } };
  return data.id;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Colaboraciones — crear directa', () => {
  it('empresa crea colaboracion directa (sin convocatoria) → 201 EN_CURSO', async () => {
    const { accessToken: tokE } = await registerAndLogin('colab-dir-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('colab-dir-t@t.pe', 'password123', 'TECNICO');

    const res = await post(
      '/api/colaboraciones',
      { tecnico_id: tecId, fecha_inicio: NOW },
      auth(tokE),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { success: boolean; data: { estado: string; convocatoria_id: null } };
    expect(body.success).toBe(true);
    expect(body.data.estado).toBe('EN_CURSO');
    expect(body.data.convocatoria_id).toBeNull();
  });

  it('tecnico no puede crear colaboracion → 403', async () => {
    const { accessToken: tokT } = await registerAndLogin('colab-dir-t2@t.pe', 'password123', 'TECNICO');
    const { userId: tecId2 } = await registerAndLogin('colab-dir-t3@t.pe', 'password123', 'TECNICO');

    const res = await post(
      '/api/colaboraciones',
      { tecnico_id: tecId2, fecha_inicio: NOW },
      auth(tokT),
    );
    expect(res.status).toBe(403);
  });

  it('tecnico_id inexistente → 404', async () => {
    const { accessToken } = await registerAndLogin('colab-notec-e@t.pe', 'password123', 'EMPRESA');
    const res = await post(
      '/api/colaboraciones',
      { tecnico_id: 'no-existe-uuid', fecha_inicio: NOW },
      auth(accessToken),
    );
    expect(res.status).toBe(404);
  });
});

describe('Colaboraciones — desde convocatoria', () => {
  it('crear desde convocatoria descuenta una plaza', async () => {
    const { accessToken: tokE } = await registerAndLogin('colab-conv-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('colab-conv-t@t.pe', 'password123', 'TECNICO');

    const convId = await crearConvocatoria(tokE, 2);

    const res = await post(
      '/api/colaboraciones',
      { tecnico_id: tecId, convocatoria_id: convId, fecha_inicio: NOW },
      auth(tokE),
    );
    expect(res.status).toBe(201);

    const conv = await env.DB
      .prepare('SELECT plazas_ocupadas FROM convocatoria WHERE id = ?')
      .bind(convId)
      .first<{ plazas_ocupadas: number }>();
    expect(conv?.plazas_ocupadas).toBe(1);
  });

  it('crear cuando no hay plazas → 400', async () => {
    const { accessToken: tokE } = await registerAndLogin('colab-sinp-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId1 } = await registerAndLogin('colab-sinp-t1@t.pe', 'password123', 'TECNICO');
    const { userId: tecId2 } = await registerAndLogin('colab-sinp-t2@t.pe', 'password123', 'TECNICO');

    const convId = await crearConvocatoria(tokE, 1);

    // Ocupa la única plaza
    await post(
      '/api/colaboraciones',
      { tecnico_id: tecId1, convocatoria_id: convId, fecha_inicio: NOW },
      auth(tokE),
    );

    // Intento con plaza llena → 400
    const res = await post(
      '/api/colaboraciones',
      { tecnico_id: tecId2, convocatoria_id: convId, fecha_inicio: NOW },
      auth(tokE),
    );
    expect(res.status).toBe(400);
  });

  it('convocatoria de otra empresa → 403', async () => {
    const { accessToken: tokA } = await registerAndLogin('colab-ajena-a@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokB } = await registerAndLogin('colab-ajena-b@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('colab-ajena-t@t.pe', 'password123', 'TECNICO');

    const convId = await crearConvocatoria(tokA, 2);

    const res = await post(
      '/api/colaboraciones',
      { tecnico_id: tecId, convocatoria_id: convId, fecha_inicio: NOW },
      auth(tokB),
    );
    expect(res.status).toBe(403);
  });
});

describe('Colaboraciones — detalle', () => {
  it('empresa involucrada puede ver la colaboracion', async () => {
    const { accessToken: tokE } = await registerAndLogin('colab-det-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('colab-det-t@t.pe', 'password123', 'TECNICO');

    const { data: { id } } = await (
      await post('/api/colaboraciones', { tecnico_id: tecId, fecha_inicio: NOW }, auth(tokE))
    ).json() as { data: { id: string } };

    const res = await get(`/api/colaboraciones/${id}`, auth(tokE));
    expect(res.status).toBe(200);
  });

  it('tecnico involucrado puede ver la colaboracion', async () => {
    const { accessToken: tokE } = await registerAndLogin('colab-det-e2@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId, accessToken: tokT } = await registerAndLogin('colab-det-t2@t.pe', 'password123', 'TECNICO');

    const { data: { id } } = await (
      await post('/api/colaboraciones', { tecnico_id: tecId, fecha_inicio: NOW }, auth(tokE))
    ).json() as { data: { id: string } };

    const res = await get(`/api/colaboraciones/${id}`, auth(tokT));
    expect(res.status).toBe(200);
  });

  it('empresa ajena no puede ver la colaboracion → 403', async () => {
    const { accessToken: tokA } = await registerAndLogin('colab-ajen2-a@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokB } = await registerAndLogin('colab-ajen2-b@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('colab-ajen2-t@t.pe', 'password123', 'TECNICO');

    const { data: { id } } = await (
      await post('/api/colaboraciones', { tecnico_id: tecId, fecha_inicio: NOW }, auth(tokA))
    ).json() as { data: { id: string } };

    const res = await get(`/api/colaboraciones/${id}`, auth(tokB));
    expect(res.status).toBe(403);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });
});

describe('Colaboraciones — cambiar estado', () => {
  it('finalizar setea fecha_fin', async () => {
    const { accessToken: tokE } = await registerAndLogin('colab-fin-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('colab-fin-t@t.pe', 'password123', 'TECNICO');

    const { data: { id } } = await (
      await post('/api/colaboraciones', { tecnico_id: tecId, fecha_inicio: NOW }, auth(tokE))
    ).json() as { data: { id: string } };

    const res = await patch(`/api/colaboraciones/${id}/estado`, { estado: 'FINALIZADA' }, auth(tokE));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { estado: string; fecha_fin: number } };
    expect(body.data.estado).toBe('FINALIZADA');
    expect(typeof body.data.fecha_fin).toBe('number');
    expect(body.data.fecha_fin).toBeGreaterThan(0);
  });

  it('reabrir colaboracion FINALIZADA → 400', async () => {
    const { accessToken: tokE } = await registerAndLogin('colab-reab-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('colab-reab-t@t.pe', 'password123', 'TECNICO');

    const { data: { id } } = await (
      await post('/api/colaboraciones', { tecnico_id: tecId, fecha_inicio: NOW }, auth(tokE))
    ).json() as { data: { id: string } };

    await patch(`/api/colaboraciones/${id}/estado`, { estado: 'FINALIZADA' }, auth(tokE));

    const res = await patch(`/api/colaboraciones/${id}/estado`, { estado: 'EN_CURSO' }, auth(tokE));
    expect(res.status).toBe(400);
    expect((await res.json() as { success: boolean }).success).toBe(false);
  });

  it('tecnico puede cancelar su colaboracion', async () => {
    const { accessToken: tokE } = await registerAndLogin('colab-canc-e@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId, accessToken: tokT } = await registerAndLogin('colab-canc-t@t.pe', 'password123', 'TECNICO');

    const { data: { id } } = await (
      await post('/api/colaboraciones', { tecnico_id: tecId, fecha_inicio: NOW }, auth(tokE))
    ).json() as { data: { id: string } };

    const res = await patch(`/api/colaboraciones/${id}/estado`, { estado: 'CANCELADA' }, auth(tokT));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { estado: string; fecha_fin: number } };
    expect(body.data.estado).toBe('CANCELADA');
    expect(body.data.fecha_fin).toBeGreaterThan(0);
  });

  it('tercero no puede cambiar estado → 403', async () => {
    const { accessToken: tokA } = await registerAndLogin('colab-3ro-a@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokB } = await registerAndLogin('colab-3ro-b@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('colab-3ro-t@t.pe', 'password123', 'TECNICO');

    const { data: { id } } = await (
      await post('/api/colaboraciones', { tecnico_id: tecId, fecha_inicio: NOW }, auth(tokA))
    ).json() as { data: { id: string } };

    const res = await patch(`/api/colaboraciones/${id}/estado`, { estado: 'CANCELADA' }, auth(tokB));
    expect(res.status).toBe(403);
  });
});

describe('Colaboraciones — listar', () => {
  it('empresa ve solo sus colaboraciones', async () => {
    const { accessToken: tokA } = await registerAndLogin('colab-list-a@t.pe', 'password123', 'EMPRESA');
    const { accessToken: tokB } = await registerAndLogin('colab-list-b@t.pe', 'password123', 'EMPRESA');
    const { userId: tecId } = await registerAndLogin('colab-list-t@t.pe', 'password123', 'TECNICO');

    await post('/api/colaboraciones', { tecnico_id: tecId, fecha_inicio: NOW }, auth(tokA));
    await post('/api/colaboraciones', { tecnico_id: tecId, fecha_inicio: NOW }, auth(tokB));

    const res = await get('/api/colaboraciones', auth(tokA));
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });
});
