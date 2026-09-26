// Coolify Telemetry extension popup logic.
// Talks to the dashboard backend's /api/servers endpoint (see ../dashboard),
// which in turn aggregates the per-server telemetry agents (see ../agent).

const STORAGE_KEYS = {
  url: 'dashboardUrl',
  password: 'dashboardPassword',
};

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function percentColor(value) {
  if (value === null || value === undefined) return '#888';
  if (value >= 90) return '#e5484d';
  if (value >= 70) return '#f5a623';
  return '#30a46c';
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.url, STORAGE_KEYS.password], (result) => {
      resolve({
        url: result[STORAGE_KEYS.url] || '',
        password: result[STORAGE_KEYS.password] || '',
      });
    });
  });
}

async function saveSettings(url, password) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(
      { [STORAGE_KEYS.url]: url, [STORAGE_KEYS.password]: password },
      resolve
    );
  });
}

function metricBlock(label, value, percent) {
  return `
    <div>
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="bar"><div class="bar-fill" style="width:${Math.min(percent ?? 0, 100)}%;background:${percentColor(percent)}"></div></div>
    </div>
  `;
}

function renderServers(servers) {
  const container = document.getElementById('servers');
  if (!servers || servers.length === 0) {
    container.innerHTML = '<div id="status">Δεν έχουν οριστεί servers στο dashboard.</div>';
    return;
  }

  container.innerHTML = servers
    .map((s) => {
      if (!s.ok || !s.data) {
        return `
          <div class="server">
            <div class="server-name"><span>${s.configuredName}</span><span class="status-bad">● offline</span></div>
            <div style="font-size:11px;opacity:0.7">${s.error ?? 'Άγνωστο σφάλμα'}</div>
          </div>
        `;
      }
      const d = s.data;
      return `
        <div class="server">
          <div class="server-name"><span>${s.configuredName}</span><span class="status-ok">● online</span></div>
          <div class="metrics">
            ${metricBlock('CPU', formatPercent(d.cpu?.percent), d.cpu?.percent)}
            ${metricBlock('RAM', formatBytes(d.memory?.usedBytes), d.memory?.usedPercent)}
            ${metricBlock('Disk', formatBytes(d.disk?.usedBytes), d.disk?.usedPercent)}
          </div>
        </div>
      `;
    })
    .join('');
}

async function load() {
  const statusEl = document.getElementById('status');
  const { url, password } = await getSettings();

  if (!url) {
    statusEl.textContent = 'Ρύθμισε το Dashboard URL στα Settings.';
    document.getElementById('settings').classList.add('visible');
    return;
  }

  statusEl.textContent = 'Φόρτωση…';
  try {
    const headers = {};
    if (password) headers.Authorization = `Bearer ${password}`;
    const res = await fetch(`${url.replace(/\/$/, '')}/api/servers`, { headers });
    if (!res.ok) {
      statusEl.textContent = res.status === 401 ? 'Λάθος password.' : `HTTP ${res.status}`;
      return;
    }
    const json = await res.json();
    renderServers(json.servers);
    statusEl.textContent = `Ενημερώθηκε: ${new Date(json.fetchedAt).toLocaleTimeString('el-GR')}`;
  } catch (err) {
    statusEl.textContent = `Σφάλμα: ${err.message}`;
  }
}

document.getElementById('toggleSettings').addEventListener('click', () => {
  document.getElementById('settings').classList.toggle('visible');
});

document.getElementById('saveSettings').addEventListener('click', async () => {
  const url = document.getElementById('dashboardUrl').value.trim();
  const password = document.getElementById('dashboardPassword').value;
  await saveSettings(url, password);
  document.getElementById('settings').classList.remove('visible');
  load();
});

(async function init() {
  const { url, password } = await getSettings();
  document.getElementById('dashboardUrl').value = url;
  document.getElementById('dashboardPassword').value = password;
  load();
})();
