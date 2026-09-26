import { readFileSync, statfsSync } from 'fs';
import { config } from './config';

/**
 * Host-wide CPU/RAM/Disk metrics read directly from the host, via the
 * read-only bind mounts `/proc` -> HOST_PROC_PATH and `/` -> HOST_ROOT_PATH.
 * This is the same technique node_exporter / cAdvisor use: no SSH, no
 * dependency on Coolify's Sentinel container, just read-only filesystem
 * access granted explicitly through Docker volume mounts on this one
 * container.
 */

export interface HostMemory {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  availableBytes: number;
  usedPercent: number;
}

export interface HostDisk {
  mount: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
}

interface CpuSample {
  idle: number;
  total: number;
  at: number;
}

let lastCpuSample: CpuSample | null = null;

function readProcFile(relativePath: string): string {
  return readFileSync(`${config.hostProcPath}/${relativePath}`, 'utf8');
}

function parseCpuLine(line: string): CpuSample {
  // "cpu  user nice system idle iowait irq softirq steal guest guest_nice"
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
  const idleAll = idle + (iowait || 0);
  const total = user + nice + system + idleAll + irq + softirq + (steal || 0);
  return { idle: idleAll, total, at: Date.now() };
}

/**
 * Host-wide CPU usage percent, computed as a delta since the previous call.
 * Returns null on the very first call (needs two samples to compute a delta).
 */
export function getHostCpuPercent(): number | null {
  const stat = readProcFile('stat');
  const firstLine = stat.split('\n')[0];
  const sample = parseCpuLine(firstLine);

  if (!lastCpuSample) {
    lastCpuSample = sample;
    return null;
  }

  const totalDelta = sample.total - lastCpuSample.total;
  const idleDelta = sample.idle - lastCpuSample.idle;
  lastCpuSample = sample;

  if (totalDelta <= 0) return null;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

export function getHostMemory(): HostMemory | null {
  try {
    const meminfo = readProcFile('meminfo');
    const lines = meminfo.split('\n');
    const get = (key: string): number => {
      const line = lines.find((l) => l.startsWith(`${key}:`));
      if (!line) return 0;
      const match = line.match(/(\d+)/);
      return match ? Number(match[1]) * 1024 : 0; // kB -> bytes
    };

    const totalBytes = get('MemTotal');
    const availableBytes = get('MemAvailable');
    const freeBytes = get('MemFree');
    const usedBytes = totalBytes - availableBytes;

    return {
      totalBytes,
      usedBytes,
      freeBytes,
      availableBytes,
      usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
    };
  } catch (err) {
    console.error('[hostmetrics] failed to read memory:', (err as Error).message);
    return null;
  }
}

export function getHostDisk(): HostDisk | null {
  try {
    const stats = statfsSync(config.hostRootPath);
    const totalBytes = stats.blocks * stats.bsize;
    const availableBytes = stats.bavail * stats.bsize;
    const freeBytes = stats.bfree * stats.bsize;
    const usedBytes = totalBytes - freeBytes;

    return {
      mount: '/',
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
    };
  } catch (err) {
    console.error('[hostmetrics] failed to read disk:', (err as Error).message);
    return null;
  }
}
