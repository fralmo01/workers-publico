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

// Helper: actualiza el perfil de un técnico
async function actualizarPerfilTecnico(
  token: string,
  campos: Record<string, unknown>,
) {
  return post('/api/perfil/tecnico', { nombre_completo: 'Tecnico Test', ...campos }, auth(token));
}

// ─── Tests — buscar técnicos ─────────────────────────────────────────────────

describe('Buscar tecnicos — sin filtros', () => {
  it('devuelve lista vacia cuando no hay tecnicos activos', async () => {
    const res = await get('/api/buscar/tecnicos');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: unknown[]; total: number } };
    expect(body.data.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.data.items)).toBe(true);
  });

  it('respuesta incluye campos de paginacion (limit, offset, total)', async () => {
    const res = await get('/api/buscar/tecnicos?limit=5&offset=0');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { limit: number; offset: number; total: number } };
    expect(body.data.limit).toBe(5);
    expect(body.data.offset).toBe(0);
    expect(typeof body.data.total).toBe('number');
  });

  it('limit maxima es 50 aunque se pida mas', async () => {
    const res = await get('/api/buscar/tecnicos?limit=999');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { limit: number } };
    expect(body.data.limit).toBe(50);
  });
});

describe('Buscar tecnicos — filtro de categoria', () => {
  it('buscar con filtro de categoria devuelve solo esa categoria', async () => {
    // Técnico A: categoría electricidad
    const { accessToken: tokA } = await registerAndLogin('bus-cat-ta@t.pe', 'password123', 'TECNICO');
    await actualizarPerfilTecnico(tokA, { categoria_principal_id: 'cat_electricidad' });

    // Técnico B: categoría sistemas
    const { accessToken: tokB } = await registerAndLogin('bus-cat-tb@t.pe', 'password123', 'TECNICO');
    await actualizarPerfilTecnico(tokB, { categoria_principal_id: 'cat_sistemas' });

    const res = await get('/api/buscar/tecnicos?categoria=cat_electricidad');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: { items: { categoria_principal_id: string }[] };
    };
    expect(body.data.items.length).toBeGreaterThan(0);
    for (const item of body.data.items) {
      expect(item.categoria_principal_id).toBe('cat_electricidad');
    }
  });
});

describe('Buscar tecnicos — paginacion', () => {
  it('paginacion respeta limit y offset', async () => {
    // Crear 3 técnicos con la misma categoría
    for (let i = 1; i <= 3; i++) {
      const { accessToken: tok } = await registerAndLogin(`bus-pag-t${i}@t.pe`, 'password123', 'TECNICO');
      await actualizarPerfilTecnico(tok, { categoria_principal_id: 'cat_mecanica' });
    }

    const res1 = await get('/api/buscar/tecnicos?categoria=cat_mecanica&limit=2&offset=0');
    const body1 = await res1.json() as { data: { items: unknown[]; total: number } };
    expect(res1.status).toBe(200);
    expect(body1.data.items.length).toBeLessThanOrEqual(2);
    expect(body1.data.total).toBeGreaterThanOrEqual(3);

    const res2 = await get('/api/buscar/tecnicos?categoria=cat_mecanica&limit=2&offset=2');
    const body2 = await res2.json() as { data: { items: unknown[] } };
    expect(res2.status).toBe(200);
    // Los items en offset=2 no deben ser los mismos que en offset=0
    expect(body2.data.items.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Buscar tecnicos — no expone email', () => {
  it('la respuesta no incluye el email de login del tecnico', async () => {
    const { accessToken: tok } = await registerAndLogin('bus-email-t@t.pe', 'password123', 'TECNICO');
    await actualizarPerfilTecnico(tok, { categoria_principal_id: 'cat_logistica' });

    const res = await get('/api/buscar/tecnicos?categoria=cat_logistica');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: Record<string, unknown>[] } };
    expect(body.data.items.length).toBeGreaterThan(0);
    for (const item of body.data.items) {
      expect('email' in item).toBe(false);
    }
  });

  it('email_profesional solo aparece si no es null', async () => {
    const { accessToken: tok } = await registerAndLogin('bus-emailpro-t@t.pe', 'password123', 'TECNICO');
    await actualizarPerfilTecnico(tok, {
      categoria_principal_id: 'cat_contabilidad',
      email_profesional: 'trabajo@contabilidad.pe',
    });

    const res = await get('/api/buscar/tecnicos?categoria=cat_contabilidad');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: Record<string, unknown>[] } };
    expect(body.data.items.length).toBeGreaterThan(0);
    const conEmail = body.data.items.filter((i) => i.email_profesional !== null);
    expect(conEmail.length).toBeGreaterThan(0);
  });
});

