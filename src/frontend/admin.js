// admin.js — 管理后台 (中文默认 · EN可选)

let authToken = localStorage.getItem('auth_token');
let lang = localStorage.getItem('vps-lang') || 'zh';

const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => (p || document).querySelectorAll(s);

const I18N = {
  zh: {
    servers:'服务器管理', sites:'网站管理', telegram:'Telegram通知', background:'背景设置', settings:'系统设置',
    add_server:'+ 添加', add_site:'+ 添加',
    th_name:'名称', th_id:'ID', th_public:'公开', th_sort:'排序', th_actions:'操作', th_url:'URL', th_status:'状态',
    public:'公开', hidden:'隐藏', save:'保存', cancel:'取消', delete:'删除',
    server_id:'服务器ID', name:'名称', description:'描述', api_key:'API密钥',
    site_id:'站点ID', url:'URL',
    bot_token:'Bot Token', chat_id:'Chat ID', enable_notif:'启用通知',
    save_test:'保存并测试', saved:'设置已保存',
    custom_bg:'自定义背景', bg_url:'图片URL (https://)', opacity:'透明度',
    vps_interval:'VPS上报间隔 (秒, 10-3600)',
    new_password:'新密码', confirm_password:'确认密码', current_password:'当前密码',
    change_password:'修改密码', password_mismatch:'两次密码不一致', password_changed:'密码已修改',
    settings_saved:'设置已保存',
    confirm_delete_server:'确定删除服务器', confirm_delete_site:'确定删除站点?',
    installed:'安装命令已复制', copy_failed:'复制失败',
    failed:'操作失败', network_error:'网络错误',
    load_error:'加载失败', added:'已添加', deleted:'已删除',
    dashboard:'控制台', exit:'退出',
    tab_servers:'服务器', tab_sites:'网站', tab_background:'背景', tab_settings:'设置',
    lang_title:'Switch to English',
  },
  en: {
    servers:'Servers', sites:'Sites', telegram:'Telegram', background:'Background', settings:'Settings',
    add_server:'+ add', add_site:'+ add',
    th_name:'name', th_id:'id', th_public:'public', th_sort:'sort', th_actions:'actions', th_url:'url', th_status:'status',
    public:'public', hidden:'hidden', save:'save', cancel:'cancel', delete:'delete',
    server_id:'Server ID', name:'Name', description:'Description', api_key:'API Key',
    site_id:'Site ID', url:'URL',
    bot_token:'Bot Token', chat_id:'Chat ID', enable_notif:'Enable notifications',
    save_test:'save & test', saved:'Saved',
    custom_bg:'Custom background', bg_url:'Image URL (https://)', opacity:'Opacity',
    vps_interval:'VPS Report Interval (sec, 10-3600)',
    new_password:'New password', confirm_password:'Confirm password', current_password:'Current password',
    change_password:'Change password', password_mismatch:'Passwords do not match', password_changed:'Password changed',
    settings_saved:'Settings saved',
    confirm_delete_server:'Delete server', confirm_delete_site:'Delete site?',
    installed:'Copied', copy_failed:'Copy failed',
    failed:'Failed', network_error:'Network error',
    load_error:'Load failed', added:'Added', deleted:'Deleted',
    dashboard:'Dashboard', exit:'Exit',
    tab_servers:'Servers', tab_sites:'Sites', tab_background:'Background', tab_settings:'Settings',
    lang_title:'切换到中文',
  }
};

function t(key) { return (I18N[lang] && I18N[lang][key]) || key; }

