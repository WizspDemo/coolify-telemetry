import { config, ServerEntry } from './config';

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
  diskVolumesBytes: number | null;
  diskTotalBytes: number | null;
}

export interface ProjectMetric {
  projectName: string;
  memoryUsedBytes: number;
  diskBytes: number;
  resources: ResourceMetric[];
}

export interface AgentMetricsResponse {
  server: string;
  timestamp: string;
  cpu: { percent: number } | null;
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; usedPercent: number } | null;
  disk: { mount: string; totalBytes: number; usedBytes: number; availableBytes: number; usedPercent: number } | null;
  allDisks: Array<{ mount: string; totalBytes: number; usedBytes: number; usedPercent: number }>;
  projects: ProjectMetric[];
}

export interface ServerResult {
  configuredName: string;
  ok: boolean;
  error?: string;
  data?: AgentMetricsResponse;
}

async function fetchOne(entry: ServerEntry): Promise<ServerResult> {
  try {
    const res = await fetch(`${entry.url}/metrics`, {
      headers: { Authorization: `Bearer ${entry.token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { configuredName: entry.name, ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as AgentMetricsResponse;
    return { configuredName: entry.name, ok: true, data };
  } catch (err) {
    return { configuredName: entry.name, ok: false, error: (err as Error).message };
  }
}

export async function fetchAllServers(): Promise<ServerResult[]> {
  return Promise.all(config.servers.map(fetchOne));
}
