import Docker from 'dockerode';
import { config } from './config';

const docker = new Docker({ socketPath: config.dockerSocketPath });

export interface ManagedContainer {
  /** Docker container ID */
  id: string;
  /** Container display name as Docker records it (name without leading slash) */
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
  /** Size of the container's writable layer, in bytes (from `docker ps -s`) */
  sizeRwBytes: number | null;
  /** Total size of the container's writable layer + all its data (image + volumes visible to it), in bytes */
  sizeRootFsBytes: number | null;
}

/**
 * Lists every container Coolify manages (label coolify.managed=true) on this
 * server, with the project/environment/resource metadata Coolify attaches as
 * Docker labels, plus per-container disk usage (equivalent to `docker ps -s`).
 * This is how we group storage/RAM by "project" without needing Coolify's
 * own database, Sentinel, or SSH access.
 */
export async function listManagedContainers(): Promise<ManagedContainer[]> {
  // `size: true` makes the Docker API compute SizeRw/SizeRootFs per
  // container - this is what `docker ps -s` uses under the hood.
  const containers = await docker.listContainers({ all: true, size: true });

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
        sizeRwBytes: typeof (c as any).SizeRw === 'number' ? (c as any).SizeRw : null,
        sizeRootFsBytes: typeof (c as any).SizeRootFs === 'number' ? (c as any).SizeRootFs : null,
      };
    });
}

/** Live docker stats snapshot (CPU %, memory) for one container. */
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

export interface ContainerActionResult {
  containerName: string;
  ok: boolean;
  error?: string;
}

/**
 * Starts or stops every Coolify-managed container belonging to one project
 * (matched by the coolify.projectName label). This is how "Pause project" /
 * "Start project" works from the dashboard - no SSH, just the Docker API
 * this container already has access to via the mounted socket.
 */
export async function setContainersPowerForProject(
  projectName: string,
  action: 'start' | 'stop'
): Promise<ContainerActionResult[]> {
  const all = await listManagedContainers();
  const targets = all.filter((c) => (c.projectName ?? '(unlabeled)') === projectName);

  return Promise.all(
    targets.map(async (c): Promise<ContainerActionResult> => {
      try {
        const container = docker.getContainer(c.id);
        if (action === 'stop') {
          if (c.state === 'running') await container.stop();
        } else {
          if (c.state !== 'running') await container.start();
        }
        return { containerName: c.name, ok: true };
      } catch (err) {
        return { containerName: c.name, ok: false, error: (err as Error).message };
      }
    })
  );
}
