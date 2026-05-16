// main.js - 首页前端逻辑（表格+网格双视图+趋势图+Telegram通知触发）

let vpsUpdateInterval = null;
let siteUpdateInterval = null;
let serverDataCache = {};
let vpsStatusCache = {};
let currentView = localStorage.getItem('vps-monitor-view') || 'table';
const DEFAULT_VPS_INTERVAL = 60000;
const DEFAULT_SITE_INTERVAL = 3600000;

// ========== 视图切换 ==========
window.switchView = function(view) {
  currentView = view;
  localStorage.setItem('vps-monitor-view', view);
  document.getElementById('btnTableView').classList.toggle('active', view === 'table');
  document.getElementById('btnGridView').classList.toggle('active', view === 'grid');
  document.getElementById('tableView').classList.toggle('d-none', view !== 'table');
  document.getElementById('gridView').classList.toggle('d-none', view !== 'grid');
  if (view === 'grid') renderServerGrid(Object.values(serverDataCache));
};

// ========== API工具 ==========
function getAuthHeaders() {
  const token = localStorage.getItem('auth_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return headers;
}

async function publicApi(url, opts = {}) {
  try {
    const resp = await fetch(url, { headers: getAuthHeaders(), ...opts });
    if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.message || 'Request failed'); }
    return await resp.json();
  } catch (e) { throw e; }
}

// ========== 格式化工具 ==========
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatSpeed(bps) {
  if (!bps || bps === 0) return '0 B/s';
  return formatSize(bps) + '/s';
}

function formatUptime(sec) {
  if (!sec || sec <= 0) return '-';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return (d > 0 ? d + 'd ' : '') + h + 'h ' + m + 'm';
}

function getStatusBadge(status) {
  const map = { online: 'bg-success', offline: 'bg-danger', error: 'bg-warning text-dark', unknown: 'bg-secondary' };
  return { class: map[status] || 'bg-secondary', text: { online: '在线', offline: '离线', error: '错误', unknown: '未知' }[status] || '未知' };
}

function getProgressBar(pct) {
  if (typeof pct !== 'number' || isNaN(pct)) return '-';
  const p = Math.max(0, Math.min(100, pct));
  let cls = 'bg-light-green';
  if (p >= 80) cls = 'bg-danger';
  else if (p >= 50) cls = 'bg-warning';
  return `<div class="progress" style="height:22px;font-size:0.75em;position:relative">
    <div class="progress-bar ${cls}" style="width:${p}%"></div>
    <span style="position:absolute;width:100%;text-align:center;line-height:22px;font-weight:bold">${p.toFixed(1)}%</span>
  </div>`;
}

function getTimeAgo(ts) {
  if (!ts) return '从未';
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return diff + '秒前';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  return Math.floor(diff / 86400) + '天前';
}

function determineStatus(data) {
  if (data.error) return 'error';
  if (!data.metrics) return 'unknown';
  const diffMin = (Date.now() - data.metrics.timestamp * 1000) / 60000;
  return diffMin <= 5 ? 'online' : 'offline';
}

// ========== 数据加载 ==========
async function loadAllServers() {
  try {
    const data = await publicApi('/api/status/batch');
    const allStatuses = data.servers || [];
    const alert = document.getElementById('noServers');

    if (allStatuses.length === 0) {
      if (alert) alert.classList.remove('d-none');
      document.getElementById('serverTableBody').innerHTML = '<tr><td colspan="8" class="text-center">没有服务器数据</td></tr>';
      renderServerGrid([]);
      renderMobileCards([]);
      return;
    }
    if (alert) alert.classList.add('d-none');

    allStatuses.forEach(s => { serverDataCache[s.server.id] = s; });

    await checkStatusChanges(allStatuses);
    renderServerTable(allStatuses);
    renderServerGrid(allStatuses);
    renderMobileCards(allStatuses);

  } catch (e) {
    document.getElementById('serverTableBody').innerHTML = '<tr><td colspan="8" class="text-center text-danger">加载失败</td></tr>';
    showToast('danger', '加载服务器数据失败: ' + e.message);
  }
}

// ========== 状态变化通知 ==========
async function checkStatusChanges(allStatuses) {
  for (const data of allStatuses) {
    const id = data.server.id;
    const name = data.server.name;
    const status = determineStatus(data);
    const prev = vpsStatusCache[id];

    if (prev !== undefined && prev !== status) {
      if (status === 'offline') {
        await fetch('/api/notify/offline', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverId: id, serverName: name })
        }).catch(() => {});
      } else if (status === 'online' && prev === 'offline') {
        await fetch('/api/notify/recovery', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverId: id, serverName: name })
        }).catch(() => {});
      }
    }
    vpsStatusCache[id] = status;
  }
}

