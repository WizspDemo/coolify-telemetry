import express, { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { listManagedContainers, getLiveContainerStats, setContainersPowerForProject, detectProjectLinks } from './docker';
import { getHostCpuPercent, getHostMemory, getHostDisk } from './hostmetrics';

const app = express();
app.use(express.json());

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== config.agentToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, server: config.serverLabel });
});

/**
 * Main endpoint the dashboard polls per server.
 * Returns server-level CPU/RAM/disk plus a per-project breakdown of
 * RAM + disk usage, built from Coolify's own Docker labels.
 */
app.get('/metrics', requireAuth, async (_req, res) => {
  try {
    const cpuPercent = getHostCpuPercent();
    const memory = getHostMemory();
    const disk = getHostDisk();
    const containers = await listManagedContainers();

    const perContainer = await Promise.all(
      containers.map(async (c) => {
        let memUsedBytes: number | null = null;
        let memPercent: number | null = null;
        let cpuPct: number | null = null;

        if (c.state === 'running') {
          try {
            const live = await getLiveContainerStats(c.id);
            memUsedBytes = live.memoryUsedBytes;
            memPercent = live.memoryPercent;
            cpuPct = live.cpuPercent;
          } catch {
            // container may have stopped between listing and stats call
          }
        }

        return {
          containerId: c.id,
          containerName: c.name,
          projectName: c.projectName ?? '(unlabeled)',
          environmentName: c.environmentName,
          resourceName: c.resourceName,
          type: c.type,
          state: c.state,
          status: c.status,
          image: c.image,
          memoryUsedBytes: memUsedBytes,
          memoryPercent: memPercent,
          cpuPercent: cpuPct,
          diskWritableLayerBytes: c.sizeRwBytes,
          diskTotalBytes: c.sizeRootFsBytes,
          problem: c.problem,
          problemReason: c.problemReason,
        };
      })
    );

    // Group per Coolify project
    const projectMap = new Map<
      string,
      { projectName: string; memoryUsedBytes: number; diskBytes: number; hasProblem: boolean; resources: typeof perContainer }
    >();

    for (const item of perContainer) {
      const key = item.projectName;
      if (!projectMap.has(key)) {
        projectMap.set(key, { projectName: key, memoryUsedBytes: 0, diskBytes: 0, hasProblem: false, resources: [] });
      }
      const bucket = projectMap.get(key)!;
      bucket.memoryUsedBytes += item.memoryUsedBytes ?? 0;
      bucket.diskBytes += item.diskTotalBytes ?? 0;
      bucket.hasProblem = bucket.hasProblem || item.problem;
      bucket.resources.push(item);
    }

    const links = await detectProjectLinks(containers);

    res.json({
      server: config.serverLabel,
      timestamp: new Date().toISOString(),
      cpu: cpuPercent !== null ? { percent: cpuPercent } : null,
      memory: memory
        ? {
            totalBytes: memory.totalBytes,
            usedBytes: memory.usedBytes,
            freeBytes: memory.freeBytes,
            usedPercent: memory.usedPercent,
          }
        : null,
      disk: disk
        ? {
            mount: disk.mount,
            totalBytes: disk.totalBytes,
            usedBytes: disk.usedBytes,
            availableBytes: disk.availableBytes,
            usedPercent: disk.usedPercent,
          }
        : null,
      projects: Array.from(projectMap.values()).sort((a, b) => b.diskBytes - a.diskBytes),
      links,
    });
  } catch (err) {
    console.error('[metrics] error building response:', err);
    res.status(500).json({ error: 'Failed to collect metrics', details: (err as Error).message });
  }
});

/**
 * Start/stop every container belonging to one Coolify project. Used by the
 * dashboard's "Pause project" / "Start project" buttons - proxied there,
 * called directly here against the Docker API this agent already has
 * access to via the mounted socket.
 */
app.post('/projects/:projectName/stop', requireAuth, async (req, res) => {
  try {
    const results = await setContainersPowerForProject(req.params.projectName, 'stop');
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop project', details: (err as Error).message });
  }
});

app.post('/projects/:projectName/start', requireAuth, async (req, res) => {
  try {
    const results = await setContainersPowerForProject(req.params.projectName, 'start');
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start project', details: (err as Error).message });
  }
});

app.listen(config.port, () => {
  console.log(`[coolify-telemetry-agent] "${config.serverLabel}" listening on port ${config.port}`);
});
