import { useEffect, useState, useCallback } from 'react';
import type { ServersApiResponse } from './types';
import { formatBytes, formatPercent, percentColor } from './format';

const POLL_INTERVAL_MS = 30000;

function usePassword() {
  const [password, setPassword] = useState<string>(() => localStorage.getItem('dashboardPassword') ?? '');
  const save = (v: string) => {
    setPassword(v);
    localStorage.setItem('dashboardPassword', v);
  };
  return { password, save };
}

function useServers(password: string) {
  const [data, setData] = useState<ServersApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (password) headers.Authorization = `Bearer ${password}`;
      const res = await fetch('/api/servers', { headers });
      if (!res.ok) {
        setError(res.status === 401 ? 'Λάθος password.' : `HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      const json = (await res.json()) as ServersApiResponse;
      setData(json);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  return { data, error, loading, reload: load };
}

function Bar({ percent }: { percent: number | null }) {
  const pct = percent ?? 0;
  return (
    <div style={{ background: 'rgba(128,128,128,0.2)', borderRadius: 4, height: 8, width: '100%', overflow: 'hidden' }}>
      <div
        style={{
          width: `${Math.min(pct, 100)}%`,
          height: '100%',
          background: percentColor(percent),
          transition: 'width 0.3s ease',
        }}
      />
    </div>
  );
}

function ServerCard({ result }: { result: ServersApiResponse['servers'][number] }) {
  const { configuredName, ok, error, data } = result;

  return (
    <div
      style={{
        border: '1px solid var(--border, #333)',
        borderRadius: 12,
        padding: 20,
        background: 'var(--card, rgba(255,255,255,0.03))',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{configuredName}</h2>
        <span style={{ fontSize: 12, color: ok ? '#30a46c' : '#e5484d' }}>{ok ? '● online' : '● offline'}</span>
      </div>

      {!ok && (
        <p style={{ color: '#e5484d', fontSize: 13, marginTop: 8 }}>
          Δεν απάντησε ο agent: {error}
        </p>
      )}

      {ok && data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 16 }}>
            <Metric label="CPU" value={formatPercent(data.cpu?.percent)} percent={data.cpu?.percent ?? null} />
            <Metric
              label="RAM"
              value={`${formatBytes(data.memory?.usedBytes)} / ${formatBytes(data.memory?.totalBytes)}`}
              percent={data.memory?.usedPercent ?? null}
            />
            <Metric
              label="Disk"
              value={`${formatBytes(data.disk?.usedBytes)} / ${formatBytes(data.disk?.totalBytes)}`}
              percent={data.disk?.usedPercent ?? null}
            />
          </div>

          <h3 style={{ fontSize: 14, marginTop: 24, marginBottom: 8, opacity: 0.8 }}>Projects</h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', opacity: 0.6 }}>
                <th style={{ paddingBottom: 6 }}>Project</th>
                <th style={{ paddingBottom: 6 }}>RAM</th>
                <th style={{ paddingBottom: 6 }}>Disk</th>
                <th style={{ paddingBottom: 6 }}>Resources</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ opacity: 0.5, padding: '8px 0' }}>
                    Δεν βρέθηκαν Coolify-managed containers.
                  </td>
                </tr>
              )}
              {data.projects.map((p) => (
                <tr key={p.projectName} style={{ borderTop: '1px solid var(--border, #333)' }}>
                  <td style={{ padding: '6px 0' }}>{p.projectName}</td>
                  <td style={{ padding: '6px 0' }}>{formatBytes(p.memoryUsedBytes)}</td>
                  <td style={{ padding: '6px 0' }}>{formatBytes(p.diskBytes)}</td>
                  <td style={{ padding: '6px 0' }}>{p.resources.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, percent }: { label: string; value: string; percent: number | null }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, marginBottom: 6 }}>{value}</div>
      <Bar percent={percent} />
    </div>
  );
}

export default function App() {
  const { password, save } = usePassword();
  const { data, error, loading, reload } = useServers(password);
  const [passwordInput, setPasswordInput] = useState(password);

  return (
    <div
      style={{
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        color: 'var(--foreground, #eee)',
        padding: 24,
        maxWidth: 1100,
        margin: '0 auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Coolify Telemetry</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="password"
            placeholder="Dashboard password (αν έχει οριστεί)"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border, #333)', background: 'transparent', color: 'inherit' }}
          />
          <button
            onClick={() => save(passwordInput)}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border, #333)', cursor: 'pointer', background: 'transparent', color: 'inherit' }}
          >
            Save
          </button>
          <button
            onClick={reload}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border, #333)', cursor: 'pointer', background: 'transparent', color: 'inherit' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && <p>Φόρτωση…</p>}
      {error && <p style={{ color: '#e5484d' }}>{error}</p>}

      {data && (
        <>
          <p style={{ fontSize: 12, opacity: 0.5, marginBottom: 16 }}>
            Τελευταία ενημέρωση: {new Date(data.fetchedAt).toLocaleString('el-GR')} — αυτόματο refresh κάθε 30s
          </p>
          <div style={{ display: 'grid', gap: 20 }}>
            {data.servers.map((s) => (
              <ServerCard key={s.configuredName} result={s} />
            ))}
            {data.servers.length === 0 && (
              <p style={{ opacity: 0.6 }}>
                Δεν έχει οριστεί κανένας server ακόμα. Πρόσθεσέ τους στο <code>SERVERS</code> env var του dashboard backend.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