function applyI18n() {
  $$('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (I18N[lang] && I18N[lang][k]) el.textContent = I18N[lang][k]; });
  const lt = $('#langToggle');
  if (lt) { lt.textContent = lang === 'zh' ? 'EN' : '中'; lt.title = t('lang_title'); }
}

function toggleLang() {
  lang = lang === 'zh' ? 'en' : 'zh';
  localStorage.setItem('vps-lang', lang);
  applyI18n();
  const activeTab = document.querySelector('.admin-tab.active');
  if (activeTab) loadTab(activeTab.dataset.tab);
}

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
  const th = localStorage.getItem('vps-theme') || 'dark';
  applyTheme(th);
  $('#themeToggler').addEventListener('click', () => {
    const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(n); localStorage.setItem('vps-theme', n);
  });
}
function applyTheme(th) {
  document.documentElement.dataset.theme = th;
  const r = document.documentElement.style;
  if (th === 'light') {
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
    <span style="font-family:var(--font-mono);font-size:0.85rem">${servers.length} ${t('servers')}</span>
    <button class="btn-primary" onclick="showServerForm()">${t('add_server')}</button>
  </div>
  <div style="overflow-x:auto"><table class="data-table">
    <thead><tr><th>${t('th_name')}</th><th>${t('th_id')}</th><th>${t('th_public')}</th><th>${t('th_sort')}</th><th>${t('th_actions')}</th></tr></thead>
    <tbody>${servers.map(s=>`<tr>
      <td>${s.name}</td><td><code style="font-size:0.7rem;color:var(--text-muted)">${s.id}</code></td>
      <td><span class="status-badge ${s.is_public?'online':'unknown'}">${s.is_public?t('public'):t('hidden')}</span></td>
      <td>${s.sort_order??'—'}</td>
      <td>
        <button class="btn-primary" onclick="copyInstall('${s.id}','${s.name}')" style="font-size:0.7rem;padding:0.3rem 0.7rem">📋 ${lang==='zh'?'复制安装':'Copy'}</button>
        <button class="btn-danger" onclick="deleteServer('${s.id}')" style="font-size:0.7rem;padding:0.3rem 0.7rem">🗑</button>
      </td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

window.showServerForm = function() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `<div class="modal-panel">
    <h2>> add_server</h2>
    <form id="serverForm" onsubmit="return saveServer(event)">
      <div class="form-group"><label class="form-label">${t('server_id')}</label><input class="form-input" id="srvId" required></div>
      <div class="form-group"><label class="form-label">${t('name')}</label><input class="form-input" id="srvName" required></div>
      <div class="form-group"><label class="form-label">${t('description')}</label><input class="form-input" id="srvDesc"></div>
      <div class="form-group"><label class="form-label">${t('api_key')}</label><input class="form-input" id="srvKey" required></div>
      <div class="checkbox-wrap"><input type="checkbox" id="srvPublic" checked><span style="font-family:var(--font-mono);font-size:0.75rem">Public</span></div>
      <div class="d-flex gap-2" style="margin-top:1rem">
        <button type="submit" class="btn-primary w-full">${t('save')}</button>
        <button type="button" class="btn-ghost w-full" onclick="closeModal()">${t('cancel')}</button>
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
  if (!id||!name||!key) { toast('danger', t('failed')); return false; }
  try {
    await api('/api/admin/servers', { method:'POST', body:JSON.stringify({id,name,description:desc,api_key:key,is_public:pub}) });
    closeModal(); toast('success', t('added')); loadTab('servers');
  } catch(e) { toast('danger', t('failed')+': '+e.message); }
  return false;
};

window.deleteServer = async function(id) {
  if (!confirm(t('confirm_delete_server')+' '+id+'?')) return;
  try { await api('/api/admin/servers/'+id, { method:'DELETE' }); toast('success', t('deleted')); loadTab('servers'); }
  catch(e) { toast('danger', t('failed')+': '+e.message); }
};

window.copyInstall = function(sid, sname) {
  const key = prompt('API Key for '+sname+':');
  if (!key) return;
  const cmd = 'curl -sSL '+window.location.origin+'/install.sh | bash -s -- -k '+key+' -s '+sid;
  navigator.clipboard.writeText(cmd).then(()=>toast('success',t('installed'))).catch(()=>toast('danger',t('copy_failed')));
};

// ===== Sites =====
async function sitesTab(ct) {
  const d = await api('/api/admin/sites');
  const sites = d.sites || [];
  ct.innerHTML = `<div class="d-flex align-center justify-between mb-3">
    <span style="font-family:var(--font-mono);font-size:0.85rem">${sites.length} ${t('sites')}</span>
    <button class="btn-primary" onclick="showSiteForm()">${t('add_site')}</button>
  </div>
  <table class="data-table"><thead><tr><th>${t('th_name')}</th><th>${t('th_url')}</th><th>${t('th_status')}</th><th>${t('th_public')}</th><th>${t('th_actions')}</th></tr></thead>
    <tbody>${sites.map(s=>`<tr><td>${s.name||s.id}</td><td style="font-size:0.7rem;color:var(--text-muted)">${s.url}</td><td><span class="status-badge ${s.last_status==='UP'?'online':'unknown'}">${s.last_status||'—'}</span></td><td><span class="status-badge ${s.is_public?'online':'unknown'}">${s.is_public?t('public'):t('hidden')}</span></td><td><button class="btn-ghost" onclick="deleteSite('${s.id}')">🗑</button></td></tr>`).join('')}</tbody></table>`;
}

window.showSiteForm = function() {
  const ov = document.createElement('div'); ov.className = 'modal-overlay'; ov.id = 'modalOverlay';
  ov.innerHTML = `<div class="modal-panel">
    <h2>> add_site</h2>
    <form id="siteForm" onsubmit="return saveSite(event)">
      <div class="form-group"><label class="form-label">${t('site_id')}</label><input class="form-input" id="siteId" required></div>
      <div class="form-group"><label class="form-label">${t('url')}</label><input class="form-input" type="url" id="siteUrl" required></div>
      <div class="form-group"><label class="form-label">${t('name')}</label><input class="form-input" id="siteName" required></div>
      <div class="checkbox-wrap"><input type="checkbox" id="sitePublic" checked><span style="font-family:var(--font-mono);font-size:0.75rem">Public</span></div>
      <div class="d-flex gap-2" style="margin-top:1rem">
        <button type="submit" class="btn-primary w-full">${t('save')}</button>
        <button type="button" class="btn-ghost w-full" onclick="closeModal()">${t('cancel')}</button>
      </div>
    </form>
  </div>`;
  ov.addEventListener('click', function(e) { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
};

window.saveSite = async function(e) {
  e.preventDefault();
  const id=$('#siteId').value.trim(), url=$('#siteUrl').value.trim(), name=$('#siteName').value.trim();
  try{await api('/api/admin/sites',{method:'POST',body:JSON.stringify({id,url,name,is_public:true})});closeModal();toast('success',t('added'));loadTab('sites');}
  catch(e){toast('danger',t('failed')+': '+e.message);}
  return false;
};

window.deleteSite = async function(id) {
  if(!confirm(t('confirm_delete_site')))return;
  try{await api('/api/admin/sites/'+id,{method:'DELETE'});toast('success',t('deleted'));loadTab('sites');}
  catch(e){toast('danger',t('failed')+': '+e.message);}
};

// ===== Telegram =====
async function telegramTab(ct) {
  let s={bot_token:'',chat_id:'',enable_notifications:0};
  try{s=await api('/api/admin/telegram-settings');}catch(e){}
  ct.innerHTML=`<form onsubmit="return saveTg(event)">
    <div class="form-group"><label class="form-label">${t('bot_token')}</label><input class="form-input" id="tgToken" value="${s.bot_token||''}" placeholder="123456:ABC-DEF1234"></div>
    <div class="form-group"><label class="form-label">${t('chat_id')}</label><input class="form-input" id="tgChat" value="${s.chat_id||''}" placeholder="-100123456789"></div>
    <div class="checkbox-wrap"><input type="checkbox" id="tgEnable" ${s.enable_notifications?'checked':''}><span style="font-family:var(--font-mono);font-size:0.75rem">${t('enable_notif')}</span></div>
    <button type="submit" class="btn-primary">${t('save_test')}</button>
  </form>`;
}
window.saveTg = async function(e) {
  e.preventDefault();
  try{await api('/api/admin/telegram-settings',{method:'POST',body:JSON.stringify({bot_token:$('#tgToken').value.trim(),chat_id:$('#tgChat').value.trim(),enable_notifications:$('#tgEnable').checked})});toast('success',t('saved'));}
  catch(e){toast('danger',t('failed')+': '+e.message);}
  return false;
};

// ===== Background =====
async function backgroundTab(ct) {
  let s={enabled:false,url:'',opacity:80};
  try{s=await api('/api/admin/background-settings');}catch(e){}
  ct.innerHTML=`<form onsubmit="return saveBg(event)">
    <div class="checkbox-wrap"><input type="checkbox" id="bgEnabled" ${s.enabled?'checked':''}><span style="font-family:var(--font-mono);font-size:0.75rem">${t('custom_bg')}</span></div>
    <div class="form-group"><label class="form-label">${t('bg_url')}</label><input class="form-input" id="bgUrl" value="${s.url||''}"></div>
    <div class="form-group"><label class="form-label">${t('opacity')}: <span id="opacVal">${s.opacity}</span>%</label><input type="range" style="width:100%" id="bgOpacity" min="0" max="100" value="${s.opacity}" oninput="$('#opacVal').textContent=this.value"></div>
    <button type="submit" class="btn-primary">${t('save')}</button>
  </form>`;
}
window.saveBg = async function(e) {
  e.preventDefault();
  try{await api('/api/admin/background-settings',{method:'POST',body:JSON.stringify({enabled:$('#bgEnabled').checked,url:$('#bgUrl').value.trim(),opacity:parseInt($('#bgOpacity').value)})});toast('success',t('saved'));}
  catch(e){toast('danger',t('failed')+': '+e.message);}
  return false;
};

// ===== Settings =====
async function settingsTab(ct) {
  let iv=60;
  try{const d=await api('/api/admin/settings/vps-report-interval');iv=d.interval||60;}catch(e){}
  ct.innerHTML=`<form onsubmit="return saveSettings(event)">
    <div class="form-group"><label class="form-label">${t('vps_interval')}</label><input type="number" class="form-input" id="vpsInterval" value="${iv}" min="10" max="3600"></div>
    <div class="form-group"><label class="form-label">${t('new_password')}</label><div class="d-flex gap-2"><input type="password" class="form-input" id="newPw1" placeholder="${t('new_password')}" minlength="8"><input type="password" class="form-input" id="newPw2" placeholder="${t('confirm_password')}" minlength="8"></div></div>
    <button type="submit" class="btn-primary">${t('save')}</button>
  </form>`;
}
window.saveSettings = async function(e) {
  e.preventDefault();
  try {
    const iv=parseInt($('#vpsInterval').value);
    if(iv>=10&&iv<=3600) await api('/api/admin/settings/vps-report-interval',{method:'POST',body:JSON.stringify({interval:iv})});
    const p1=$('#newPw1').value,p2=$('#newPw2').value;
    if(p1){
      if(p1!==p2){toast('danger',t('password_mismatch'));return false;}
      const cur=prompt(t('current_password')+':');
      if(!cur)return false;
      await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:cur,newPassword:p1})});
      toast('success',t('password_changed'));
    }
    toast('success',t('settings_saved'));
  } catch(e){toast('danger',t('failed')+': '+e.message);}
  return false;
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
  const tk = localStorage.getItem('auth_token');
  if (!tk) { window.location.href = '/login.html'; return; }
  try {
    const s = await api('/api/auth/status');
    if (!s.authenticated) { window.location.href = '/login.html'; return; }
  } catch(e) { window.location.href = '/login.html'; return; }

  applyI18n();
  initTheme();
  initTabs();

  // Language toggle
  const lt = $('#langToggle');
  if (lt) lt.addEventListener('click', toggleLang);

  loadTab('servers');
});