// ========== 表格视图 ==========
function renderServerTable(allStatuses) {
  const tbody = document.getElementById('serverTableBody');
  let html = '';
  allStatuses.forEach(data => {
    const s = data.server;
    const m = data.metrics;
    const status = determineStatus(data);
    const badge = getStatusBadge(status);
    const cpu = m?.cpu?.usage_percent;
    const mem = m?.memory?.usage_percent;
    const disk = m?.disk?.usage_percent;
    const up = m?.network?.upload_speed;
    const down = m?.network?.download_speed;
    const uptime = m?.uptime;
    const updated = getTimeAgo(m?.timestamp);
    html += `<tr class="server-row" data-server-id="${s.id}">
      <td><strong>${s.name || s.id}</strong></td>
      <td><span class="badge ${badge.class}">${badge.text}</span></td>
      <td>${getProgressBar(cpu)}</td>
      <td>${getProgressBar(mem)}</td>
      <td>${getProgressBar(disk)}</td>
      <td><small>↑${formatSpeed(up)} ↓${formatSpeed(down)}</small></td>
      <td><small>${formatUptime(uptime)}</small></td>
      <td><small class="text-muted">${updated}</small></td>
    </tr>`;
  });
  tbody.innerHTML = html;
}

// ========== 网格/卡片视图 ==========
function renderServerGrid(allStatuses) {
  if (currentView !== 'grid') return;
  const grid = document.getElementById('serverGrid');
  let html = '';
  allStatuses.forEach(data => {
    const s = data.server;
    const m = data.metrics;
    const status = determineStatus(data);
    const cpu = m?.cpu?.usage_percent;
    const mem = m?.memory?.usage_percent;
    const disk = m?.disk?.usage_percent;
    const upSpeed = formatSpeed(m?.network?.upload_speed);
    const downSpeed = formatSpeed(m?.network?.download_speed);

    html += `<div class="server-card ${status}" data-server-id="${s.id}" onclick="toggleCardDetail(this, '${s.id}')">
      <span class="badge ${getStatusBadge(status).class} status-badge">${getStatusBadge(status).text}</span>
      <div class="card-title">${s.name || s.id}</div>
      <div class="metric-grid">
        <div class="metric-item"><span class="metric-label">CPU</span><span class="metric-value">${typeof cpu === 'number' ? cpu.toFixed(1) + '%' : '-'}</span></div>
        <div class="metric-item"><span class="metric-label">内存</span><span class="metric-value">${typeof mem === 'number' ? mem.toFixed(1) + '%' : '-'}</span></div>
        <div class="metric-item"><span class="metric-label">硬盘</span><span class="metric-value">${typeof disk === 'number' ? disk.toFixed(1) + '%' : '-'}</span></div>
        <div class="metric-item"><span class="metric-label">运行时长</span><span class="metric-value">${formatUptime(m?.uptime)}</span></div>
      </div>
      <div style="margin-top:0.5rem;"><small class="text-muted">↑${upSpeed} ↓${downSpeed} · ${getTimeAgo(m?.timestamp)}</small></div>
      <canvas class="mini-chart" id="chart-${s.id}" width="300" height="40"></canvas>
    </div>`;
  });
  grid.innerHTML = html;

  // 渲染迷你趋势图
  allStatuses.forEach(data => {
    drawMiniChart(data.server.id, data.server.name);
  });
}

// ========== 迷你趋势图 (Canvas) ==========
async function drawMiniChart(serverId, name) {
  const canvas = document.getElementById('chart-' + serverId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.parentElement.clientWidth - 30;
  canvas.width = w;
  canvas.height = 40;

  try {
    const resp = await publicApi('/api/history/' + serverId + '/24');
    const history = resp.history || [];
    if (history.length < 2) {
      ctx.fillStyle = '#6c757d';
      ctx.font = '12px sans-serif';
      ctx.fillText('暂无历史数据', 10, 25);
      return;
    }

    const cpuData = history.map(h => h.cpu_usage);
    const maxVal = Math.max(...cpuData, 1);
    const barW = (w - 4) / cpuData.length;

    ctx.clearRect(0, 0, w, 40);

    // 背景网格线
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 0.5;
    [10, 20, 30].forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); });

    // CPU使用率柱状图
    cpuData.forEach((val, i) => {
      const h = Math.max(2, (val / maxVal) * 38);
      const x = i * barW + 1;
      const y = 40 - h;
      const gradient = ctx.createLinearGradient(x, y, x, 40);
      gradient.addColorStop(0, val > 80 ? '#dc3545' : val > 50 ? '#ffc107' : '#28a745');
      gradient.addColorStop(1, 'rgba(255,255,255,0.1)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barW - 2, h);
    });

  } catch (e) {
    ctx.fillStyle = '#6c757d';
    ctx.font = '10px sans-serif';
    ctx.fillText('加载历史失败', 10, 25);
  }
}

