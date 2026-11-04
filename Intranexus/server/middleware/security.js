import { randomBytes, timingSafeEqual } from 'node:crypto';
import { CSRF_COOKIE, sha256, sessionCookieOptions } from '../services/auth.js';
import { getCookie } from './auth.js';
import { databaseConfigured, requirePool } from '../db/pool.js';

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function issueCsrfToken(req, res, next) {
  const token = randomBytes(32).toString('base64url');
  const options = sessionCookieOptions();
  try {
    if (databaseConfigured && req.session?.tokenHash) {
      await requirePool().query('UPDATE user_sessions SET csrf_hash=$1 WHERE token_hash=$2 AND expires_at>now()', [sha256(token), req.session.tokenHash]);
    }
    res.cookie(CSRF_COOKIE, token, { ...options, httpOnly: false, maxAge: 1000 * 60 * 60 * 8 });
    res.json({ csrfToken: token });
  } catch (error) {
    next(error);
  }
}

export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookieToken = getCookie(req, CSRF_COOKIE);
  const headerToken = req.get('x-csrf-token') || '';
  if (!cookieToken || !headerToken || !constantTimeEqual(cookieToken, headerToken)) {
    return res.status(403).json({ error: 'csrf_validation_failed', message: 'Hindi napatunayan ang kahilingan. I-refresh ang pahina at subukan muli.' });
  }
  if (req.session?.csrfHash && sha256(headerToken) !== req.session.csrfHash) {
    return res.status(403).json({ error: 'csrf_validation_failed', message: 'Hindi napatunayan ang session token. I-refresh ang pahina at mag-sign in muli.' });
  }
  return next();
}

export function safeResponseHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  // Deliberately omit X-Frame-Options and CSP frame-ancestors so public Preview can be embedded.
  next();
}
