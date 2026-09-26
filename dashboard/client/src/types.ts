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

export interface ServersApiResponse {
  servers: ServerResult[];
  fetchedAt: string;
}
