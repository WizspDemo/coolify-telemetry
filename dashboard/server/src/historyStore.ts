import { Pool } from 'pg';
import dns from 'dns';
import { config } from './config';

// Alpine's musl libc + Docker's embedded DNS (127.0.0.11) can resolve a
// Docker-network hostname's AAAA record first and time out before falling
// back to IPv4, surfacing as a flaky "getaddrinfo EAI_AGAIN" even though the
// host resolves fine moments later. Force IPv4-first resolution so pg's
// connections don't hit that race.
dns.setDefaultResultOrder('ipv4first');

/**
 * 24h-ish CPU/RAM/Disk history per server, for sparklines on the dashboard.
 * Stored in the Postgres instance the user already runs on the same
 * Coolify server (a self-hosted Supabase stack) instead of spinning up a
 * dedicated DB container or an unbounded in-memory array - the dashboard
 * container joins that Postgres's Docker network (see README) and talks to
 * it directly. If POSTGRES_HOST isn't set, history is silently disabled -
 * every other feature keeps working.
 */

export interface HistorySample {
  recordedAt: string;
  cpuPercent: number | null;
  memoryUsedPercent: number | null;
  diskUsedPercent: number | null;
}

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function isHistoryEnabled(): boolean {
  return Boolean(config.postgres.host);
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password,
      // Small pool - this is a handful of writes/reads per minute, not a
      // real app workload.
      max: 3,
      idleTimeoutMillis: 30_000,
    });
    pool.on('error', (err) => {
      console.error('[history] idle Postgres client error:', err.message);
    });
  }
  return pool;
}

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS telemetry_history (
           id BIGSERIAL PRIMARY KEY,
           server_id TEXT NOT NULL,
           server_name TEXT NOT NULL,
           cpu_percent REAL,
           memory_used_percent REAL,
           disk_used_percent REAL,
           recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
         );
         CREATE INDEX IF NOT EXISTS telemetry_history_server_time_idx
           ON telemetry_history (server_id, recorded_at DESC);`
      )
      .then(() => undefined);
  }
  return schemaReady;
}

export async function recordSample(
  serverId: string,
  serverName: string,
  cpuPercent: number | null,
  memoryUsedPercent: number | null,
  diskUsedPercent: number | null
): Promise<void> {
  if (!isHistoryEnabled()) return;
  try {
    await ensureSchema();
    await getPool().query(
      `INSERT INTO telemetry_history (server_id, server_name, cpu_percent, memory_used_percent, disk_used_percent)
       VALUES ($1, $2, $3, $4, $5)`,
      [serverId, serverName, cpuPercent, memoryUsedPercent, diskUsedPercent]
    );
  } catch (err) {
    console.error('[history] failed to record sample:', (err as Error).message);
  }
}

/** Deletes samples older than the retention window. Call this occasionally (e.g. once per sampling tick), not per-request. */
export async function pruneOldSamples(retentionDays = 7): Promise<void> {
  if (!isHistoryEnabled()) return;
  try {
    await ensureSchema();
    await getPool().query(`DELETE FROM telemetry_history WHERE recorded_at < now() - ($1 || ' days')::interval`, [retentionDays]);
  } catch (err) {
    console.error('[history] failed to prune old samples:', (err as Error).message);
  }
}

/** Returns the last `hours` of samples, oldest first, grouped by server_id. */
export async function getHistory(hours = 24): Promise<Record<string, HistorySample[]>> {
  if (!isHistoryEnabled()) return {};
  try {
    await ensureSchema();
    const { rows } = await getPool().query<{
      server_id: string;
      recorded_at: Date;
      cpu_percent: number | null;
      memory_used_percent: number | null;
      disk_used_percent: number | null;
    }>(
      `SELECT server_id, recorded_at, cpu_percent, memory_used_percent, disk_used_percent
       FROM telemetry_history
       WHERE recorded_at > now() - ($1 || ' hours')::interval
       ORDER BY recorded_at ASC`,
      [hours]
    );

    const grouped: Record<string, HistorySample[]> = {};
    for (const row of rows) {
      if (!grouped[row.server_id]) grouped[row.server_id] = [];
      grouped[row.server_id].push({
        recordedAt: row.recorded_at.toISOString(),
        cpuPercent: row.cpu_percent,
        memoryUsedPercent: row.memory_used_percent,
        diskUsedPercent: row.disk_used_percent,
      });
    }
    return grouped;
  } catch (err) {
    console.error('[history] failed to read history:', (err as Error).message);
    return {};
  }
}
