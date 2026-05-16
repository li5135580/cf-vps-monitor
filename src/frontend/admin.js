// admin.js — no-dependency admin panel

let authToken = localStorage.getItem('auth_token');
const $ = (s, p) => (p || document).querySelector(s);

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (authToken) h['Authorization'] = 'Bearer ' + authToken;
  return h;
}

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: headers(), ...opts });
  if (r.status === 401) { localStorage.removeItem('auth_token'); window.location.href = '/login.html'; throw new Error('Unauthorized'); }
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || 'Error ' + r.status); }
  return r.json();
}

function toast(type, msg) {
  const c = $('#toastContainer');
  const el = document.createElement('div');
  el.className = 'toast-item ' + type; el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

window.logout = function() { localStorage.removeItem('auth_token'); window.location.href = '/'; };

// ===== Theme =====
function initTheme() {
  const t = localStorage.getItem('vps-theme') || 'dark';
  applyTheme(t);
  $('#themeToggler').addEventListener('click', () => {
    const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(n); localStorage.setItem('vps-theme', n);
  });
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const r = document.documentElement.style;
  if (t === 'light') {
    r.setProperty('--bg-root','#f4f6f9'); r.setProperty('--bg-surface','#ffffff');
    r.setProperty('--bg-card','rgba(255,255,255,0.9)'); r.setProperty('--bg-card-hover','rgba(255,255,255,1)');
    r.setProperty('--text-primary','#1a2332'); r.setProperty('--text-secondary','#5a6a7e'); r.setProperty('--text-muted','#8a9ab0');
    r.setProperty('--border-subtle','rgba(0,0,0,0.06)'); r.setProperty('--border-card','rgba(0,0,0,0.08)');
  } else {
    r.setProperty('--bg-root','#080c12'); r.setProperty('--bg-surface','#0f1724');
    r.setProperty('--bg-card','rgba(18, 25, 40, 0.85)'); r.setProperty('--bg-card-hover','rgba(24, 33, 52, 0.95)');
    r.setProperty('--text-primary','#dce3ed'); r.setProperty('--text-secondary','#798aa2'); r.setProperty('--text-muted','#4b5b72');
    r.setProperty('--border-subtle','rgba(255,255,255,0.06)'); r.setProperty('--border-card','rgba(255,255,255,0.08)');
  }
}

// ===== Tabs =====
function initTabs() {
  $$('[data-tab]').forEach(b => b.addEventListener('click', function() {
    $$('[data-tab]').forEach(x => x.classList.remove('active'));
    this.classList.add('active');
    loadTab(this.dataset.tab);
  }));
}
function $$(s,p) { return (p||document).querySelectorAll(s); }

async function loadTab(tab) {
  const ct = $('#tabContent');
  switch(tab) {
    case 'servers': await serversTab(ct); break;
    case 'sites': await sitesTab(ct); break;
    case 'telegram': await telegramTab(ct); break;
    case 'background': await backgroundTab(ct); break;
    case 'settings': await settingsTab(ct); break;
  }
}

// ===== Servers =====
async function serversTab(ct) {
  ct.innerHTML = '<div class="spinner"></div>';
  const d = await api('/api/admin/servers');
  const servers = d.servers || [];
  ct.innerHTML = `<div class="d-flex align-center justify-between mb-3">
    <span style="font-family:var(--font-mono);font-size:0.85rem">${servers.length} servers</span>
    <button class="btn-primary" onclick="showServerForm()">+ add</button>
  </div>
  <div style="overflow-x:auto"><table class="data-table">
    <thead><tr><th>name</th><th>id</th><th>public</th><th>sort</th><th>actions</th></tr></thead>
    <tbody>${servers.map(s=>`<tr>
      <td>${s.name}</td><td><code style="font-size:0.7rem;color:var(--text-muted)">${s.id}</code></td>
      <td><span class="status-badge ${s.is_public?'online':'unknown'}">${s.is_public?'public':'hidden'}</span></td>
      <td>${s.sort_order??'—'}</td>
      <td>
        <button class="btn-ghost" onclick="copyInstall('${s.id}','${s.name}')">📋</button>
        <button class="btn-ghost" onclick="deleteServer('${s.id}')">🗑</button>
      </td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

window.showServerForm = function() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `<div class="modal-panel">
    <h2>> add_server</h2>
    <form id="serverForm" onsubmit="return saveServer(event)">
      <div class="form-group"><label class="form-label">Server ID</label><input class="form-input" id="srvId" required></div>
      <div class="form-group"><label class="form-label">Name</label><input class="form-input" id="srvName" required></div>
      <div class="form-group"><label class="form-label">Description</label><input class="form-input" id="srvDesc"></div>
      <div class="form-group"><label class="form-label">API Key</label><input class="form-input" id="srvKey" required></div>
      <div class="checkbox-wrap"><input type="checkbox" id="srvPublic" checked><span style="font-family:var(--font-mono);font-size:0.75rem">Public</span></div>
      <div class="d-flex gap-2" style="margin-top:1rem">
        <button type="submit" class="btn-primary w-full">save</button>
        <button type="button" class="btn-ghost w-full" onclick="closeModal()">cancel</button>
      </div>
    </form>
  </div>`;
  ov.addEventListener('click', function(e) { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
};

window.closeModal = function() { const m = document.getElementById('modalOverlay'); if (m) m.remove(); };

window.saveServer = async function(e) {
  e.preventDefault();
  const id = $('#srvId').value.trim(), name = $('#srvName').value.trim();
  const desc = $('#srvDesc').value.trim(), key = $('#srvKey').value.trim();
  const pub = $('#srvPublic').checked;
  if (!id||!name||!key) { toast('danger','All fields required'); return false; }
  try {
    await api('/api/admin/servers', { method:'POST', body:JSON.stringify({id,name,description:desc,api_key:key,is_public:pub}) });
    closeModal(); toast('success','Server added'); loadTab('servers');
  } catch(e) { toast('danger','Failed: '+e.message); }
  return false;
};

window.deleteServer = async function(id) {
  if (!confirm('Delete server '+id+'?')) return;
  try { await api('/api/admin/servers/'+id, { method:'DELETE' }); toast('success','Deleted'); loadTab('servers'); }
  catch(e) { toast('danger','Failed: '+e.message); }
};

window.copyInstall = function(sid, sname) {
  const key = prompt('API Key for '+sname+':');
  if (!key) return;
  const cmd = 'curl -sSL '+window.location.origin+'/install.sh | bash -s -- -k '+key+' -s '+sid;
  navigator.clipboard.writeText(cmd).then(()=>toast('success','Copied')).catch(()=>toast('danger','Copy failed'));
};

// ===== Sites =====
async function sitesTab(ct) {
  const d = await api('/api/admin/sites');
  const sites = d.sites || [];
  ct.innerHTML = `<div class="d-flex align-center justify-between mb-3">
    <span style="font-family:var(--font-mono);font-size:0.85rem">${sites.length} sites</span>
    <button class="btn-primary" onclick="showSiteForm()">+ add</button>
  </div>
  <table class="data-table"><thead><tr><th>name</th><th>url</th><th>status</th><th>public</th><th>actions</th></tr></thead>
    <tbody>${sites.map(s=>`<tr><td>${s.name||s.id}</td><td style="font-size:0.7rem;color:var(--text-muted)">${s.url}</td><td><span class="status-badge ${s.last_status==='UP'?'online':'unknown'}">${s.last_status||'—'}</span></td><td><span class="status-badge ${s.is_public?'online':'unknown'}">${s.is_public?'public':'hidden'}</span></td><td><button class="btn-ghost" onclick="deleteSite('${s.id}')">🗑</button></td></tr>`).join('')}</tbody></table>`;
}

window.showSiteForm = function() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `<div class="modal-panel">
    <h2>> add_site</h2>
    <form id="siteForm" onsubmit="return saveSite(event)">
      <div class="form-group"><label class="form-label">Site ID</label><input class="form-input" id="siteId" required></div>
      <div class="form-group"><label class="form-label">URL</label><input class="form-input" type="url" id="siteUrl" required></div>
      <div class="form-group"><label class="form-label">Name</label><input class="form-input" id="siteName" required></div>
      <div class="checkbox-wrap"><input type="checkbox" id="sitePublic" checked><span style="font-family:var(--font-mono);font-size:0.75rem">Public</span></div>
      <div class="d-flex gap-2" style="margin-top:1rem">
        <button type="submit" class="btn-primary w-full">save</button>
        <button type="button" class="btn-ghost w-full" onclick="closeModal()">cancel</button>
      </div>
    </form>
  </div>`;
  ov.addEventListener('click', function(e) { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
};

window.saveSite = async function(e) {
  e.preventDefault();
  const id=$('#siteId').value.trim(), url=$('#siteUrl').value.trim(), name=$('#siteName').value.trim();
  try{await api('/api/admin/sites',{method:'POST',body:JSON.stringify({id,url,name,is_public:true})});closeModal();toast('success','Site added');loadTab('sites');}
  catch(e){toast('danger','Failed: '+e.message);}
  return false;
};

window.deleteSite = async function(id) {
  if(!confirm('Delete site?'))return;
  try{await api('/api/admin/sites/'+id,{method:'DELETE'});toast('success','Deleted');loadTab('sites');}
  catch(e){toast('danger','Failed: '+e.message);}
};

// ===== Telegram =====
async function telegramTab(ct) {
  let s={bot_token:'',chat_id:'',enable_notifications:0};
  try{s=await api('/api/admin/telegram-settings');}catch(e){}
  ct.innerHTML=`<form onsubmit="return saveTg(event)">
    <div class="form-group"><label class="form-label">Bot Token</label><input class="form-input" id="tgToken" value="${s.bot_token||''}" placeholder="123456:ABC-DEF1234"></div>
    <div class="form-group"><label class="form-label">Chat ID</label><input class="form-input" id="tgChat" value="${s.chat_id||''}" placeholder="-100123456789"></div>
    <div class="checkbox-wrap"><input type="checkbox" id="tgEnable" ${s.enable_notifications?'checked':''}><span style="font-family:var(--font-mono);font-size:0.75rem">Enable notifications</span></div>
    <button type="submit" class="btn-primary">save & test</button>
  </form>`;
}
window.saveTg = async function(e) {
  e.preventDefault();
  try{await api('/api/admin/telegram-settings',{method:'POST',body:JSON.stringify({bot_token:$('#tgToken').value.trim(),chat_id:$('#tgChat').value.trim(),enable_notifications:$('#tgEnable').checked})});toast('success','Saved');}
  catch(e){toast('danger','Failed: '+e.message);}
  return false;
};

// ===== Background =====
async function backgroundTab(ct) {
  let s={enabled:false,url:'',opacity:80};
  try{s=await api('/api/admin/background-settings');}catch(e){}
  ct.innerHTML=`<form onsubmit="return saveBg(event)">
    <div class="checkbox-wrap"><input type="checkbox" id="bgEnabled" ${s.enabled?'checked':''}><span style="font-family:var(--font-mono);font-size:0.75rem">Custom background</span></div>
    <div class="form-group"><label class="form-label">Image URL (https://)</label><input class="form-input" id="bgUrl" value="${s.url||''}"></div>
    <div class="form-group"><label class="form-label">Opacity: <span id="opacVal">${s.opacity}</span>%</label><input type="range" style="width:100%" id="bgOpacity" min="0" max="100" value="${s.opacity}" oninput="$('#opacVal').textContent=this.value"></div>
    <button type="submit" class="btn-primary">save</button>
  </form>`;
}
window.saveBg = async function(e) {
  e.preventDefault();
  try{await api('/api/admin/background-settings',{method:'POST',body:JSON.stringify({enabled:$('#bgEnabled').checked,url:$('#bgUrl').value.trim(),opacity:parseInt($('#bgOpacity').value)})});toast('success','Saved');}
  catch(e){toast('danger','Failed: '+e.message);}
  return false;
};

// ===== Settings =====
async function settingsTab(ct) {
  let iv=60;
  try{const d=await api('/api/admin/settings/vps-report-interval');iv=d.interval||60;}catch(e){}
  ct.innerHTML=`<form onsubmit="return saveSettings(event)">
    <div class="form-group"><label class="form-label">VPS Report Interval (seconds, 10-3600)</label><input type="number" class="form-input" id="vpsInterval" value="${iv}" min="10" max="3600"></div>
    <div class="form-group"><label class="form-label">New Password</label><div class="d-flex gap-2"><input type="password" class="form-input" id="newPw1" placeholder="new password" minlength="8"><input type="password" class="form-input" id="newPw2" placeholder="confirm" minlength="8"></div></div>
    <button type="submit" class="btn-primary">save</button>
  </form>`;
}
window.saveSettings = async function(e) {
  e.preventDefault();
  try {
    const iv=parseInt($('#vpsInterval').value);
    if(iv>=10&&iv<=3600) await api('/api/admin/settings/vps-report-interval',{method:'POST',body:JSON.stringify({interval:iv})});
    const p1=$('#newPw1').value,p2=$('#newPw2').value;
    if(p1){
      if(p1!==p2){toast('danger','Passwords do not match');return false;}
      const cur=prompt('Current password:');
      if(!cur)return false;
      await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:cur,newPassword:p1})});
      toast('success','Password changed');
    }
    toast('success','Settings saved');
  } catch(e){toast('danger','Failed: '+e.message);}
  return false;
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  const t = localStorage.getItem('auth_token');
  if (!t) { window.location.href = '/login.html'; return; }
  try {
    const s = await api('/api/auth/status');
    if (!s.authenticated) { window.location.href = '/login.html'; return; }
  } catch(e) { window.location.href = '/login.html'; return; }
  initTheme(); initTabs(); loadTab('servers');
});
