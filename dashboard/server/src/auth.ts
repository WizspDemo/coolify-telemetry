import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { config } from './config';

/**
 * Minimal, dependency-free username/password auth:
 *  - passwords hashed with PBKDF2 (Node's built-in crypto, no bcrypt native
 *    module to keep the Docker build simple and fast)
 *  - sessions are a small HMAC-signed token (like a JWT, but hand-rolled so
 *    we don't need the `jsonwebtoken` package either)
 *  - users are persisted as JSON on disk, under a directory that should be
 *    mounted as a persistent volume (see dashboard README) so accounts
 *    survive redeploys
 */

interface StoredUser {
  username: string;
  salt: string;
  hash: string;
  createdAt: string;
  updatedAt: string;
}

interface UsersFile {
  users: StoredUser[];
}

const usersFilePath = path.join(config.dataDir, 'users.json');

function ensureDataDir() {
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }
}

function loadUsersFile(): UsersFile {
  ensureDataDir();
  if (!existsSync(usersFilePath)) {
    return { users: [] };
  }
  try {
    const raw = readFileSync(usersFilePath, 'utf8');
    const parsed = JSON.parse(raw) as UsersFile;
    if (!Array.isArray(parsed.users)) return { users: [] };
    return parsed;
  } catch (err) {
    console.error('[auth] failed to read users.json, starting empty:', (err as Error).message);
    return { users: [] };
  }
}

function saveUsersFile(data: UsersFile) {
  ensureDataDir();
  writeFileSync(usersFilePath, JSON.stringify(data, null, 2), 'utf8');
}

function hashPassword(password: string, salt: string): string {
  return pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');
}

/**
 * On first boot, if no users exist yet, create one admin account from
 * ADMIN_USERNAME / ADMIN_PASSWORD env vars. After that the env vars are
 * never consulted again - the user is expected to log in and change the
 * password via the UI.
 */
export function ensureBootstrapUser() {
  const data = loadUsersFile();
  if (data.users.length > 0) return;

  const username = config.adminUsername;
  const password = config.adminPassword;
  if (!username || !password) {
    console.warn(
      '[auth] No users exist yet and ADMIN_USERNAME/ADMIN_PASSWORD are not set - nobody will be able to log in until you set them and redeploy.'
    );
    return;
  }

  const salt = randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const now = new Date().toISOString();
  data.users.push({ username, salt, hash, createdAt: now, updatedAt: now });
  saveUsersFile(data);
  console.log(`[auth] Bootstrapped initial user "${username}".`);
}

export function verifyCredentials(username: string, password: string): boolean {
  const data = loadUsersFile();
  const user = data.users.find((u) => u.username === username);
  if (!user) return false;
  const attemptHash = hashPassword(password, user.salt);
  const a = Buffer.from(attemptHash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function changePassword(username: string, currentPassword: string, newPassword: string): boolean {
  if (!verifyCredentials(username, currentPassword)) return false;
  const data = loadUsersFile();
  const user = data.users.find((u) => u.username === username);
  if (!user) return false;
  const salt = randomBytes(16).toString('hex');
  user.salt = salt;
  user.hash = hashPassword(newPassword, salt);
  user.updatedAt = new Date().toISOString();
  saveUsersFile(data);
  return true;
}

export function userExists(username: string): boolean {
  return loadUsersFile().users.some((u) => u.username === username);
}

// --- Session tokens (HMAC-signed, JWT-shaped but hand-rolled) ---

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface SessionPayload {
  username: string;
  iat: number;
  exp: number;
}

export function signSession(username: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + config.sessionTtlSeconds;
  const payload: SessionPayload = { username, iat, exp };
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'session' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', config.sessionSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifySession(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = createHmac('sha256', config.sessionSecret).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Re-export a stable hash for anything that wants a non-secret fingerprint
// (not currently used, kept small and unused-import-free on purpose).
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
