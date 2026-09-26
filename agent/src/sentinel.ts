import { config } from './config';

/**
 * Thin client for the Sentinel REST API that every Coolify server runs
 * locally as the `coolify-sentinel` container.
 *
 * Sentinel docs: https://github.com/coollabsio/sentinel
 *
 * Endpoints used here:
 *  - GET /api/cpu/current
 *  - GET /api/memory/current
 *  - GET /api/disk/current
 *  - GET /api/container/{id}/memory/history   (Sentinel has no "current" for containers)
 *  - GET /api/container/{id}/cpu/history
 *  - GET /api/container/{id}/disk/current
 */

export interface CurrentCpuUsage {
  time: string;
  percent: number;
}

export interface CurrentMemoryUsage {
  time: string;
  total: number;
  available: number;
  used: number;
  usedPercent: number;
  free: number;
}

export interface DiskUsage {
  time: string;
  mount: string;
  total: number;
  used: number;
  available: number;
  usedPercent: number;
}

export interface ContainerMemoryPoint {
  time: string;
  total: number;
  available: number;
  used: number;
  usedPercent: number;
  free: number;
}

export interface ContainerCpuPoint {
  time: string;
  percent: string;
}

export interface ContainerDiskUsage {
  time: string;
  writableLayer: number;
  volumesTotal: number;
}

async function sentinelFetch<T>(path: string): Promise<T | null> {
  const url = `${config.sentinelUrl}${path}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.sentinelToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Sentinel ${path} -> HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[sentinel] failed to fetch ${path}:`, (err as Error).message);
    return null;
  }
}

export async function getServerCpuCurrent(): Promise<CurrentCpuUsage | null> {
  return sentinelFetch<CurrentCpuUsage>('/api/cpu/current');
}

export async function getServerMemoryCurrent(): Promise<CurrentMemoryUsage | null> {
  return sentinelFetch<CurrentMemoryUsage>('/api/memory/current');
}

export async function getServerDiskCurrent(): Promise<DiskUsage[] | null> {
  return sentinelFetch<DiskUsage[]>('/api/disk/current');
}

/** Sentinel exposes no "current" memory endpoint per container, only history.
 *  We ask for the last 2 minutes and take the newest sample. */
export async function getContainerMemoryLatest(containerName: string): Promise<ContainerMemoryPoint | null> {
  const from = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const data = await sentinelFetch<ContainerMemoryPoint[]>(
    `/api/container/${encodeURIComponent(containerName)}/memory/history?from=${from}`
  );
  if (!data || data.length === 0) return null;
  return data[data.length - 1];
}

export async function getContainerCpuLatest(containerName: string): Promise<ContainerCpuPoint | null> {
  const from = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const data = await sentinelFetch<ContainerCpuPoint[]>(
    `/api/container/${encodeURIComponent(containerName)}/cpu/history?from=${from}`
  );
  if (!data || data.length === 0) return null;
  return data[data.length - 1];
}

export async function getContainerDiskCurrent(containerName: string): Promise<ContainerDiskUsage | null> {
  return sentinelFetch<ContainerDiskUsage>(`/api/container/${encodeURIComponent(containerName)}/disk/current`);
}
