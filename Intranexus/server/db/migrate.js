import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { databaseConfigured, requirePool } from './pool.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations() {
  if (!databaseConfigured) throw new Error('EXTERNAL_POSTGRES_URL is not configured.');
  const pool = requirePool();
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(migrationsDir)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    for (const name of files) {
      const alreadyApplied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (alreadyApplied.rowCount) continue;
      const sql = await readFile(path.join(migrationsDir, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(814273190)');
        const recheck = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
        if (!recheck.rowCount) {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
          console.info(`Applied migration ${name}`);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }
    console.info('PostgreSQL migrations are up to date.');
  } finally {
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!databaseConfigured) {
    console.error('Migration paused: EXTERNAL_POSTGRES_URL is not configured. No schema changes were made.');
    process.exitCode = 2;
  } else {
    runMigrations().then(() => requirePool().end()).catch(async (error) => {
      console.error(`Migration failed (${error?.code || error?.name || 'unknown error'}). No credentials or SQL values were logged.`);
      process.exitCode = 1;
      await requirePool().end().catch(() => {});
    });
  }
}
