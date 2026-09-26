import express, { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { listManagedContainers, getLiveContainerStats } from './docker';
import {
  getServerCpuCurrent,
  getServerMemoryCurrent,
  getServerDiskCurrent,
  getContainerMemoryLatest,
  getContainerCpuLatest,
  getContainerDiskCurrent,
} from './sentinel';

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
    const [cpu, memory, disks, containers] = await Promise.all([
      getServerCpuCurrent(),
      getServerMemoryCurrent(),
      getServerDiskCurrent(),
      listManagedContainers(),
    ]);

    const rootDisk = disks?.find((d) => d.mount === '/') ?? disks?.[0] ?? null;

    const perContainer = await Promise.all(
      containers.map(async (c) => {
        let memUsedBytes: number | null = null;
        let memPercent: number | null = null;
        let cpuPercent: number | null = null;
        let diskWritableLayerBytes: number | null = null;
        let diskVolumesBytes: number | null = null;

        if (c.state === 'running') {
          const [mem, cpuPt, disk] = await Promise.all([
            getContainerMemoryLatest(c.name),
            getContainerCpuLatest(c.name),
            getContainerDiskCurrent(c.name),
          ]);

          if (mem) {
            memUsedBytes = mem.used;
            memPercent = mem.usedPercent;
          } else {
            // Sentinel has no sample yet (metrics just enabled, or disabled) -
            // fall back to a live docker stats snapshot.
            try {
              const live = await getLiveContainerStats(c.id);
              memUsedBytes = live.memoryUsedBytes;
              memPercent = live.memoryPercent;
              cpuPercent = cpuPercent ?? live.cpuPercent;
            } catch {
              // container may have stopped between listing and stats call
            }
          }

          if (cpuPt) {
            cpuPercent = Number(cpuPt.percent);
          }

          if (disk) {
            diskWritableLayerBytes = disk.writableLayer;
            diskVolumesBytes = disk.volumesTotal;
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
          cpuPercent,
          diskWritableLayerBytes,
          diskVolumesBytes,
          diskTotalBytes:
            diskWritableLayerBytes !== null && diskVolumesBytes !== null
              ? diskWritableLayerBytes + diskVolumesBytes
              : null,
        };
      })
    );

    // Group per Coolify project
    const projectMap = new Map<
      string,
      { projectName: string; memoryUsedBytes: number; diskBytes: number; resources: typeof perContainer }
    >();

    for (const item of perContainer) {
      const key = item.projectName;
      if (!projectMap.has(key)) {
        projectMap.set(key, { projectName: key, memoryUsedBytes: 0, diskBytes: 0, resources: [] });
      }
      const bucket = projectMap.get(key)!;
      bucket.memoryUsedBytes += item.memoryUsedBytes ?? 0;
      bucket.diskBytes += item.diskTotalBytes ?? 0;
      bucket.resources.push(item);
    }

    res.json({
      server: config.serverLabel,
      timestamp: new Date().toISOString(),
      cpu: cpu ? { percent: cpu.percent } : null,
      memory: memory
        ? {
            totalBytes: memory.total,
            usedBytes: memory.used,
            freeBytes: memory.free,
            usedPercent: memory.usedPercent,
          }
        : null,
      disk: rootDisk
        ? {
            mount: rootDisk.mount,
            totalBytes: rootDisk.total,
            usedBytes: rootDisk.used,
            availableBytes: rootDisk.available,
            usedPercent: rootDisk.usedPercent,
          }
        : null,
      allDisks: disks ?? [],
      projects: Array.from(projectMap.values()).sort((a, b) => b.diskBytes - a.diskBytes),
    });
  } catch (err) {
    console.error('[metrics] error building response:', err);
    res.status(500).json({ error: 'Failed to collect metrics', details: (err as Error).message });
  }
});

app.listen(config.port, () => {
  console.log(`[coolify-telemetry-agent] "${config.serverLabel}" listening on port ${config.port}`);
});
