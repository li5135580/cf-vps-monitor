// admin.js - 管理后台逻辑

let authToken = localStorage.getItem('auth_token');

function getHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (authToken) h['Authorization'] = 'Bearer ' + authToken;
  return h;
}

async function api(url, opts = {}) {
  const resp = await fetch(url, { headers: getHeaders(), ...opts });
  if (resp.status === 401) { localStorage.removeItem('auth_token'); window.location.href = '/login.html'; throw new Error('Unauthorized'); }
  if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.message || 'Request failed'); }
  return resp.json();
}

function showToast(type, msg) {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const el = document.createElement('div');
  el.className = 'toast-item alert ' + ({ success: 'alert-success', danger: 'alert-danger', warning: 'alert-warning' }[type] || 'alert-info');
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.remove(); if (c.children.length === 0) c.remove(); }, 3000);
}

window.logout = function() {
  localStorage.removeItem('auth_token');
  window.location.href = '/';
};

// ========== 主题 ==========
function initTheme() {
  const toggler = document.getElementById('themeToggler');
  if (!toggler) return;
  const stored = localStorage.getItem('vps-monitor-theme') || 'light';
  applyTheme(stored);
  toggler.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('vps-monitor-theme', next);
  });
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-bs-theme', theme);
  const icon = document.querySelector('#themeToggler i');
  if (icon) icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
}

// ========== 标签切换 ==========
function initTabs() {
  document.querySelectorAll('#adminTabs [data-tab]').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('#adminTabs [data-tab]').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      loadTab(this.dataset.tab);
    });
  });
}

async function loadTab(tab) {
  const ct = document.getElementById('tabContent');
  switch (tab) {
    case 'servers': await renderServersTab(ct); break;
    case 'sites': await renderSitesTab(ct); break;
    case 'telegram': await renderTelegramTab(ct); break;
    case 'background': await renderBackgroundTab(ct); break;
    case 'settings': await renderSettingsTab(ct); break;
  }
}

