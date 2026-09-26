import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { config } from './config';
import { fetchAllServers } from './aggregator';

const app = express();
app.use(express.json());

function requireDashboardAuth(req: Request, res: Response, next: NextFunction) {
  if (!config.dashboardPassword) {
    next();
    return;
  }
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== config.dashboardPassword) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/servers', requireDashboardAuth, async (_req, res) => {
  const results = await fetchAllServers();
  res.json({ servers: results, fetchedAt: new Date().toISOString() });
});

// Serve the built React app in production.
const clientDist = path.join(__dirname, '..', 'client-dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`[coolify-telemetry-dashboard] listening on port ${config.port}`);
  console.log(`[coolify-telemetry-dashboard] configured servers: ${config.servers.map((s) => s.name).join(', ') || '(none)'}`);
});
