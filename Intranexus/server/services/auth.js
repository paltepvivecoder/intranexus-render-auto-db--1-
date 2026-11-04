import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const newId = () => randomUUID();
export const newOpaqueToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sessionExpiry = () => new Date(Date.now() + SESSION_TTL_MS);

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256) {
    const error = new Error('Password must be between 10 and 256 characters.');
    error.status = 400;
    error.code = 'INVALID_PASSWORD';
    throw error;
  }
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nText, rText, pText, salt, expectedHex] = parts;
  const N = Number(nText); const r = Number(rText); const p = Number(pText);
  if (!Number.isSafeInteger(N) || N < 16384 || N > 262144 || r !== 8 || p !== 1 || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expectedHex)) return false;
  try {
    const actual = Buffer.from(await scrypt(password, salt, 64, { N, r, p, maxmem: 128 * 1024 * 1024 }));
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

export function emailAllowed(email) {
  const configured = (process.env.ALLOWED_STI_EMAIL_DOMAINS || '')
    .split(',').map((domain) => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  if (!configured.length) return true;
  const domain = email.split('@')[1] || '';
  return configured.includes(domain);
}

export function sessionCookieOptions() {
  // Cloud Preview is HTTPS even when the app's internal request is HTTP.
  // Use an explicit toggle, never req.secure or NODE_ENV, for plain-HTTP local development.
  const secure = process.env.COOKIE_SECURE !== 'false';
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'None' : 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

export const SESSION_COOKIE = 'intranexus_session';
export const CSRF_COOKIE = 'intranexus_csrf';
