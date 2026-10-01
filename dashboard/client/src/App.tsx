import { useEffect, useState, useCallback } from 'react';
import type { ServersApiResponse, ServerConfig, HistorySample } from './types';
import { formatBytes, formatPercent, formatDuration, percentColor } from './format';
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

function ModalShell({ onClose, children, width = 340 }: { onClose: () => void; children: React.ReactNode; width?: number }) {
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
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto' }}
      >
        {children}
      </div>
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
    <ModalShell onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
    </ModalShell>
  );
}

function useServerConfigs() {
  const [configs, setConfigs] = useState<ServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/server-configs');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setConfigs(json.servers ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { configs, loading, error, reload: load };
}

function ServerManagerPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { configs, loading, error, reload } = useServerConfigs();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setUrl('');
    setToken('');
    setEditingId(null);
    setFormError(null);
  };

  const startEdit = (cfg: ServerConfig) => {
    setEditingId(cfg.id);
    setName(cfg.name);
    setUrl(cfg.url);
    setToken('');
    setFormError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim() || !url.trim() || (!editingId && !token.trim())) {
      setFormError('Χρειάζονται όνομα, URL' + (editingId ? '' : ' και token') + '.');
      return;
    }
    setBusy(true);
    try {
      const res = editingId
        ? await apiFetch(`/api/server-configs/${editingId}`, {
            method: 'PATCH',
            body: JSON.stringify({ name, url, token: token || undefined }),
          })
        : await apiFetch('/api/server-configs', {
            method: 'POST',
            body: JSON.stringify({ name, url, token }),
          });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? 'Αποτυχία αποθήκευσης.');
        return;
      }
      resetForm();
      await reload();
      onChanged();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Σίγουρα θέλεις να αφαιρέσεις αυτόν τον server από το dashboard;')) return;
    await apiFetch(`/api/server-configs/${id}`, { method: 'DELETE' });
    await reload();
    onChanged();
  };

  return (
    <ModalShell onClose={onClose} width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Coolify servers</h2>

        {loading && <p className="muted">Φόρτωση…</p>}
        {error && <p className="error-text">{error}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {configs.map((cfg) => (
            <div
              key={cfg.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '10px 14px',
              }}
            >
              <div style={{ minWidth: 220 }}>
                <div style={{ fontSize: 14 }}>{cfg.name}</div>
                <div className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {cfg.url} · token {cfg.tokenPreview}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button type="button" className="secondary" onClick={() => startEdit(cfg)}>
                  Επεξεργασία
                </button>
                <button type="button" className="danger" onClick={() => remove(cfg.id)}>
                  Αφαίρεση
                </button>
              </div>
            </div>
          ))}
          {configs.length === 0 && !loading && (
            <p className="muted" style={{ fontSize: 13 }}>
              Δεν έχεις προσθέσει κανένα server ακόμα.
            </p>
          )}
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>{editingId ? 'Επεξεργασία server' : 'Προσθήκη νέου server'}</h3>
          <input type="text" placeholder="Όνομα (π.χ. Server 2)" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            type="text"
            placeholder="URL του agent (π.χ. http://xxxx.sslip.io)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <input
            type="password"
            placeholder={editingId ? 'Νέο agent token (άφησέ το κενό για να μην αλλάξει)' : 'Agent token (AGENT_TOKEN)'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          {formError && <p className="error-text" style={{ margin: 0, fontSize: 13 }}>{formError}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {editingId && (
              <button type="button" className="secondary" onClick={resetForm}>
                Άκυρο
              </button>
            )}
            <button type="submit" disabled={busy}>
              {busy ? 'Αποθήκευση…' : editingId ? 'Αποθήκευση' : 'Προσθήκη'}
            </button>
          </div>
        </form>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="secondary" onClick={onClose}>
            Κλείσιμο
          </button>
        </div>
      </div>
    </ModalShell>
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

function useHistory() {
  const [history, setHistory] = useState<Record<string, HistorySample[]>>({});
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/history?hours=24');
      if (!res.ok) return;
      const json = await res.json();
      setEnabled(Boolean(json.enabled));
      setHistory(json.history ?? {});
    } catch {
      // history is a nice-to-have - fail silently, dashboard keeps working
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  return { history, enabled };
}

/** Tiny inline SVG sparkline - no charting library needed for ~24h of 30s samples. */
function Sparkline({ samples, field, color }: { samples: HistorySample[]; field: keyof Omit<HistorySample, 'recordedAt'>; color: string }) {
  const values = samples.map((s) => s[field]).filter((v): v is number => v !== null);
  if (values.length < 2) {
    return <span className="muted" style={{ fontSize: 11 }}>όχι αρκετά δεδομένα ακόμα</span>;
  }
  const width = 160;
  const height = 28;
  const max = Math.max(100, ...values);
  const min = 0;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / (max - min)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
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

function ProjectRow({
  project,
  serverId,
  onPowerChanged,
}: {
  project: ServersApiResponse['servers'][number]['data'] extends undefined ? never : NonNullable<ServersApiResponse['servers'][number]['data']>['projects'][number];
  serverId: string;
  onPowerChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const runningCount = project.resources.filter((r) => r.state === 'running').length;
  const allRunning = runningCount === project.resources.length && project.resources.length > 0;
  const allStopped = runningCount === 0 && project.resources.length > 0;
  const totalRestarts = project.resources.reduce((sum, r) => sum + (r.restartCount ?? 0), 0);
  const uptimeSeconds = project.resources
    .filter((r) => r.state === 'running' && r.uptimeSeconds !== null)
    .reduce((min, r) => (min === null || r.uptimeSeconds! < min ? r.uptimeSeconds! : min), null as number | null);

  const act = async (action: 'start' | 'stop') => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch(
        `/api/server-configs/${serverId}/projects/${encodeURIComponent(project.projectName)}/${action}`,
        { method: 'POST' }
      );
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? `Αποτυχία ${action === 'start' ? 'εκκίνησης' : 'παύσης'}.`);
        return;
      }
      onPowerChanged();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <tr
      style={{
        borderTop: '1px solid var(--border)',
        color: project.hasProblem ? 'var(--danger)' : allStopped ? 'var(--warning)' : undefined,
      }}
    >
      <td style={{ padding: '6px 0', cursor: 'pointer' }} onClick={() => setExpanded((v) => !v)}>
        <span style={{ fontSize: 10, marginRight: 4, display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}>
          ▶
        </span>
        {project.projectName}
        {project.hasProblem && (
          <span style={{ fontSize: 11, marginLeft: 6 }} title={project.resources.find((r) => r.problem)?.problemReason ?? undefined}>
            ⚠ πρόβλημα
          </span>
        )}
        {!project.hasProblem && allStopped && <span style={{ fontSize: 11, marginLeft: 6 }}>⏸ paused</span>}
        {totalRestarts > 0 && (
          <span className="muted" style={{ fontSize: 11, marginLeft: 6 }} title="Σύνολο restarts των containers του project">
            ↻ {totalRestarts}
          </span>
        )}
        {actionError && (
          <div className="error-text" style={{ fontSize: 11 }}>
            {actionError}
          </div>
        )}
      </td>
      <td style={{ padding: '6px 0' }}>{formatBytes(project.memoryUsedBytes)}</td>
      <td style={{ padding: '6px 0' }}>{formatBytes(project.diskBytes)}</td>
      <td style={{ padding: '6px 0' }}>{project.resources.length}</td>
      <td style={{ padding: '6px 0' }}>
        {uptimeSeconds !== null ? formatDuration(uptimeSeconds) : allStopped ? '—' : '—'}
      </td>
      <td
        style={{ padding: '6px 0', color: project.maxRestartCount > 0 ? 'var(--warning)' : undefined }}
        title={project.maxRestartCount > 0 ? 'Έχει κάνει auto-restart πρόσφατα (crash/healthcheck) - πιθανό σημάδι αστάθειας' : undefined}
      >
        {project.maxRestartCount > 0 ? `↻ ${project.maxRestartCount}` : '—'}
      </td>
      <td style={{ padding: '6px 0' }}>
        {project.url && (
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 12 }}
            title="Άνοιγμα project"
          >
            🔗 Open
          </a>
        )}
        {project.check && (
          <span
            className={project.check.reachable ? 'muted' : 'error-text'}
            style={{ fontSize: 11, marginLeft: 8 }}
            title={
              project.check.error
                ? `Σφάλμα: ${project.check.error}`
                : `HTTP ${project.check.statusCode}${project.check.tlsDaysRemaining !== null ? ` · TLS λήγει σε ${project.check.tlsDaysRemaining} ημέρες` : ''}`
            }
          >
            {project.check.reachable ? `${project.check.latencyMs}ms` : '✕ down'}
            {project.check.tlsDaysRemaining !== null && project.check.tlsDaysRemaining <= 14 && (
              <span style={{ color: 'var(--warning)' }}> · 🔒 {project.check.tlsDaysRemaining}d</span>
            )}
          </span>
        )}
      </td>
      <td style={{ padding: '6px 0', textAlign: 'right' }}>
        {!allStopped && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => act('stop')}
            style={{ fontSize: 12, padding: '4px 10px', marginRight: 6 }}
            title="Σταμάτημα όλων των containers αυτού του project"
          >
            ⏸ Pause
          </button>
        )}
        {!allRunning && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => act('start')}
            style={{ fontSize: 12, padding: '4px 10px' }}
            title="Εκκίνηση όλων των containers αυτού του project"
          >
            ▶ Start
          </button>
        )}
      </td>
    </tr>
    {expanded && (
      <tr style={{ borderTop: '1px dashed var(--border)' }}>
        <td colSpan={8} style={{ padding: '6px 0 10px 18px' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr className="muted" style={{ textAlign: 'left' }}>
                <th style={{ paddingBottom: 4, fontWeight: 400 }}>Resource</th>
                <th style={{ paddingBottom: 4, fontWeight: 400 }}>Image</th>
                <th style={{ paddingBottom: 4, fontWeight: 400 }}>Status</th>
                <th style={{ paddingBottom: 4, fontWeight: 400 }}>Restarts</th>
              </tr>
            </thead>
            <tbody>
              {project.resources.map((r) => (
                <tr key={r.containerName} style={{ color: r.problem ? 'var(--danger)' : undefined }}>
                  <td style={{ padding: '2px 0' }}>{r.resourceName ?? r.containerName}</td>
                  <td className="muted" style={{ padding: '2px 0' }}>{r.image}</td>
                  <td style={{ padding: '2px 0' }}>{r.status}</td>
                  <td style={{ padding: '2px 0' }}>{r.restartCount > 0 ? `↻ ${r.restartCount}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </td>
      </tr>
    )}
    </>
  );
}

function ServerCard({
  result,
  onPowerChanged,
  history,
  historyEnabled,
}: {
  result: ServersApiResponse['servers'][number];
  onPowerChanged: () => void;
  history: HistorySample[];
  historyEnabled: boolean;
}) {
  const { serverId, configuredName, ok, error, data } = result;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card">
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: 16, flexWrap: 'wrap' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', display: 'inline-block' }}>
            ▶
          </span>
          <h2 style={{ margin: 0, fontSize: 18 }}>{configuredName}</h2>
          <span style={{ fontSize: 12, color: ok ? 'var(--success)' : 'var(--danger)' }}>{ok ? '● online' : '● offline'}</span>
        </div>

        {ok && data && (
          <div style={{ display: 'flex', gap: 20, fontSize: 13 }} className="muted">
            <span>CPU {formatPercent(data.cpu?.percent)}</span>
            <span>RAM {formatPercent(data.memory?.usedPercent)}</span>
            <span>Disk {formatPercent(data.disk?.usedPercent)}</span>
            {data.missingResources.length > 0 && (
              <span style={{ color: 'var(--danger)' }}>
                ⚠ {data.missingResources.length} εξαφανισμένο{data.missingResources.length > 1 ? 'α' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {!ok && (
        <p className="error-text" style={{ fontSize: 13, marginTop: 8 }}>
          Δεν απάντησε ο agent: {error}
        </p>
      )}

      {ok && data && expanded && (
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

          {historyEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 16 }}>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>CPU (24ω)</div>
                <Sparkline samples={history} field="cpuPercent" color="#f5a623" />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>RAM (24ω)</div>
                <Sparkline samples={history} field="memoryUsedPercent" color="#5b8def" />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>Disk (24ω)</div>
                <Sparkline samples={history} field="diskUsedPercent" color="#30a46c" />
              </div>
            </div>
          )}

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
                <th style={{ paddingBottom: 6 }}>Uptime</th>
                <th style={{ paddingBottom: 6 }}>Restarts</th>
                <th style={{ paddingBottom: 6 }}>Link</th>
                <th style={{ paddingBottom: 6 }}></th>
              </tr>
            </thead>
            <tbody>
              {data.projects.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ padding: '8px 0' }}>
                    Δεν βρέθηκαν Coolify-managed containers.
                  </td>
                </tr>
              )}
              {data.projects.map((p) => (
                <ProjectRow key={p.projectName} project={p} serverId={serverId} onPowerChanged={onPowerChanged} />
              ))}
            </tbody>
          </table>

          {data.missingResources.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, marginTop: 24, marginBottom: 8, color: 'var(--danger)' }}>
                ⚠ Containers που εξαφανίστηκαν
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.missingResources.map((m, i) => (
                  <div key={i} style={{ fontSize: 13, color: 'var(--danger)' }}>
                    <strong>{m.projectName}</strong> / {m.resourceName}
                    <span className="muted" style={{ opacity: 0.85 }}>
                      {' '}
                      · λείπει εδώ και {formatDuration(m.missingForSeconds)} (τελευταία φορά{' '}
                      {new Date(m.lastSeenAt).toLocaleString('el-GR')})
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {data.links.length > 0 && (
            <>
              <h3 className="muted" style={{ fontSize: 14, marginTop: 24, marginBottom: 8 }}>
                Συνδέσεις μεταξύ projects
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.links.map((link, i) => (
                  <div key={i} style={{ fontSize: 13 }}>
                    <strong>{link.fromProject}</strong> ({link.fromContainer}) → <strong>{link.toProject}</strong> (
                    {link.toContainer})
                    <span className="muted"> · μέσω {link.viaHostname}</span>
                  </div>
                ))}
              </div>
            </>
          )}
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
  const { history, enabled: historyEnabled } = useHistory();
  const { theme, toggle } = useTheme();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showServerManager, setShowServerManager] = useState(false);

  const logout = async () => {
    await apiFetch('/api/logout', { method: 'POST' });
    onLogout();
  };

  // A start/stop just changed container states - reload after a short
  // delay so the agent's next docker list actually reflects the change.
  const onPowerChanged = () => {
    setTimeout(reload, 1500);
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Coolify Telemetry</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 13, marginRight: 4 }}>
            {me.username}
          </span>
          <button type="button" className="secondary" onClick={toggle} title="Εναλλαγή θέματος">
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <button type="button" className="secondary" onClick={() => setShowServerManager(true)}>
            Servers
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
              <ServerCard
                key={s.serverId}
                result={s}
                onPowerChanged={onPowerChanged}
                history={history[s.serverId] ?? []}
                historyEnabled={historyEnabled}
              />
            ))}
            {data.servers.length === 0 && (
              <p className="muted">
                Δεν έχεις προσθέσει κανένα server ακόμα. Πάτα <strong>Servers</strong> πάνω δεξιά για να προσθέσεις τον
                πρώτο.
              </p>
            )}
          </div>
        </>
      )}

      {showChangePassword && <ChangePasswordPanel onClose={() => setShowChangePassword(false)} />}
      {showServerManager && (
        <ServerManagerPanel onClose={() => setShowServerManager(false)} onChanged={reload} />
      )}
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
