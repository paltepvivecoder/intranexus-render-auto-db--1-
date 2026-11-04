import pg from 'pg';

const { Pool } = pg;
const dsn = process.env.EXTERNAL_POSTGRES_URL?.trim();

if (dsn && !/^postgres(?:ql)?:\/\//i.test(dsn)) {
  throw new Error('EXTERNAL_POSTGRES_URL must be a PostgreSQL connection URL.');
}

export const databaseConfigured = Boolean(dsn);
export const pool = dsn
  ? new Pool({
      connectionString: dsn,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'intranexus',
    })
  : null;

pool?.on('error', (error) => {
  // Do not print the DSN, SQL values, or a provider response that may contain secrets.
  console.error(`PostgreSQL pool error: ${error?.code || error?.name || 'unknown error'}`);
});

export function requirePool() {
  if (!pool) {
    const error = new Error('External PostgreSQL is not configured.');
    error.code = 'DATABASE_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  return pool;
}

export async function withTransaction(work) {
  const client = await requirePool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
