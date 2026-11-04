import { sha256, SESSION_COOKIE } from '../services/auth.js';
import { databaseConfigured, requirePool } from '../db/pool.js';

export function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      try { return decodeURIComponent(rawValue.join('=')); } catch { return ''; }
    }
  }
  return '';
}

export function sessionMiddleware() {
  return async (req, _res, next) => {
    req.user = null;
    req.session = null;
    if (!databaseConfigured) return next();
    const token = getCookie(req, SESSION_COOKIE);
    if (!token || token.length > 256) return next();
    try {
      const result = await requirePool().query(
        `SELECT s.token_hash, s.csrf_hash, s.expires_at,
                u.id, u.full_name, u.email, u.role, u.account_status
           FROM user_sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now()
            AND u.account_status = 'approved'`,
        [sha256(token)],
      );
      if (result.rowCount) {
        const row = result.rows[0];
        req.user = { id: row.id, fullName: row.full_name, email: row.email, role: row.role };
        req.session = { tokenHash: row.token_hash, csrfHash: row.csrf_hash, expiresAt: row.expires_at };
        void requirePool().query(
          `UPDATE user_sessions SET last_seen_at = now()
            WHERE token_hash = $1 AND last_seen_at < now() - interval '5 minutes'`,
          [row.token_hash],
        ).catch(() => {});
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'authentication_required', message: 'Mag-sign in upang magpatuloy.' });
  return next();
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required', message: 'Mag-sign in upang magpatuloy.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden', message: 'Wala kang pahintulot para sa aksiyong ito.' });
    return next();
  };
}
