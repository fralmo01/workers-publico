import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('App — routing', () => {
  it('responde 404 en rutas inexistentes', async () => {
    const req = new IncomingRequest('http://localhost/ruta-que-no-existe');
    const ctx = createExecutionContext();
    const res = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    const body = await res.json() as { success: boolean; error: string };
    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });
});
