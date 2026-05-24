import type { JWTPayload, RefreshPayload, Rol } from '../types';

export const ACCESS_TTL = 15 * 60;          // 15 min
export const REFRESH_TTL = 30 * 24 * 3600;  // 30 días

const HEADER_B64 = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=/g, '');

function encodeB64url(data: string): string {
  const bytes = new TextEncoder().encode(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function decodeB64url(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + '='.repeat(pad));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bufToB64url(buf: ArrayBuffer): string {
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlToBuf(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + '='.repeat(pad));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signPayload<T extends object>(payload: T, secret: string): Promise<string> {
  const body = encodeB64url(JSON.stringify(payload));
  const data = `${HEADER_B64}.${body}`;
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${bufToB64url(sig)}`;
}

async function verifyToken<T extends { exp: number }>(
  token: string,
  secret: string,
): Promise<T> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid_token');
  const [header, body, sig] = parts;
  const key = await getKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlToBuf(sig),
    new TextEncoder().encode(`${header}.${body}`),
  );
  if (!valid) throw new Error('invalid_signature');
  const payload = JSON.parse(decodeB64url(body)) as T;
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('token_expired');
  return payload;
}

export async function signAccess(
  sub: string,
  rol: Rol,
  sid: string,
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signPayload<JWTPayload>({ sub, rol, sid, iat: now, exp: now + ACCESS_TTL }, secret);
}

export async function signRefresh(sub: string, sid: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signPayload<RefreshPayload>(
    { sub, sid, type: 'refresh', iat: now, exp: now + REFRESH_TTL },
    secret,
  );
}

export async function verifyAccess(token: string, secret: string): Promise<JWTPayload> {
  return verifyToken<JWTPayload>(token, secret);
}

export async function verifyRefresh(token: string, secret: string): Promise<RefreshPayload> {
  const payload = await verifyToken<RefreshPayload>(token, secret);
  if (payload.type !== 'refresh') throw new Error('wrong_token_type');
  return payload;
}