window.toggleCardDetail = function(card, serverId) {
  const data = serverDataCache[serverId];
  if (!data?.metrics) return;
  const m = data.metrics;
  const html = `
    <div style="padding:1rem">
      <h6>${data.server.name} 详细信息</h6>
      <div class="row">
        <div class="col-6"><small>CPU负载: ${m.cpu?.load_avg?.join(' / ') || '-'}</small></div>
        <div class="col-6"><small>内存: ${formatSize((m.memory?.used || 0) * 1024)} / ${formatSize((m.memory?.total || 0) * 1024)}</small></div>
        <div class="col-6"><small>硬盘: ${(m.disk?.used || 0).toFixed(1)} / ${(m.disk?.total || 0).toFixed(1)} GB</small></div>
        <div class="col-6"><small>上传: ${formatSize(m.network?.total_upload || 0)} | 下载: ${formatSize(m.network?.total_download || 0)}</small></div>
      </div>
    </div>`;
  showToast('info', html, 5000);
};

// ========== 移动端卡片 ==========
function renderMobileCards(allStatuses) {
  const container = document.getElementById('mobileServerContainer');
  if (!container) return;
  if (allStatuses.length === 0) {
    container.innerHTML = '<div class="text-center p-4 text-muted"><i class="bi bi-server" style="font-size:3rem"></i><p>暂无数据</p></div>';
    return;
  }
  let html = '';
  allStatuses.forEach(data => {
    const s = data.server, m = data.metrics;
    const status = determineStatus(data);
    const badge = getStatusBadge(status);
    const cpu = m?.cpu?.usage_percent, mem = m?.memory?.usage_percent;
    const disk = m?.disk?.usage_percent;
    html += `<div class="mobile-server-card">
      <div class="d-flex justify-content-between mb-2">
        <strong>${s.name || s.id}</strong>
        <span class="badge ${badge.class}">${badge.text}</span>
      </div>
      <div class="mobile-card-two-columns">
        <div><span class="mobile-card-label">CPU</span><span class="mobile-card-value">${typeof cpu === 'number' ? cpu.toFixed(1)+'%' : '-'}</span></div>
        <div><span class="mobile-card-label">内存</span><span class="mobile-card-value">${typeof mem === 'number' ? mem.toFixed(1)+'%' : '-'}</span></div>
      </div>
      <div class="mobile-card-two-columns">
        <div><span class="mobile-card-label">硬盘</span><span class="mobile-card-value">${typeof disk === 'number' ? disk.toFixed(1)+'%' : '-'}</span></div>
        <div><span class="mobile-card-label">运行时长</span><span class="mobile-card-value">${formatUptime(m?.uptime)}</span></div>
      </div>
      <small class="text-muted">↑${formatSpeed(m?.network?.upload_speed)} ↓${formatSpeed(m?.network?.download_speed)} · ${getTimeAgo(m?.timestamp)}</small>
    </div>`;
  });
  container.innerHTML = html;
}

// ========== 网站状态 ==========
async function loadSiteStatuses() {
  try {
    const data = await publicApi('/api/sites/status');
    const sites = data.sites || [];
    renderSiteTable(sites);
    renderMobileSiteCards(sites);
  } catch (e) { /* 静默 */ }
}

function renderSiteTable(sites) {
  const tbody = document.getElementById('siteTableBody');
  let html = '';
  sites.forEach(site => {
    const badge = getStatusBadge({ UP: 'online', DOWN: 'offline', ERROR: 'error', TIMEOUT: 'offline' }[site.last_status] || 'unknown');
    const respTime = site.last_response_time_ms ? site.last_response_time_ms + 'ms' : '-';
    const historyBar = (site.history || []).slice(0, 24).map(h =>
      `<span class="history-bar ${h.status === 'UP' ? 'up' : 'down'}"></span>`
    ).join('');
    html += `<tr>
      <td>${site.name || site.id}</td>
      <td><small class="text-muted">${site.url}</small></td>
      <td><span class="badge ${badge.class}">${badge.text}</span></td>
      <td>${respTime}</td>
      <td><div class="history-bar-container">${historyBar}</div></td>
    </tr>`;
  });
  tbody.innerHTML = html || '<tr><td colspan="5" class="text-center">暂无监控站点</td></tr>';
}

