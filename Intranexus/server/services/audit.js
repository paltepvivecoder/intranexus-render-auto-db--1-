export async function writeAudit(client, { actorId, action, entity, entityId, changes = {} }) {
  await client.query(
    `INSERT INTO audit_logs (actor_id, action, entity, entity_id, changes)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorId || null, action, entity, String(entityId), JSON.stringify(changes)],
  );
}

export async function publishChange(client, type, entityId = '') {
  const payload = JSON.stringify({ type, entityId: String(entityId), at: new Date().toISOString() });
  await client.query('SELECT pg_notify($1, $2)', ['intranexus_updates', payload]);
}
