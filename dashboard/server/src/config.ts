import 'dotenv/config';

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
  dashboardPassword: process.env.DASHBOARD_PASSWORD ?? '',
  servers: parseServers(),
};
