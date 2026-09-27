import { useEffect, useState, useCallback } from 'react';
import type { ServersApiResponse } from './types';
import { formatBytes, formatPercent, percentColor } from './format';
import { useTheme } from './useTheme';

const POLL_INTERVAL_MS = 30000;

interface Me {
  username: string;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  return res;
}

function useSession() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        setMe(await res.json());
      } else {
        setMe(null);
      }
    } catch {
      setMe(null);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { me, checked, refresh, setMe };
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (me: Me) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Αποτυχία σύνδεσης.');
        return;
      }
      onLoggedIn({ username: json.username });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={submit} className="card" style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Coolify Telemetry</h1>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Συνδέσου για να δεις τους servers σου.</p>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="error-text" style={{ margin: 0, fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Σύνδεση…' : 'Σύνδεση'}
        </button>
      </form>
    </div>
  );
}

function ChangePasswordPanel({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError('Τα δύο νέα passwords δεν ταιριάζουν.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Αποτυχία αλλαγής password.');
        return;
      }
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: 340, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <h2 style={{ margin: 0, fontSize: 17 }}>Αλλαγή password</h2>
        <input
          type="password"
          placeholder="Τρέχον password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Νέο password (τουλάχιστον 8 χαρακτήρες)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
          required
        />
        <input
          type="password"
          placeholder="Επιβεβαίωση νέου password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          minLength={8}
          required
        />
        {error && <p className="error-text" style={{ margin: 0, fontSize: 13 }}>{error}</p>}
        {success && <p className="success-text" style={{ margin: 0, fontSize: 13 }}>Το password άλλαξε επιτυχώς.</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="secondary" onClick={onClose}>
            Κλείσιμο
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Αποθήκευση…' : 'Αποθήκευση'}
          </button>
        </div>
      </form>
    </div>
  );
}

function useServers() {
  const [data, setData] = useState<ServersApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/servers');
      if (!res.ok) {
        setError(res.status === 401 ? 'Η συνεδρία έληξε, κάνε login ξανά.' : `HTTP ${res.status}`);
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
  }, []);

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
    <div style={{ background: 'var(--border)', borderRadius: 4, height: 8, width: '100%', overflow: 'hidden' }}>
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
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{configuredName}</h2>
        <span style={{ fontSize: 12, color: ok ? 'var(--success)' : 'var(--danger)' }}>{ok ? '● online' : '● offline'}</span>
      </div>

      {!ok && (
        <p className="error-text" style={{ fontSize: 13, marginTop: 8 }}>
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

          <h3 className="muted" style={{ fontSize: 14, marginTop: 24, marginBottom: 8 }}>
            Projects
          </h3>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr className="muted" style={{ textAlign: 'left' }}>
                <th style={{ paddingBottom: 6 }}>Project</th>
                <th style={{ paddingBottom: 6 }}>RAM</th>
                <th style={{ paddingBottom: 6 }}>Disk</th>
                <th style={{ paddingBottom: 6 }}>Resources</th>
              </tr>
            </thead>
            <tbody>
              {data.projects.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted" style={{ padding: '8px 0' }}>
                    Δεν βρέθηκαν Coolify-managed containers.
                  </td>
                </tr>
              )}
              {data.projects.map((p) => (
                <tr key={p.projectName} style={{ borderTop: '1px solid var(--border)' }}>
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
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, marginBottom: 6 }}>{value}</div>
      <Bar percent={percent} />
    </div>
  );
}

function Dashboard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { data, error, loading, reload } = useServers();
  const { theme, toggle } = useTheme();
  const [showChangePassword, setShowChangePassword] = useState(false);

  const logout = async () => {
    await apiFetch('/api/logout', { method: 'POST' });
    onLogout();
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Coolify Telemetry</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 13, marginRight: 4 }}>
            {me.username}
          </span>
          <button type="button" className="secondary" onClick={toggle} title="Εναλλαγή θέματος">
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <button type="button" className="secondary" onClick={() => setShowChangePassword(true)}>
            Αλλαγή password
          </button>
          <button type="button" className="secondary" onClick={reload}>
            Refresh
          </button>
          <button type="button" className="danger" onClick={logout}>
            Αποσύνδεση
          </button>
        </div>
      </div>

      {loading && <p>Φόρτωση…</p>}
      {error && <p className="error-text">{error}</p>}

      {data && (
        <>
          <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
            Τελευταία ενημέρωση: {new Date(data.fetchedAt).toLocaleString('el-GR')} — αυτόματο refresh κάθε 30s
          </p>
          <div style={{ display: 'grid', gap: 20 }}>
            {data.servers.map((s) => (
              <ServerCard key={s.configuredName} result={s} />
            ))}
            {data.servers.length === 0 && (
              <p className="muted">
                Δεν έχει οριστεί κανένας server ακόμα. Πρόσθεσέ τους στο <code>SERVERS</code> env var του dashboard backend.
              </p>
            )}
          </div>
        </>
      )}

      {showChangePassword && <ChangePasswordPanel onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}

export default function App() {
  useTheme();
  const { me, checked, setMe } = useSession();

  if (!checked) {
    return <div style={{ padding: 24 }}>Φόρτωση…</div>;
  }

  if (!me) {
    return <LoginScreen onLoggedIn={setMe} />;
  }

  return <Dashboard me={me} onLogout={() => setMe(null)} />;
}