// ========== 服务器管理 ==========
async function renderServersTab(ct) {
  ct.innerHTML = `<div class="text-center py-4"><div class="spinner-border"></div></div>`;
  const data = await api('/api/admin/servers');
  const servers = data.servers || [];
  ct.innerHTML = `
    <div class="d-flex justify-content-between mb-3">
      <h6>服务器列表 (${servers.length})</h6>
      <button class="btn btn-sm btn-primary" onclick="showServerForm()"><i class="bi bi-plus-lg"></i> 添加服务器</button>
    </div>
    <div class="table-responsive">
      <table class="table table-hover table-sm">
        <thead><tr><th>名称</th><th>ID</th><th>公开</th><th>排序</th><th>操作</th></tr></thead>
        <tbody>${servers.map(s => `<tr>
          <td>${s.name}</td><td><code>${s.id}</code></td>
          <td><span class="badge ${s.is_public ? 'bg-success' : 'bg-secondary'}">${s.is_public ? '公开' : '隐藏'}</span></td>
          <td>${s.sort_order ?? '-'}</td>
          <td>
            <button class="btn btn-sm btn-outline-secondary" onclick="copyInstallCmd('${s.id}','${s.name}')"><i class="bi bi-clipboard"></i></button>
            <button class="btn btn-sm btn-outline-danger" onclick="deleteServer('${s.id}')"><i class="bi bi-trash"></i></button>
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div id="serverFormModal" class="modal fade"><div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">添加/编辑服务器</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <form id="serverForm" onsubmit="return saveServer(event)">
          <div class="mb-2"><label class="form-label">服务器ID</label><input class="form-control" id="srvId" required></div>
          <div class="mb-2"><label class="form-label">名称</label><input class="form-control" id="srvName" required></div>
          <div class="mb-2"><label class="form-label">描述</label><input class="form-control" id="srvDesc"></div>
          <div class="mb-2"><label class="form-label">API密钥</label><input class="form-control" id="srvKey" required></div>
          <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="srvPublic" checked><label class="form-check-label">公开</label></div>
          <button type="submit" class="btn btn-primary w-100">保存</button>
        </form>
      </div>
    </div></div></div>`;
}

window.showServerForm = function() {
  new bootstrap.Modal(document.getElementById('serverFormModal')).show();
};

window.saveServer = async function(e) {
  e.preventDefault();
  const id = document.getElementById('srvId').value.trim();
  const name = document.getElementById('srvName').value.trim();
  const description = document.getElementById('srvDesc').value.trim();
  const api_key = document.getElementById('srvKey').value.trim();
  const is_public = document.getElementById('srvPublic').checked;
  if (!id || !name || !api_key) { showToast('danger', '必填项不能为空'); return false; }
  try {
    await api('/api/admin/servers', { method: 'POST', body: JSON.stringify({ id, name, description, api_key, is_public }) });
    bootstrap.Modal.getInstance(document.getElementById('serverFormModal')).hide();
    showToast('success', '服务器已添加');
    loadTab('servers');
  } catch (e) { showToast('danger', '添加失败: ' + e.message); }
  return false;
};

window.deleteServer = async function(id) {
  if (!confirm('确定删除服务器 ' + id + '？')) return;
  try { await api('/api/admin/servers/' + id, { method: 'DELETE' }); showToast('success', '已删除'); loadTab('servers'); }
  catch (e) { showToast('danger', '删除失败: ' + e.message); }
};

window.copyInstallCmd = function(sid, sname) {
  const apiKey = prompt('请输入此服务器的API密钥:');
  if (!apiKey) return;
  const cmd = `curl -sSL ${window.location.origin}/install.sh | bash -s -- -k ${apiKey} -s ${sid}`;
  navigator.clipboard.writeText(cmd).then(() => showToast('success', '安装命令已复制')).catch(() => showToast('danger', '复制失败'));
};

// ========== 站点管理 ==========
async function renderSitesTab(ct) {
  const data = await api('/api/admin/sites');
  const sites = data.sites || [];
  ct.innerHTML = `
    <div class="d-flex justify-content-between mb-3"><h6>站点列表 (${sites.length})</h6><button class="btn btn-sm btn-primary" onclick="showSiteForm()"><i class="bi bi-plus-lg"></i> 添加站点</button></div>
    <div class="table-responsive"><table class="table table-hover table-sm">
      <thead><tr><th>名称</th><th>URL</th><th>状态</th><th>公开</th><th>操作</th></tr></thead>
      <tbody>${sites.map(s => `<tr>
        <td>${s.name || s.id}</td><td><small>${s.url}</small></td>
        <td><span class="badge ${s.last_status === 'UP' ? 'bg-success' : 'bg-secondary'}">${s.last_status || '未知'}</span></td>
        <td><span class="badge ${s.is_public ? 'bg-success' : 'bg-secondary'}">${s.is_public ? '公开' : '隐藏'}</span></td>
        <td><button class="btn btn-sm btn-outline-danger" onclick="deleteSite('${s.id}')"><i class="bi bi-trash"></i></button></td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div id="siteFormModal" class="modal fade"><div class="modal-dialog"><div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">添加站点</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <form id="siteForm" onsubmit="return saveSite(event)">
          <div class="mb-2"><label class="form-label">站点ID</label><input class="form-control" id="siteId" required></div>
          <div class="mb-2"><label class="form-label">URL</label><input class="form-control" type="url" id="siteUrl" required></div>
          <div class="mb-2"><label class="form-label">名称</label><input class="form-control" id="siteName" required></div>
          <div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="sitePublic" checked><label class="form-check-label">公开</label></div>
          <button type="submit" class="btn btn-primary w-100">保存</button>
        </form>
      </div>
    </div></div></div>`;
}

window.showSiteForm = function() { new bootstrap.Modal(document.getElementById('siteFormModal')).show(); };
window.saveSite = async function(e) {
  e.preventDefault();
  const id = document.getElementById('siteId').value.trim();
  const url = document.getElementById('siteUrl').value.trim();
  const name = document.getElementById('siteName').value.trim();
  try { await api('/api/admin/sites', { method: 'POST', body: JSON.stringify({ id, url, name, is_public: true }) }); bootstrap.Modal.getInstance(document.getElementById('siteFormModal')).hide(); showToast('success', '站点已添加'); loadTab('sites'); }
  catch (e) { showToast('danger', '添加失败: ' + e.message); }
  return false;
};
window.deleteSite = async function(id) {
  if (!confirm('确定删除站点？')) return;
  try { await api('/api/admin/sites/' + id, { method: 'DELETE' }); showToast('success', '已删除'); loadTab('sites'); }
  catch (e) { showToast('danger', '删除失败: ' + e.message); }
};

// ========== Telegram ==========
async function renderTelegramTab(ct) {
  let settings = { bot_token: '', chat_id: '', enable_notifications: 0 };
  try { settings = await api('/api/admin/telegram-settings'); } catch (e) {}
  ct.innerHTML = `
    <h6>Telegram Bot 通知设置</h6>
    <form onsubmit="return saveTelegram(event)">
      <div class="mb-3"><label class="form-label">Bot Token</label><input class="form-control" id="tgToken" value="${settings.bot_token || ''}" placeholder="123456:ABC-DEF1234ghikl"></div>
      <div class="mb-3"><label class="form-label">Chat ID</label><input class="form-control" id="tgChat" value="${settings.chat_id || ''}" placeholder="-100123456789"></div>
      <div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="tgEnable" ${settings.enable_notifications ? 'checked' : ''}><label class="form-check-label">启用通知</label></div>
      <button type="submit" class="btn btn-primary">保存并测试</button>
    </form>`;
}
window.saveTelegram = async function(e) {
  e.preventDefault();
  const bot_token = document.getElementById('tgToken').value.trim();
  const chat_id = document.getElementById('tgChat').value.trim();
  const enable_notifications = document.getElementById('tgEnable').checked;
  try { await api('/api/admin/telegram-settings', { method: 'POST', body: JSON.stringify({ bot_token, chat_id, enable_notifications }) }); showToast('success', 'Telegram设置已保存'); }
  catch (e) { showToast('danger', '保存失败: ' + e.message); }
  return false;
};

// ========== 背景设置 ==========
async function renderBackgroundTab(ct) {
  let settings = { enabled: false, url: '', opacity: 80 };
  try { settings = await api('/api/admin/background-settings'); } catch (e) {}
  ct.innerHTML = `
    <h6>背景图片设置</h6>
    <form onsubmit="return saveBackground(event)">
      <div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="bgEnabled" ${settings.enabled ? 'checked' : ''}><label class="form-check-label">启用自定义背景</label></div>
      <div class="mb-3"><label class="form-label">背景图片URL (https://)</label><input class="form-control" type="url" id="bgUrl" value="${settings.url || ''}"></div>
      <div class="mb-3"><label class="form-label">页面透明度: <span id="opacVal">${settings.opacity}</span>%</label><input type="range" class="form-range" id="bgOpacity" min="0" max="100" value="${settings.opacity}" oninput="document.getElementById('opacVal').textContent=this.value"></div>
      <button type="submit" class="btn btn-primary">保存</button>
    </form>`;
}
window.saveBackground = async function(e) {
  e.preventDefault();
  const enabled = document.getElementById('bgEnabled').checked;
  const url = document.getElementById('bgUrl').value.trim();
  const opacity = parseInt(document.getElementById('bgOpacity').value);
  try { await api('/api/admin/background-settings', { method: 'POST', body: JSON.stringify({ enabled, url, opacity }) }); showToast('success', '背景设置已保存'); }
  catch (e) { showToast('danger', '保存失败: ' + e.message); }
  return false;
};

// ========== 系统设置 ==========
async function renderSettingsTab(ct) {
  let interval = 60;
  try { const d = await api('/api/admin/settings/vps-report-interval'); interval = d.interval || 60; } catch (e) {}
  ct.innerHTML = `
    <h6>系统设置</h6>
    <form onsubmit="return saveSettings(event)">
      <div class="mb-3"><label class="form-label">VPS上报间隔 (秒，10-3600)</label><input type="number" class="form-control" id="vpsInterval" value="${interval}" min="10" max="3600"></div>
      <div class="mb-3"><label class="form-label">修改密码</label><div class="input-group">
        <input type="password" class="form-control" id="newPassword1" placeholder="新密码" minlength="8">
        <input type="password" class="form-control" id="newPassword2" placeholder="确认新密码" minlength="8">
      </div></div>
      <button type="submit" class="btn btn-primary">保存设置</button>
    </form>`;
}
window.saveSettings = async function(e) {
  e.preventDefault();
  const interval = parseInt(document.getElementById('vpsInterval').value);
  const pw1 = document.getElementById('newPassword1').value;
  const pw2 = document.getElementById('newPassword2').value;

  try {
    if (interval >= 10 && interval <= 3600) {
      await api('/api/admin/settings/vps-report-interval', { method: 'POST', body: JSON.stringify({ interval }) });
    }
    if (pw1) {
      if (pw1 !== pw2) { showToast('danger', '两次密码不一致'); return false; }
      if (pw1.length < 8) { showToast('danger', '密码至少8位'); return false; }
      const cur = prompt('请输入当前密码:');
      if (!cur) return false;
      await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: pw1 }) });
      showToast('success', '密码已修改');
    }
    showToast('success', '设置已保存');
  } catch (e) { showToast('danger', '保存失败: ' + e.message); }
  return false;
};

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async function() {
  const token = localStorage.getItem('auth_token');
  if (!token) { window.location.href = '/login.html'; return; }

  try {
    const status = await api('/api/auth/status');
    if (!status.authenticated) { window.location.href = '/login.html'; return; }
  } catch (e) { window.location.href = '/login.html'; return; }

  initTheme();
  initTabs();
  loadTab('servers');
});
