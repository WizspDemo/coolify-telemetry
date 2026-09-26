import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 7777),
  agentToken: required('AGENT_TOKEN'),
  serverLabel: process.env.SERVER_LABEL ?? 'Coolify Server',
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock',
  // Read-only host bind mounts (see docker-compose.yml): the host's /proc and
  // / filesystem, mounted somewhere harmless inside this container so we can
  // read CPU/RAM/disk numbers without SSH or Coolify's Sentinel container.
  hostProcPath: process.env.HOST_PROC_PATH ?? '/hostfs/proc',
  hostRootPath: process.env.HOST_ROOT_PATH ?? '/hostfs/root',
};
