import 'dotenv/config';
import { randomBytes } from 'crypto';

export interface ServerEntry {
  name: string;
  url: string;
  token: string;
}

function parseServers(): ServerEntry[] {
  const raw = process.env.SERVERS;
  if (!raw) {
    console.warn('[config] SERVERS env var not set — no Coolify servers configured yet.');
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('SERVERS must be a JSON array');
    return parsed.map((entry, i) => {
      if (!entry.name || !entry.url || !entry.token) {
        throw new Error(`SERVERS[${i}] must have name, url, and token`);
      }
      return { name: entry.name, url: String(entry.url).replace(/\/$/, ''), token: entry.token };
    });
  } catch (err) {
    console.error('[config] Failed to parse SERVERS env var as JSON:', (err as Error).message);
    return [];
  }
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  // Legacy SERVERS env var - only consulted once, to seed servers.json if
  // it doesn't exist yet (see serverStore.ensureBootstrapServers). Manage
  // servers from the UI after that.
  legacyServers: parseServers(),
  // Directory where users.json (accounts) is persisted. Mount this as a
  // Coolify persistent storage volume so accounts survive redeploys.
  dataDir: process.env.DATA_DIR ?? '/app/data',
  // Consulted only once, to create the very first account if none exists
  // yet. After that, log in and use the UI's "change password" instead.
  adminUsername: process.env.ADMIN_USERNAME ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  // Secret used to sign session tokens (HMAC). Set this explicitly in
  // production so sessions survive a redeploy; a random one is generated
  // per-process otherwise (which logs everyone out on every deploy).
  sessionSecret: process.env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7), // 7 days
};