function renderMobileSiteCards(sites) {
  const container = document.getElementById('mobileSiteContainer');
  if (!container || sites.length === 0) { if (container) container.innerHTML = ''; return; }
  let html = '';
  sites.forEach(site => {
    const badge = getStatusBadge({ UP: 'online', DOWN: 'offline', ERROR: 'error' }[site.last_status] || 'unknown');
    html += `<div class="mobile-server-card">
      <div class="d-flex justify-content-between"><strong>${site.name || site.id}</strong><span class="badge ${badge.class}">${badge.text}</span></div>
      <small class="text-muted">${site.url}</small>
      <small class="d-block">${site.last_response_time_ms ? site.last_response_time_ms+'ms' : '-'} · ${getTimeAgo(site.last_checked)}</small>
    </div>`;
  });
  container.innerHTML = html;
}

// ========== Toast通知 ==========
function showToast(type, message, duration = 3000) {
  let container = document.querySelector('.toast-container');
  if (!container) { container = document.createElement('div'); container.className = 'toast-container'; document.body.appendChild(container); }
  const el = document.createElement('div');
  const cls = { info: 'alert-info', success: 'alert-success', danger: 'alert-danger', warning: 'alert-warning' };
  el.className = 'toast-item alert ' + (cls[type] || 'alert-info');
  el.innerHTML = message;
  container.appendChild(el);
  setTimeout(() => { el.remove(); if (container.children.length === 0) container.remove(); }, duration);
}

// ========== 主题管理 ==========
function initTheme() {
  const toggler = document.getElementById('themeToggler');
  if (!toggler) return;
  const stored = localStorage.getItem('vps-monitor-theme') || 'light';
  applyTheme(stored);
  toggler.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-bs-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('vps-monitor-theme', next);
  });
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-bs-theme', theme);
  const icon = document.querySelector('#themeToggler i');
  if (icon) { icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill'; }
}

// ========== 定时刷新 ==========
async function initVpsRefresh() {
  let interval = DEFAULT_VPS_INTERVAL;
  try {
    const data = await publicApi('/api/admin/settings/vps-report-interval');
    if (data?.interval > 0) interval = data.interval * 1000;
  } catch (e) {}
  if (vpsUpdateInterval) clearInterval(vpsUpdateInterval);
  vpsUpdateInterval = setInterval(loadAllServers, interval);
}

function initSiteRefresh() {
  if (siteUpdateInterval) clearInterval(siteUpdateInterval);
  siteUpdateInterval = setInterval(loadSiteStatuses, DEFAULT_SITE_INTERVAL);
}

// ========== 管理员链接 ==========
async function updateAdminLink() {
  const link = document.getElementById('adminAuthLink');
  if (!link) return;
  const token = localStorage.getItem('auth_token');
  if (!token) { link.textContent = '管理员登录'; link.href = '/login.html'; return; }
  try {
    const data = await publicApi('/api/auth/status');
    if (data.authenticated) { link.textContent = '管理后台'; link.href = '/admin.html'; }
    else { link.textContent = '管理员登录'; link.href = '/login.html'; localStorage.removeItem('auth_token'); }
  } catch (e) { link.textContent = '管理员登录'; link.href = '/login.html'; }
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', function() {
  if (!document.getElementById('serverTableBody')) { initTheme(); return; }
  initTheme();
  switchView(currentView);

  loadAllServers();
  loadSiteStatuses();
  initVpsRefresh();
  initSiteRefresh();
  updateAdminLink();

  // 点击表格行展开详情
  document.getElementById('serverTableBody').addEventListener('click', function(e) {
    const row = e.target.closest('.server-row');
    if (!row) return;
    const id = row.getAttribute('data-server-id');
    const data = serverDataCache[id];
    if (!data?.metrics) return;
    const m = data.metrics;
    showToast('info', `
      <h6>${data.server.name}</h6>
      CPU负载: ${m.cpu?.load_avg?.join(' / ') || '-'}<br>
      内存: ${formatSize((m.memory?.used||0)*1024)} / ${formatSize((m.memory?.total||0)*1024)}<br>
      硬盘: ${(m.disk?.used||0).toFixed(1)} / ${(m.disk?.total||0).toFixed(1)} GB<br>
      流量: ↑${formatSize(m.network?.total_upload||0)} ↓${formatSize(m.network?.total_download||0)}
    `, 5000);
  });
});
