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
  /** Hostnames other containers on the same docker network(s) could reach this one by. */
  networkAliases: string[];
  /** True when this container looks crashed/unhealthy rather than intentionally stopped. */
  problem: boolean;
  /** Human-readable reason when problem is true (e.g. "restarting (crash loop)"). */
  problemReason: string | null;
}

/**
 * Flags containers that look broken rather than intentionally stopped, purely
 * from the state/status strings Docker already reports (no extra inspect
 * calls needed). Exit codes 0/137/143 are treated as a normal stop (SIGTERM/
 * SIGKILL from a user-triggered `docker stop`, or a clean exit) so the
 * dashboard's "Pause project" feature doesn't get flagged as a problem.
 */
function computeProblem(state: string, status: string): { problem: boolean; reason: string | null } {
  if (/\(unhealthy\)/i.test(status)) {
    return { problem: true, reason: 'unhealthy healthcheck' };
  }
  if (state === 'restarting') {
    return { problem: true, reason: 'restarting repeatedly (crash loop)' };
  }
  if (state === 'dead') {
    return { problem: true, reason: 'dead' };
  }
  if (state === 'exited') {
    const match = status.match(/Exited \((\d+)\)/);
    const code = match ? Number(match[1]) : 0;
    if (![0, 137, 143].includes(code)) {
      return { problem: true, reason: `exited with code ${code}` };
    }
  }
  return { problem: false, reason: null };
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

      const networks = (c as any).NetworkSettings?.Networks ?? {};
      const aliasSet = new Set<string>();
      for (const netName of Object.keys(networks)) {
        for (const alias of networks[netName]?.Aliases ?? []) {
          aliasSet.add(alias);
        }
      }
      aliasSet.add(name);

      const { problem, reason } = computeProblem(c.State, c.Status);

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
        networkAliases: Array.from(aliasSet),
        problem,
        problemReason: reason,
      };
    });
}

export interface ProjectLink {
  fromProject: string;
  fromContainer: string;
  toProject: string;
  toContainer: string;
  /** The hostname/alias found in an env var that pointed at the other container. */
  viaHostname: string;
}

/**
 * Finds cross-project dependencies by inspecting each running container's
 * environment variables for a hostname that matches another managed
 * container's network alias (e.g. a DATABASE_URL/SUPABASE_URL pointing at
 * `supabase-db` from a completely different project). This is how e.g. "which
 * project actually uses the shared Supabase" gets surfaced without having to
 * remember it - no extra infra, just reading what's already in the env.
 */
export async function detectProjectLinks(containers: ManagedContainer[]): Promise<ProjectLink[]> {
  const aliasToContainer = new Map<string, ManagedContainer>();
  for (const c of containers) {
    for (const alias of c.networkAliases) {
      if (alias.length < 4) continue; // too short, too likely to false-positive match
      aliasToContainer.set(alias.toLowerCase(), c);
    }
  }

  const links: ProjectLink[] = [];
  const seenPairs = new Set<string>();

  for (const c of containers) {
    if (c.state !== 'running') continue;
    let envLines: string[] = [];
    try {
      const info = await docker.getContainer(c.id).inspect();
      envLines = info.Config?.Env ?? [];
    } catch {
      continue; // container may have stopped between listing and inspect
    }

    for (const [alias, target] of aliasToContainer) {
      if (target.id === c.id) continue;
      if ((c.projectName ?? '') === (target.projectName ?? '')) continue; // only cross-project links are interesting

      const matched = envLines.some((line) => {
        const eqIdx = line.indexOf('=');
        const value = (eqIdx >= 0 ? line.slice(eqIdx + 1) : line).toLowerCase();
        return value.includes(alias);
      });
      if (!matched) continue;

      const key = `${c.projectName}|${target.projectName}|${alias}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);

      links.push({
        fromProject: c.projectName ?? '(unlabeled)',
        fromContainer: c.name,
        toProject: target.projectName ?? '(unlabeled)',
        toContainer: target.name,
        viaHostname: alias,
      });
    }
  }

  return links;
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
