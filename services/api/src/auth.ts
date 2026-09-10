import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface AuthPrincipal {
  sub: string;
  email: string;
  exp: number;
}

export interface PublicAuthUser {
  id: string;
  email: string;
}

const tokenLifetimeSeconds = 24 * 60 * 60;

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function publicUser(user: AuthUser): PublicAuthUser {
  return { id: user.id, email: user.email };
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  const [algorithm, salt, encodedKey] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !encodedKey) return false;

  try {
    const expected = Buffer.from(encodedKey, 'hex');
    const actual = scryptSync(password, salt, expected.length, { N: 16_384, r: 8, p: 1 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function issueJwt(user: AuthUser, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): { token: string; expiresAt: string } {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = nowSeconds + tokenLifetimeSeconds;
  const payload = base64UrlEncode(JSON.stringify({ sub: user.id, email: user.email, iat: nowSeconds, exp }));
  const unsignedToken = `${header}.${payload}`;
  const signature = base64UrlEncode(createHmac('sha256', secret).update(unsignedToken).digest());
  return { token: `${unsignedToken}.${signature}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyJwt(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): AuthPrincipal | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return undefined;

  const [encodedHeader, encodedPayload, suppliedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !suppliedSignature) return undefined;
  try {
    const header = JSON.parse(base64UrlDecode(encodedHeader)) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return undefined;

    const expectedSignature = createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const actualSignature = Buffer.from(suppliedSignature, 'base64url');
    if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) return undefined;

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<AuthPrincipal>;
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || typeof payload.exp !== 'number') return undefined;
    if (!Number.isInteger(payload.exp) || payload.exp <= nowSeconds) return undefined;
    return { sub: payload.sub, email: payload.email, exp: payload.exp };
  } catch {
    return undefined;
  }
}