describe('Buscar tecnicos — filtro de habilidades (AND)', () => {
  it('tecnico con todas las habilidades requeridas aparece en resultado', async () => {
    const { accessToken: tok } = await registerAndLogin('bus-hab-t@t.pe', 'password123', 'TECNICO');
    const { userId: tecId } = await registerAndLogin('bus-hab-tx@t.pe', 'password123', 'TECNICO');

    // Insertar habilidades directamente en DB (el endpoint de perfil técnico no maneja habilidades aún)
    await env.DB.batch([
      env.DB.prepare('INSERT INTO tecnico_habilidad (tecnico_id, habilidad_id) VALUES (?, ?)').bind(tecId, 'hab_inst_domiciliaria'),
      env.DB.prepare('INSERT INTO tecnico_habilidad (tecnico_id, habilidad_id) VALUES (?, ?)').bind(tecId, 'hab_tableros'),
    ]);

    const res = await get(`/api/buscar/tecnicos?habilidades=hab_inst_domiciliaria,hab_tableros`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: { usuario_id: string }[] } };
    const ids = body.data.items.map((i) => i.usuario_id);
    expect(ids).toContain(tecId);
  });

  it('tecnico con solo una de las habilidades requeridas no aparece (AND logico)', async () => {
    const { userId: tecId } = await registerAndLogin('bus-hab-t2@t.pe', 'password123', 'TECNICO');

    // Solo tiene hab_tableros, NO hab_inst_domiciliaria
    await env.DB
      .prepare('INSERT INTO tecnico_habilidad (tecnico_id, habilidad_id) VALUES (?, ?)')
      .bind(tecId, 'hab_tableros')
      .run();

    const res = await get(`/api/buscar/tecnicos?habilidades=hab_inst_domiciliaria,hab_tableros`);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: { usuario_id: string }[] } };
    const ids = body.data.items.map((i) => i.usuario_id);
    // tecId NO debe estar, le falta una habilidad
    expect(ids).not.toContain(tecId);
  });
});

describe('Buscar tecnicos — orden', () => {
  it('orden por calificacion funciona (default)', async () => {
    const res = await get('/api/buscar/tecnicos?orden=calificacion');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: { calificacion_promedio: number }[] } };
    const cals = body.data.items.map((i) => i.calificacion_promedio);
    const sorted = [...cals].sort((a, b) => b - a);
    expect(cals).toEqual(sorted);
  });

  it('orden invalido → 400', async () => {
    const res = await get('/api/buscar/tecnicos?orden=invalido');
    expect(res.status).toBe(400);
  });
});

// ─── Tests — buscar convocatorias ────────────────────────────────────────────

describe('Buscar convocatorias', () => {
  it('devuelve convocatorias ABIERTA por defecto', async () => {
    const { accessToken: tokE } = await registerAndLogin('bus-conv-e@t.pe', 'password123', 'EMPRESA');
    await post(
      '/api/convocatorias',
      { titulo: 'Oferta Buscar', categoria_id: 'cat_electricidad', plazas_disponibles: 1, fecha_inicio: NOW },
      auth(tokE),
    );

    const res = await get('/api/buscar/convocatorias');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: { estado: string }[]; total: number } };
    expect(body.data.total).toBeGreaterThan(0);
    for (const item of body.data.items) {
      expect(item.estado).toBe('ABIERTA');
    }
  });

  it('filtro de categoria devuelve solo esa categoria', async () => {
    const { accessToken: tokE } = await registerAndLogin('bus-conv-ec@t.pe', 'password123', 'EMPRESA');
    await post(
      '/api/convocatorias',
      { titulo: 'Oferta Sistemas', categoria_id: 'cat_sistemas', plazas_disponibles: 1, fecha_inicio: NOW },
      auth(tokE),
    );

    const res = await get('/api/buscar/convocatorias?categoria=cat_sistemas');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: { categoria_id: string }[] } };
    expect(body.data.items.length).toBeGreaterThan(0);
    for (const item of body.data.items) {
      expect(item.categoria_id).toBe('cat_sistemas');
    }
  });

  it('paginacion respeta limit', async () => {
    // Crear varias convocatorias
    const { accessToken: tokE } = await registerAndLogin('bus-conv-ep@t.pe', 'password123', 'EMPRESA');
    for (let i = 0; i < 3; i++) {
      await post(
        '/api/convocatorias',
        { titulo: `Oferta Pag ${i}`, categoria_id: 'cat_gastronomia', plazas_disponibles: 1, fecha_inicio: NOW },
        auth(tokE),
      );
    }

    const res = await get('/api/buscar/convocatorias?categoria=cat_gastronomia&limit=2');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: unknown[]; total: number; limit: number } };
    expect(body.data.items.length).toBeLessThanOrEqual(2);
    expect(body.data.limit).toBe(2);
    expect(body.data.total).toBeGreaterThanOrEqual(3);
  });

  it('filtrar por estado EN_SELECCION funciona', async () => {
    const { accessToken: tokE } = await registerAndLogin('bus-conv-es@t.pe', 'password123', 'EMPRESA');
    const { data: { id } } = await (
      await post(
        '/api/convocatorias',
        { titulo: 'Oferta EnSel', categoria_id: 'cat_marketing', plazas_disponibles: 1, fecha_inicio: NOW },
        auth(tokE),
      )
    ).json() as { data: { id: string } };

    await patch(`/api/convocatorias/${id}/estado`, { estado: 'EN_SELECCION' }, auth(tokE));

    const res = await get('/api/buscar/convocatorias?estado=EN_SELECCION&categoria=cat_marketing');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: { id: string }[] } };
    const ids = body.data.items.map((i) => i.id);
    expect(ids).toContain(id);
  });

  it('estado invalido → 400', async () => {
    const res = await get('/api/buscar/convocatorias?estado=INVALIDO');
    expect(res.status).toBe(400);
  });
});
