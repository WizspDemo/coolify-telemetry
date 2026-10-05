import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import { config } from './config';
import { fetchAllServers, setProjectPower } from './aggregator';
import { ensureBootstrapUser, verifyCredentials, changePassword, signSession, verifySession } from './auth';
import { ensureBootstrapServers, listServers, listServersMasked, addServer, updateServer, removeServer, getServer } from './serverStore';
import { isHistoryEnabled, recordSample, pruneOldSamples, getHistory } from './historyStore';

ensureBootstrapUser();
ensureBootstrapServers();

const app = express();
app.use(express.json());
app.use(cookieParser());

const SESSION_COOKIE = 'telemetry_session';

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const payload = token ? verifySession(token) : null;
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  (req as Request & { username?: string }).username = payload.username;
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Λείπει username ή password.' });
    return;
  }
  if (!verifyCredentials(username, password)) {
    res.status(401).json({ error: 'Λάθος username ή password.' });
    return;
  }
  const token = signSession(username);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.sessionTtlSeconds * 1000,
  });
  res.json({ ok: true, username });
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: (req as Request & { username?: string }).username });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const username = (req as Request & { username?: string }).username!;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    res.status(400).json({ error: 'Λείπει currentPassword ή newPassword.' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'Το νέο password πρέπει να έχει τουλάχιστον 8 χαρακτήρες.' });
    return;
  }
  const ok = changePassword(username, currentPassword, newPassword);
  if (!ok) {
    res.status(401).json({ error: 'Το τρέχον password δεν είναι σωστό.' });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/servers', requireAuth, async (_req, res) => {
  const results = await fetchAllServers(listServers());
  res.json({ servers: results, fetchedAt: new Date().toISOString() });
});

app.get('/api/history', requireAuth, async (req, res) => {
  const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
  res.json({ enabled: isHistoryEnabled(), history: await getHistory(hours) });
});

// --- Read-only public summary, for external tools (Rainmeter skin, etc.) ---
// Auth: ?key=... query param or X-Api-Key header, checked against
// PUBLIC_API_KEY (see config.ts). No cookie/session involved, and the key
// is never logged. Returns just CPU/RAM/Disk per server - nothing sensitive
// (no tokens, no project/container detail).
function checkPublicApiKey(req: Request): boolean {
  if (!config.publicApiKey) return false;
  const provided = (req.header('x-api-key') || (req.query.key as string) || '').trim();
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(config.publicApiKey);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

app.get('/api/public/summary', async (req, res) => {
  if (!checkPublicApiKey(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const results = await fetchAllServers(listServers());
  res.json({
    fetchedAt: new Date().toISOString(),
    servers: results.map((r) => ({
      name: r.configuredName,
      ok: r.ok,
      error: r.error ?? null,
      cpuPercent: r.data?.cpu?.percent ?? null,
      memoryUsedPercent: r.data?.memory?.usedPercent ?? null,
      memoryUsedBytes: r.data?.memory?.usedBytes ?? null,
      memoryTotalBytes: r.data?.memory?.totalBytes ?? null,
      diskUsedPercent: r.data?.disk?.usedPercent ?? null,
      diskUsedBytes: r.data?.disk?.usedBytes ?? null,
      diskTotalBytes: r.data?.disk?.totalBytes ?? null,
    })),
  });
});

// --- Server management (add/edit/remove Coolify servers, no redeploy needed) ---

app.get('/api/server-configs', requireAuth, (_req, res) => {
  res.json({ servers: listServersMasked() });
});

app.post('/api/server-configs', requireAuth, (req, res) => {
  const { name, url, token } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || typeof url !== 'string' || !url.trim() || typeof token !== 'string' || !token.trim()) {
    res.status(400).json({ error: 'Χρειάζονται name, url και token.' });
    return;
  }
  const created = addServer(name, url, token);
  res.status(201).json(created);
});

app.patch('/api/server-configs/:id', requireAuth, (req, res) => {
  const { name, url, token } = req.body ?? {};
  const updated = updateServer(req.params.id, { name, url, token });
  if (!updated) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  res.json(updated);
});

app.delete('/api/server-configs/:id', requireAuth, (req, res) => {
  const ok = removeServer(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  res.json({ ok: true });
});

// --- Pause / start a whole Coolify project (all its containers) ---

app.post('/api/server-configs/:id/projects/:projectName/:action(start|stop)', requireAuth, async (req, res) => {
  const entry = getServer(req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'Server not found.' });
    return;
  }
  const action = req.params.action as 'start' | 'stop';
  const result = await setProjectPower(entry, req.params.projectName, action);
  if (!result.ok) {
    res.status(502).json(result);
    return;
  }
  res.json(result);
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
  console.log(`[coolify-telemetry-dashboard] configured servers: ${listServers().map((s) => s.name).join(', ') || '(none)'}`);
  console.log(`[coolify-telemetry-dashboard] history: ${isHistoryEnabled() ? 'enabled (Postgres)' : 'disabled (set POSTGRES_HOST to enable)'}`);
});

// Sample every configured server's server-wide CPU/RAM/Disk into history at
// the same cadence the frontend polls (see POLL_INTERVAL_MS in App.tsx), and
// prune anything older than the retention window once per sampling tick -
// no separate cron/queue needed for a dataset this small.
const SAMPLE_INTERVAL_MS = 30_000;
if (isHistoryEnabled()) {
  setInterval(async () => {
    const results = await fetchAllServers(listServers());
    await Promise.all(
      results
        .filter((r) => r.ok && r.data)
        .map((r) =>
          recordSample(r.serverId, r.configuredName, r.data!.cpu?.percent ?? null, r.data!.memory?.usedPercent ?? null, r.data!.disk?.usedPercent ?? null)
        )
    );
    await pruneOldSamples(7);
  }, SAMPLE_INTERVAL_MS);
}
