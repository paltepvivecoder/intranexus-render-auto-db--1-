import { withTransaction, requirePool, databaseConfigured, pool } from '../db/pool.js';
import { hashPassword, normalizeEmail, newId } from '../services/auth.js';
import { writeAudit } from '../services/audit.js';

export async function bootstrapAdminFromEnvironment() {
  const fullName = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
  const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const configured = Boolean(fullName && email && password);
  if (!configured) return false;
  if (!databaseConfigured) throw new Error('Cannot create initial Admin without PostgreSQL.');
  if (fullName.length < 2 || fullName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 256) {
    throw new Error('Initial Admin settings are invalid; check name, email, and use a 12–256 character password.');
  }
  const passwordHash = await hashPassword(password);
  const userId = newId();
  let created = false;
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(814273191)');
    const admins = await client.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (admins.rowCount) return;
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) throw new Error('Bootstrap email already belongs to a non-admin account. Use another email.');
    await client.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, account_status, approved_at)
       VALUES ($1, $2, $3, $4, 'admin', 'approved', now())`,
      [userId, fullName, email, passwordHash],
    );
    await writeAudit(client, { actorId: userId, action: 'admin.bootstrap', entity: 'user', entityId: userId, changes: { role: 'admin', accountStatus: 'approved' } });
    created = true;
  });
  console.info(created ? 'Initial Admin account created.' : 'Admin account already exists; bootstrap skipped.');
  return created;
}

if (process.argv[1]?.endsWith('/server/scripts/bootstrap-admin.js')) {
  if (!databaseConfigured) {
    console.error('Admin bootstrap stopped: EXTERNAL_POSTGRES_URL is not configured.');
    process.exitCode = 1;
  } else {
    bootstrapAdminFromEnvironment().catch(async (error) => {
      console.error(`Admin bootstrap stopped (${error?.code || error?.name || 'configuration error'}). No credential values were logged.`);
      process.exitCode = 1;
      await pool?.end().catch(() => {});
    }).then(async () => { await pool?.end().catch(() => {}); });
  }
}
