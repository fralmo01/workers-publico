import type { Context } from 'hono';

export const ok = <T>(c: Context, data: T, status: 200 | 201 = 200) =>
  c.json({ success: true, data }, status);

export const err = (
  c: Context,
  error: string,
  status: 400 | 401 | 403 | 404 | 409 | 500 = 400,
) => c.json({ success: false, error }, status);
