import { Router } from 'express';
import { withTransaction, requirePool } from '../db/pool.js';
import {
  emailAllowed, hashPassword, newId, newOpaqueToken, normalizeEmail,
  sessionExpiry, SESSION_COOKIE, sessionCookieOptions, sha256, verifyPassword,
} from '../services/auth.js';
import { writeAudit } from '../services/audit.js';
import { requireCsrf } from '../middleware/security.js';
import { databaseConfigured } from '../db/pool.js';

const publicRoles = new Set(['organizer', 'teacher', 'student']);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const router = Router();
const roleLabels = { admin: 'Admin', organizer: 'Committee/Organizer', teacher: 'Teacher', student: 'Student' };

function clientPayload(user) {
  return { id: user.id, fullName: user.full_name, email: user.email, role: roleLabels[user.role] || 'Student', accountStatus: user.account_status };
}

router.get('/session', (req, res) => {
  const user = req.user ? { id: req.user.id, fullName: req.user.fullName, email: req.user.email, role: roleLabels[req.user.role] || 'Student' } : null;
  res.json({ user, csrfToken: null, databaseConfigured });
});

router.post('/auth/register', requireCsrf, async (req, res, next) => {
  try {
    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const role = req.body?.role;
    if (fullName.length < 2 || fullName.length > 120 || !emailPattern.test(email) || email.length > 320 || !publicRoles.has(role)) {
      return res.status(400).json({ error: 'invalid_registration', message: 'Suriin ang pangalan, STI email, at account role.' });
    }
    if (!emailAllowed(email)) return res.status(400).json({ error: 'email_domain_not_allowed', message: 'Hindi kabilang ang email domain sa pinahihintulutang STI address.' });
    const passwordHash = await hashPassword(password);
    const userId = newId();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [userId, fullName, email, passwordHash, role],
      );
      await writeAudit(client, { actorId: null, action: 'account.registered', entity: 'user', entityId: userId, changes: { role, accountStatus: 'pending' } });
    });
    return res.status(201).json({ ok: true, accountStatus: 'pending', message: 'Naipasa ang registration. Hintayin ang pagsusuri at pag-apruba ng Admin bago mag-sign in.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'email_already_registered', message: 'May account na para sa email na ito.' });
    return next(error);
  }
});

router.post('/auth/login', requireCsrf, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!emailPattern.test(email) || typeof password !== 'string' || password.length > 256) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Hindi tama ang email o password.' });
    }
    const result = await requirePool().query(
      `SELECT id, full_name, email, role, account_status, password_hash
         FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    const row = result.rows[0];
    const passwordOk = await verifyPassword(password, row?.password_hash || '');
    if (!row || !passwordOk) return res.status(401).json({ error: 'invalid_credentials', message: 'Hindi tama ang email o password.' });
    if (row.account_status !== 'approved') {
      const pending = row.account_status === 'pending';
      return res.status(403).json({ error: pending ? 'account_pending_approval' : 'account_not_approved', message: pending ? 'Naghihintay pa ng Admin approval ang account.' : 'Hindi pa pinahihintulutan ang account na ito.' });
    }

    const rawSession = newOpaqueToken();
    const csrfToken = newOpaqueToken();
    const tokenHash = sha256(rawSession);
    const csrfHash = sha256(csrfToken);
    await withTransaction(async (client) => {
      await client.query('DELETE FROM user_sessions WHERE user_id = $1 AND expires_at <= now()', [row.id]);
      await client.query(
        `INSERT INTO user_sessions (token_hash, user_id, csrf_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [tokenHash, row.id, csrfHash, sessionExpiry()],
      );
      await writeAudit(client, { actorId: row.id, action: 'auth.login', entity: 'user', entityId: row.id });
    });
    const cookieOptions = sessionCookieOptions();
    res.cookie(SESSION_COOKIE, rawSession, cookieOptions);
    res.cookie('intranexus_csrf', csrfToken, { ...cookieOptions, httpOnly: false, maxAge: 1000 * 60 * 60 * 8 });
    return res.json({ user: clientPayload(row), csrfToken });
  } catch (error) {
    return next(error);
  }
});

router.post('/auth/logout', requireCsrf, async (req, res, next) => {
  try {
    if (req.session?.tokenHash) {
      await withTransaction(async (client) => {
        await client.query('DELETE FROM user_sessions WHERE token_hash = $1', [req.session.tokenHash]);
        await writeAudit(client, { actorId: req.user?.id, action: 'auth.logout', entity: 'user', entityId: req.user?.id || 'unknown' });
      });
    }
    const cookieOptions = sessionCookieOptions();
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
    res.clearCookie('intranexus_csrf', { ...cookieOptions, httpOnly: false, maxAge: undefined });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export default router;
