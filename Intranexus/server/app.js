import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseConfigured, pool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { bootstrapAdminFromEnvironment } from './scripts/bootstrap-admin.js';
import { sessionMiddleware, requireAuth } from './middleware/auth.js';
import { issueCsrfToken, requireCsrf, safeResponseHeaders } from './middleware/security.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/api.js';
import uploadRoutes from './routes/uploads.js';
import directoryRoutes from './routes/directory.js';
import { addSseClient, startRealtimeListener, stopRealtimeListener } from './services/realtime.js';

const app = express();
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(serverDirectory, '../public');
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(safeResponseHeaders);
app.use(express.json({ limit: '256kb', strict: true }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', async (_req, res) => {
  if (!databaseConfigured || !pool) {
    return res.status(503).json({ status: 'waiting_for_postgres', databaseConfigured: false });
  }
  try {
    const result = await pool.query(`SELECT to_regclass('public.users') AS users_table`);
    if (!result.rows[0]?.users_table) return res.status(503).json({ status: 'migrations_required', databaseConfigured: true });
    return res.json({ status: 'ready', databaseConfigured: true });
  } catch (error) {
    return res.status(503).json({ status: 'database_unavailable', databaseConfigured: true, code: error?.code || 'connection_error' });
  }
});

app.use('/api', sessionMiddleware());
app.get('/api/csrf', issueCsrfToken);
app.use('/api', requireCsrf);
app.use('/api', authRoutes);
app.use('/api', apiRoutes);
app.use('/api', uploadRoutes);
app.use('/api', directoryRoutes);

app.get('/api/realtime', requireAuth, (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const removeClient = addSseClient(res);
  req.on('close', removeClient);
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Hindi makita ang API route.' }));

app.use(express.static(publicDirectory, { index: false, fallthrough: true, maxAge: 0, dotfiles: 'deny' }));
app.get(/.*/, (req, res, next) => {
  if (req.path.includes('.') || !req.accepts('html')) return next();
  res.sendFile(path.join(publicDirectory, 'index.html'));
});
app.use((_req, res) => res.status(404).type('text').send('Not found'));

app.use((error, _req, res, _next) => {
  const code = error?.code;
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) console.error(`Request failed (${code || error?.name || 'internal_error'}).`);
  if (code === '23505') return res.status(409).json({ error: 'record_conflict', message: 'May kaparehong record na. Suriin ang inilagay at subukan muli.' });
  if (code === '23503') return res.status(400).json({ error: 'related_record_missing', message: 'Hindi makita ang kaugnay na event, team o account.' });
  if (code === 'DATABASE_NOT_CONFIGURED') return res.status(503).json({ error: 'database_not_configured', message: 'Hindi pa nakakonekta ang external PostgreSQL. Naka-hold muna ang database operation.' });
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409) {
    return res.status(status).json({ error: code || 'request_error', message: error.message || 'Hindi makumpleto ang kahilingan.' });
  }
  return res.status(status >= 500 ? status : 500).json({ error: 'service_unavailable', message: 'Hindi makumpleto ang operation sa ngayon. Subukan muli mamaya.' });
});

let server;
async function start() {
  if (databaseConfigured) {
    await runMigrations();
    await bootstrapAdminFromEnvironment();
  } else {
    console.warn('PostgreSQL is not configured; database features remain unavailable.');
  }
  server = app.listen(port, '0.0.0.0', () => {
    console.info(`Intranexus server listening on ${port}. PostgreSQL configured: ${databaseConfigured ? 'yes' : 'no'}.`);
    startRealtimeListener();
  });
}
start().catch(async (error) => {
  console.error(`Startup failed (${error?.code || error?.name || 'configuration error'}). No credential values were logged.`);
  await pool?.end().catch(() => {});
  process.exit(1);
});

async function shutdown() {
  await stopRealtimeListener();
  if (!server) { await pool?.end().catch(() => {}); return; }
  server.close(async () => {
    await pool?.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
