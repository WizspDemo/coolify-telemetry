import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { config } from './config';

/**
 * 24h-ish CPU/RAM/Disk history per server, for sparklines on the dashboard.
 * Stored as a single JSON file on the same persistent volume users.json
 * already lives on - fully self-contained: no external database, no extra
 * container, no native build dependency, no Docker network dependency on
 * anything else running on the server. (An earlier version of this reused
 * an existing self-hosted Supabase Postgres instance on the same server -
 * deliberately dropped: that coupled the dashboard's uptime/removability to
 * Supabase's. A real DB (SQLite via better-sqlite3) was also tried and
 * dropped - it needs native compilation, which fails on this project's
 * plain `node:20-alpine` Dockerfile without adding build-essential/python
 * to the image. At one sample per server per 30s, 7 days of retention is at
 * most a few thousand rows - trivial as plain JSON, no DB needed.)
 */

export interface HistorySample {
  recordedAt: string;
  cpuPercent: number | null;
  memoryUsedPercent: number | null;
  diskUsedPercent: number | null;
}

interface StoredSample extends HistorySample {
  serverId: string;
  serverName: string;
}

interface HistoryFile {
  samples: StoredSample[];
}

const historyFilePath = path.join(config.dataDir, 'history.json');

function loadFile(): HistoryFile {
  if (!existsSync(historyFilePath)) return { samples: [] };
  try {
    const parsed = JSON.parse(readFileSync(historyFilePath, 'utf8')) as HistoryFile;
    if (!Array.isArray(parsed.samples)) return { samples: [] };
    return parsed;
  } catch (err) {
    console.error('[history] failed to read history.json, starting empty:', (err as Error).message);
    return { samples: [] };
  }
}

function saveFile(data: HistoryFile) {
  writeFileSync(historyFilePath, JSON.stringify(data), 'utf8');
}

/** History is always available - it's a local file, nothing to misconfigure or fail to reach. */
export function isHistoryEnabled(): boolean {
  return true;
}

export function recordSample(
  serverId: string,
  serverName: string,
  cpuPercent: number | null,
  memoryUsedPercent: number | null,
  diskUsedPercent: number | null
): void {
  try {
    const data = loadFile();
    data.samples.push({
      serverId,
      serverName,
      recordedAt: new Date().toISOString(),
      cpuPercent,
      memoryUsedPercent,
      diskUsedPercent,
    });
    saveFile(data);
  } catch (err) {
    console.error('[history] failed to record sample:', (err as Error).message);
  }
}

/** Deletes samples older than the retention window. Call this occasionally (e.g. once per sampling tick), not per-request. */
export function pruneOldSamples(retentionDays = 7): void {
  try {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const data = loadFile();
    const before = data.samples.length;
    data.samples = data.samples.filter((s) => new Date(s.recordedAt).getTime() >= cutoff);
    if (data.samples.length !== before) saveFile(data);
  } catch (err) {
    console.error('[history] failed to prune old samples:', (err as Error).message);
  }
}

/** Returns the last `hours` of samples, oldest first, grouped by server_id. */
export function getHistory(hours = 24): Record<string, HistorySample[]> {
  try {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const data = loadFile();
    const grouped: Record<string, HistorySample[]> = {};
    for (const s of data.samples) {
      if (new Date(s.recordedAt).getTime() < cutoff) continue;
      if (!grouped[s.serverId]) grouped[s.serverId] = [];
      grouped[s.serverId].push({
        recordedAt: s.recordedAt,
        cpuPercent: s.cpuPercent,
        memoryUsedPercent: s.memoryUsedPercent,
        diskUsedPercent: s.diskUsedPercent,
      });
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    }
    return grouped;
  } catch (err) {
    console.error('[history] failed to read history:', (err as Error).message);
    return {};
  }
}
