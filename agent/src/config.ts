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
  sentinelUrl: (process.env.SENTINEL_URL ?? 'http://coolify-sentinel:8888').replace(/\/$/, ''),
  sentinelToken: required('SENTINEL_TOKEN'),
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock',
};
