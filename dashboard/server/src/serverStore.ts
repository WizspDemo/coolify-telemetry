import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import { config } from './config';

/**
 * Coolify server entries (name/url/agent-token), stored as JSON on disk
 * instead of a fixed SERVERS env var - so the user can add/edit/remove
 * servers from the UI without a redeploy. This file is small (a handful
 * of entries at most) so plain JSON is fine, no real database needed.
 */

export interface StoredServer {
  id: string;
  name: string;
  url: string;
  token: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredServerMasked {
  id: string;
  name: string;
  url: string;
  tokenPreview: string;
  createdAt: string;
  updatedAt: string;
}

interface ServersFile {
  servers: StoredServer[];
}

const serversFilePath = path.join(config.dataDir, 'servers.json');

function ensureDataDir() {
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }
}

function loadServersFile(): ServersFile {
  ensureDataDir();
  if (!existsSync(serversFilePath)) {
    return { servers: [] };
  }
  try {
    const raw = readFileSync(serversFilePath, 'utf8');
    const parsed = JSON.parse(raw) as ServersFile;
    if (!Array.isArray(parsed.servers)) return { servers: [] };
    return parsed;
  } catch (err) {
    console.error('[serverStore] failed to read servers.json, starting empty:', (err as Error).message);
    return { servers: [] };
  }
}

function saveServersFile(data: ServersFile) {
  ensureDataDir();
  writeFileSync(serversFilePath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

function maskToken(token: string): string {
  if (token.length <= 4) return '••••';
  return `••••${token.slice(-4)}`;
}

function toMasked(s: StoredServer): StoredServerMasked {
  return { id: s.id, name: s.name, url: s.url, tokenPreview: maskToken(s.token), createdAt: s.createdAt, updatedAt: s.updatedAt };
}

/**
 * One-time migration: if servers.json doesn't exist yet but the legacy
 * SERVERS env var has entries, seed the store from it. After this the env
 * var is ignored - manage servers from the UI instead.
 */
export function ensureBootstrapServers() {
  if (existsSync(serversFilePath)) return;
  if (config.legacyServers.length === 0) return;

  const now = new Date().toISOString();
  const servers: StoredServer[] = config.legacyServers.map((entry) => ({
    id: randomBytes(8).toString('hex'),
    name: entry.name,
    url: normalizeUrl(entry.url),
    token: entry.token,
    createdAt: now,
    updatedAt: now,
  }));
  saveServersFile({ servers });
  console.log(`[serverStore] Migrated ${servers.length} server(s) from the legacy SERVERS env var.`);
}

export function listServers(): StoredServer[] {
  return loadServersFile().servers;
}

export function listServersMasked(): StoredServerMasked[] {
  return listServers().map(toMasked);
}

export function addServer(name: string, url: string, token: string): StoredServerMasked {
  const data = loadServersFile();
  const now = new Date().toISOString();
  const entry: StoredServer = {
    id: randomBytes(8).toString('hex'),
    name: name.trim(),
    url: normalizeUrl(url),
    token: token.trim(),
    createdAt: now,
    updatedAt: now,
  };
  data.servers.push(entry);
  saveServersFile(data);
  return toMasked(entry);
}

/** `token` is optional on update - omit it (or send empty string) to keep the existing one. */
export function updateServer(
  id: string,
  fields: { name?: string; url?: string; token?: string }
): StoredServerMasked | null {
  const data = loadServersFile();
  const entry = data.servers.find((s) => s.id === id);
  if (!entry) return null;
  if (fields.name !== undefined && fields.name.trim()) entry.name = fields.name.trim();
  if (fields.url !== undefined && fields.url.trim()) entry.url = normalizeUrl(fields.url);
  if (fields.token !== undefined && fields.token.trim()) entry.token = fields.token.trim();
  entry.updatedAt = new Date().toISOString();
  saveServersFile(data);
  return toMasked(entry);
}

export function removeServer(id: string): boolean {
  const data = loadServersFile();
  const before = data.servers.length;
  data.servers = data.servers.filter((s) => s.id !== id);
  if (data.servers.length === before) return false;
  saveServersFile(data);
  return true;
}

export function getServer(id: string): StoredServer | null {
  return listServers().find((s) => s.id === id) ?? null;
}
