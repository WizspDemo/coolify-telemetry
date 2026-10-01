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
  url: string | null;
  restartCount: number;
  startedAt: string | null;
  uptimeSeconds: number | null;
}

export interface ProjectMetric {
  projectName: string;
  memoryUsedBytes: number;
  diskBytes: number;
  hasProblem: boolean;
  url: string | null;
  maxRestartCount: number;
  resources: ResourceMetric[];
}

export interface ProjectLink {
  fromProject: string;
  fromContainer: string;
  toProject: string;
  toContainer: string;
  viaHostname: string;
}

export interface MissingResource {
  projectName: string;
  resourceName: string;
  lastSeenAt: string;
  missingForSeconds: number;
}

export interface AgentMetricsResponse {
  server: string;
  timestamp: string;
  cpu: { percent: number } | null;
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; usedPercent: number } | null;
  disk: { mount: string; totalBytes: number; usedBytes: number; availableBytes: number; usedPercent: number } | null;
  projects: ProjectMetric[];
  links: ProjectLink[];
  missingResources: MissingResource[];
}

export interface ServerResult {
  serverId: string;
  configuredName: string;
  ok: boolean;
  error?: string;
  data?: AgentMetricsResponse;
}

export interface ServersApiResponse {
  servers: ServerResult[];
  fetchedAt: string;
}

export interface ServerConfig {
  id: string;
  name: string;
  url: string;
  tokenPreview: string;
  createdAt: string;
  updatedAt: string;
}
