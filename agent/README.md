# Coolify Telemetry Agent

Small Node/Express service you deploy **once per Coolify server** (as a
Coolify "Docker Compose" application, no SSH needed). It gives the central
dashboard a single authenticated HTTP endpoint per server that returns:

- Server-wide CPU %, RAM usage, and disk usage (proxied from that server's
  own `coolify-sentinel` container, which already collects this).
- Per-**Coolify project** RAM and disk usage, computed by reading the
  `coolify.projectName` / `coolify.environmentName` / `coolify.resourceName`
  Docker labels Coolify attaches to every container it manages, then joining
  that with Sentinel's per-container CPU/memory/disk numbers (falling back to
  a live `docker stats` snapshot if Sentinel has no sample yet).

No SSH access to the server is required — it lives inside Coolify itself and
talks to Docker only via the socket Coolify already mounts into every
container's host, and to Sentinel over the internal Docker network.

## Why this exists

Coolify's public REST API (`/api/v1/...`) does not expose numeric RAM/CPU/disk
per project — only resource lists and boolean flags. The real numbers live in
the `coolify-sentinel` container, which only listens on `localhost:8888`
**inside** each server. This agent is deployed on that same server/Docker
network so it can reach Sentinel directly, then re-exposes a small, purpose
-built JSON API that the central dashboard (in `../dashboard`) can call over
the public internet with a bearer token.

## Deploying on Coolify (per server, repeat 3x)

1. In Coolify, on **that server**, create a new **Application** → **Docker
   Compose** (or "Public Repository" pointing at this `agent/` folder) using
   `docker-compose.yml` from this folder.
2. Get the Sentinel token: **Servers → \<this server\> → Sentinel →
   Configuration** → copy the token. (Make sure Sentinel + Metrics are
   enabled on that server first: Servers → Configuration → Metrics.)
3. Set the environment variables on the Coolify resource:
   - `AGENT_TOKEN` — invent a long random string, the SAME one you will put
     in the dashboard's config for this server.
   - `SERVER_LABEL` — a friendly name, e.g. `Production VPS 1`.
   - `SENTINEL_TOKEN` — the token from step 2.
   - `SENTINEL_URL` — leave default (`http://coolify-sentinel:8888`) unless
     you renamed Coolify's internal network.
4. Deploy. Coolify will give the app a domain/URL (or keep it internal-only
   and reach it via the dashboard's own private network if the dashboard is
   also on the same Coolify — see main README for network options).
5. Verify: `curl -H "Authorization: Bearer $AGENT_TOKEN" https://<agent-domain>/metrics`

## Local development

```bash
cp .env.example .env   # fill in the values
npm install
npm run dev             # tsc --watch
npm start                # or: node dist/index.js
curl -H "Authorization: Bearer $AGENT_TOKEN" http://localhost:7777/metrics
```

## Endpoints

- `GET /health` — public, no auth, for Coolify healthchecks.
- `GET /metrics` — requires `Authorization: Bearer <AGENT_TOKEN>`. Returns:

```json
{
  "server": "Production VPS 1",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "cpu": { "percent": 12.3 },
  "memory": { "totalBytes": 0, "usedBytes": 0, "freeBytes": 0, "usedPercent": 0 },
  "disk": { "mount": "/", "totalBytes": 0, "usedBytes": 0, "availableBytes": 0, "usedPercent": 0 },
  "allDisks": [ { "mount": "/", "totalBytes": 0 } ],
  "projects": [
    {
      "projectName": "my-saas-app",
      "memoryUsedBytes": 0,
      "diskBytes": 0,
      "resources": [
        {
          "containerName": "my-saas-app-web-abc123",
          "environmentName": "production",
          "resourceName": "web",
          "type": "application",
          "state": "running",
          "memoryUsedBytes": 0,
          "memoryPercent": 0,
          "cpuPercent": 0,
          "diskWritableLayerBytes": 0,
          "diskVolumesBytes": 0,
          "diskTotalBytes": 0
        }
      ]
    }
  ]
}
```
