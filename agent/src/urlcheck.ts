import https from 'https';
import http from 'http';
import { URL } from 'url';

/**
 * Lightweight "is this project's public URL actually answering" check, done
 * from inside the agent (same server, same network as the containers) so it
 * costs one small HTTP request per project per poll - no extra container,
 * no persistent connection, nothing kept in memory between calls.
 */
export interface UrlCheckResult {
  reachable: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  tlsExpiresAt: string | null;
  tlsDaysRemaining: number | null;
  error: string | null;
}

const TIMEOUT_MS = 5000;

export async function checkUrl(rawUrl: string): Promise<UrlCheckResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: UrlCheckResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      finish({ reachable: false, statusCode: null, latencyMs: null, tlsExpiresAt: null, tlsDaysRemaining: null, error: 'invalid URL' });
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const req = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname || '/',
        method: 'GET',
        timeout: TIMEOUT_MS,
        // We only care whether *something* answers and how fast - skip cert
        // hostname/chain validation so an internal/self-signed hop still
        // reports as reachable instead of erroring out.
        rejectUnauthorized: false,
      },
      (res) => {
        const latencyMs = Date.now() - start;
        let tlsExpiresAt: string | null = null;
        let tlsDaysRemaining: number | null = null;

        if (isHttps && typeof (res.socket as any).getPeerCertificate === 'function') {
          try {
            const cert = (res.socket as any).getPeerCertificate();
            if (cert?.valid_to) {
              const expires = new Date(cert.valid_to);
              tlsExpiresAt = expires.toISOString();
              tlsDaysRemaining = Math.round((expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            }
          } catch {
            // no cert info available, leave null
          }
        }

        // Drain the response body so the socket can be reused/closed cleanly.
        res.resume();
        finish({
          reachable: res.statusCode !== undefined && res.statusCode < 500,
          statusCode: res.statusCode ?? null,
          latencyMs,
          tlsExpiresAt,
          tlsDaysRemaining,
          error: null,
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      finish({ reachable: false, statusCode: null, latencyMs: null, tlsExpiresAt: null, tlsDaysRemaining: null, error: 'timeout' });
    });

    req.on('error', (err) => {
      finish({ reachable: false, statusCode: null, latencyMs: null, tlsExpiresAt: null, tlsDaysRemaining: null, error: err.message });
    });

    req.end();
  });
}

/** Runs checkUrl for several projects in parallel, keyed by project name. Projects with no URL are skipped entirely. */
export async function checkProjectUrls(
  projects: { projectName: string; url: string | null }[]
): Promise<Record<string, UrlCheckResult>> {
  const entries = await Promise.all(
    projects
      .filter((p) => p.url)
      .map(async (p) => [p.projectName, await checkUrl(p.url!)] as const)
  );
  return Object.fromEntries(entries);
}
