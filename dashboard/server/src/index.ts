import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { config } from './config';
import { fetchAllServers, setProjectPower } from './aggregator';
import { ensureBootstrapUser, verifyCredentials, changePassword, signSession, verifySession } from './auth';
import { ensureBootstrapServers, listServers, listServersMasked, addServer, updateServer, removeServer, getServer } from './serverStore';

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
});
