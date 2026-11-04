import { databaseConfigured, requirePool } from '../db/pool.js';

const listeners = new Set();
let notificationClient = null;
let closed = false;
let reconnectTimer = null;

function broadcast(_payload) {
  const event = `event: update\ndata: ${JSON.stringify({ type: 'refresh', at: new Date().toISOString() })}\n\n`;
  for (const response of listeners) {
    if (response.destroyed || response.writableEnded) {
      listeners.delete(response);
      continue;
    }
    response.write(event);
  }
}

async function attachListener() {
  if (!databaseConfigured || closed || notificationClient) return;
  try {
    const client = await requirePool().connect();
    notificationClient = client;
    await client.query('LISTEN intranexus_updates');
    client.on('notification', (message) => {
      if (message.channel !== 'intranexus_updates' || !message.payload) return;
      try { broadcast(JSON.parse(message.payload)); } catch { broadcast({ type: 'refresh', at: new Date().toISOString() }); }
    });
    client.on('error', () => {
      if (notificationClient === client) notificationClient = null;
      client.release(true);
      scheduleReconnect();
    });
    client.on('end', () => {
      if (notificationClient === client) notificationClient = null;
      scheduleReconnect();
    });
  } catch (error) {
    console.warn(`Realtime database listener unavailable (${error?.code || error?.name || 'connection error'}).`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (closed || reconnectTimer || !databaseConfigured) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void attachListener();
  }, 5_000);
  reconnectTimer.unref?.();
}

export function startRealtimeListener() {
  void attachListener();
}

export function addSseClient(response) {
  listeners.add(response);
  response.write(`event: ready\ndata: ${JSON.stringify({ type: 'connected', at: new Date().toISOString() })}\n\n`);
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 25_000);
  heartbeat.unref?.();
  return () => {
    clearInterval(heartbeat);
    listeners.delete(response);
  };
}

export async function stopRealtimeListener() {
  closed = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (notificationClient) {
    notificationClient.removeAllListeners();
    notificationClient.release();
    notificationClient = null;
  }
  for (const response of listeners) response.end();
  listeners.clear();
}
