import { StoredServer } from './serverStore';

export interface ResourceMetric {
  containerName: string;
  projectName: string;
  environmentName: string | null;
  resourceName: string | null;
  type: string;
  state: string;
  status: string;
  image: string;
  memoryUsedBytes: number | null;
  memoryPercent: number | null;
  cpuPercent: number | null;
  diskWritableLayerBytes: number | null;
  diskTotalBytes: number | null;
  problem: boolean;
  problemReason: string | null;
}

export interface ProjectMetric {
  projectName: string;
  memoryUsedBytes: number;
  diskBytes: number;
  hasProblem: boolean;
  resources: ResourceMetric[];
}

export interface ProjectLink {
  fromProject: string;
  fromContainer: string;
  toProject: string;
  toContainer: string;
  viaHostname: string;
}

export interface AgentMetricsResponse {
  server: string;
  timestamp: string;
  cpu: { percent: number } | null;
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; usedPercent: number } | null;
  disk: { mount: string; totalBytes: number; usedBytes: number; availableBytes: number; usedPercent: number } | null;
  projects: ProjectMetric[];
  links: ProjectLink[];
}

export interface ServerResult {
  serverId: string;
  configuredName: string;
  ok: boolean;
  error?: string;
  data?: AgentMetricsResponse;
}

async function fetchOne(entry: StoredServer): Promise<ServerResult> {
  try {
    const res = await fetch(`${entry.url}/metrics`, {
      headers: { Authorization: `Bearer ${entry.token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { serverId: entry.id, configuredName: entry.name, ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as AgentMetricsResponse;
    return { serverId: entry.id, configuredName: entry.name, ok: true, data };
  } catch (err) {
    return { serverId: entry.id, configuredName: entry.name, ok: false, error: (err as Error).message };
  }
}

export async function fetchAllServers(servers: StoredServer[]): Promise<ServerResult[]> {
  return Promise.all(servers.map(fetchOne));
}

/** Proxies a start/stop action for one project's containers to that server's agent. */
export async function setProjectPower(
  entry: StoredServer,
  projectName: string,
  action: 'start' | 'stop'
): Promise<{ ok: boolean; error?: string; results?: unknown }> {
  try {
    const res = await fetch(`${entry.url}/projects/${encodeURIComponent(projectName)}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${entry.token}` },
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (json as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    return { ok: true, results: json };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
