import Docker from 'dockerode';
import { config } from './config';

const docker = new Docker({ socketPath: config.dockerSocketPath });

export interface ManagedContainer {
  /** Docker container ID */
  id: string;
  /** Container display name as Sentinel records it (name without leading slash) */
  name: string;
  /** Coolify project name, from the coolify.projectName label */
  projectName: string | null;
  /** Coolify environment name (e.g. production) */
  environmentName: string | null;
  /** Coolify resource name (application/service/database name) */
  resourceName: string | null;
  /** application | database | service, from coolify labels */
  type: string;
  state: string;
  status: string;
  image: string;
}

/**
 * Lists every container Coolify manages (label coolify.managed=true) on this
 * server, with the project/environment/resource metadata Coolify attaches as
 * Docker labels. This is how we group storage/RAM by "project" without
 * needing Coolify's own database or SSH access.
 */
export async function listManagedContainers(): Promise<ManagedContainer[]> {
  const containers = await docker.listContainers({ all: true });

  return containers
    .filter((c) => c.Labels?.['coolify.managed'] === 'true')
    .map((c) => {
      const labels = c.Labels ?? {};
      const name = (c.Names?.[0] ?? '').replace(/^\//, '');
      let type = 'application';
      if (labels['coolify.type']) {
        type = labels['coolify.type'];
      } else if (labels['coolify.databaseId']) {
        type = 'database';
      } else if (labels['coolify.serviceId']) {
        type = 'service';
      }
      return {
        id: c.Id,
        name,
        projectName: labels['coolify.projectName'] ?? null,
        environmentName: labels['coolify.environmentName'] ?? null,
        resourceName: labels['coolify.resourceName'] ?? labels['coolify.name'] ?? name,
        type,
        state: c.State,
        status: c.Status,
        image: c.Image,
      };
    });
}

/** Live docker stats snapshot (CPU %, memory) for one container, as a fallback
 *  when Sentinel has no recent sample for it yet (e.g. metrics disabled). */
export async function getLiveContainerStats(containerId: string) {
  const container = docker.getContainer(containerId);
  const stats = await container.stats({ stream: false });
  const memUsed = stats.memory_stats?.usage ?? 0;
  const memLimit = stats.memory_stats?.limit ?? 0;

  const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
  const cpuCount = stats.cpu_stats?.online_cpus ?? 1;
  const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

  return {
    memoryUsedBytes: memUsed,
    memoryLimitBytes: memLimit,
    memoryPercent: memLimit > 0 ? (memUsed / memLimit) * 100 : 0,
    cpuPercent,
  };
}
