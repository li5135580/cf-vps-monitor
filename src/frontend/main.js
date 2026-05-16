// main.js — VPS Monitor Dashboard v3 (no dependencies)

let vpsInterval = null, siteInterval = null;
let serverDataCache = {}, vpsStatusCache = {};
let currentView = localStorage.getItem('vps-view') || 'table';

const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => (p || document).querySelectorAll(s);

// ===== View Switching =====
window.switchView = function(view) {
  currentView = view;
  localStorage.setItem('vps-view', view);
  $('#btnTableView').classList.toggle('active', view === 'table');
  $('#btnGridView').classList.toggle('active', view === 'grid');
  $('#tableView').style.display = view === 'table' ? '' : 'none';
  $('#gridView').style.display = view === 'grid' ? '' : 'none';
  if (view === 'grid') renderGrid(Object.values(serverDataCache));
};

// ===== Auth/API =====
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const t = localStorage.getItem('auth_token');
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: authHeaders(), ...opts });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || 'Error ' + r.status); }
  return r.json();
}

// ===== Formatters =====
function fmtSize(b) {
  if (!b) return '0B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b)/Math.log(1024));
  return (b/Math.pow(1024,i)).toFixed(i>0?1:0) + u[i];
}
function fmtSpeed(bps) { return bps ? fmtSize(bps)+'/s' : '0B/s'; }
function fmtUptime(s) {
  if (!s || s<=0) return '—';
  const d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60);
  return (d>0?d+'d ':'')+h+'h '+m+'m';
}
function timeAgo(ts) {
  if (!ts) return 'never';
  const d=Math.floor((Date.now()-ts*1000)/1000);
  if (d<60) return d+'s';
  if (d<3600) return Math.floor(d/60)+'m';
  if (d<86400) return Math.floor(d/3600)+'h';
  return Math.floor(d/86400)+'d';
}

// ===== Status =====
function status(data) {
  if (data.error) return 'error';
  if (!data.metrics) return 'unknown';
  return (Date.now()-data.metrics.timestamp*1000)/60000 <= 5 ? 'online' : 'offline';
}

function statusLabel(s) { return {online:'online',offline:'offline',error:'error',unknown:'unknown'}[s]||'unknown'; }

// ===== Progress bar =====
function pctBar(val) {
  if (typeof val !== 'number' || isNaN(val)) return '<span style="color:var(--text-muted)">—</span>';
  const p = Math.max(0,Math.min(100,val));
  const cls = p >= 80 ? 'high' : p >= 50 ? 'mid' : 'low';
  return `<div class="progress-bar-wrap"><div class="progress-bar-fill ${cls}" style="width:${p}%"></div></div>
    <span style="font-size:0.7rem;font-family:var(--font-mono);color:var(--text-secondary);margin-top:2px">${p.toFixed(1)}%</span>`;
}

// ===== Load Data =====
async function loadServers() {
  try {
    const d = await api('/api/status/batch');
    const list = d.servers || [];
    if (list.length === 0) {
      $('#noServers').style.display = '';
      $('#serverTableBody').innerHTML = '<tr><td colspan="8" class="text-center" style="color:var(--text-muted)">no servers</td></tr>';
      renderGrid([]); renderMobile([]);
      return;
    }
    $('#noServers').style.display = 'none';
    list.forEach(s => serverDataCache[s.server.id] = s);
    await checkChanges(list);
    renderTable(list);
    renderGrid(list);
    renderMobile(list);
  } catch(e) {
    $('#serverTableBody').innerHTML = '<tr><td colspan="8" class="text-center" style="color:var(--accent-red)">load failed</td></tr>';
    toast('danger', 'Failed to load: ' + e.message);
  }
}

// ===== Status Changes =====
async function checkChanges(list) {
  for (const d of list) {
    const id = d.server.id, name = d.server.name, st = status(d), prev = vpsStatusCache[id];
    if (prev !== undefined && prev !== st) {
      if (st === 'offline') {
        await fetch('/api/notify/offline', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({serverId:id,serverName:name}) }).catch(()=>{});
      } else if (st === 'online' && prev === 'offline') {
        await fetch('/api/notify/recovery', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({serverId:id,serverName:name}) }).catch(()=>{});
      }
    }
    vpsStatusCache[id] = st;
  }
}

// ===== Table View =====
function renderTable(list) {
  let h = '';
  list.forEach(d => {
    const s=d.server, m=d.metrics, st=status(d);
    h += `<tr class="server-row" data-id="${s.id}">
      <td><strong>${s.name||s.id}</strong></td>
      <td><span class="status-badge ${st}"><span class="card-status-dot" style="width:6px;height:6px;display:inline-block;border-radius:50%;background:var(--accent-${st==='online'?'green':st==='offline'?'red':st==='error'?'amber':'text-muted'})"></span>${statusLabel(st)}</span></td>
      <td>${pctBar(m?.cpu?.usage_percent)}</td>
      <td>${pctBar(m?.memory?.usage_percent)}</td>
      <td>${pctBar(m?.disk?.usage_percent)}</td>
      <td><span style="font-size:0.7rem;color:var(--text-secondary)">↑${fmtSpeed(m?.network?.upload_speed)} ↓${fmtSpeed(m?.network?.download_speed)}</span></td>
      <td style="font-size:0.75rem">${fmtUptime(m?.uptime)}</td>
      <td style="font-size:0.7rem;color:var(--text-muted)">${timeAgo(m?.timestamp)}</td>
    </tr>`;
  });
  $('#serverTableBody').innerHTML = h;
}

// ===== Grid View =====
function renderGrid(list) {
  if (currentView !== 'grid') return;
  let h = '';
  list.forEach(d => {
    const s=d.server, m=d.metrics, st=status(d);
    const cpu=m?.cpu?.usage_percent, mem=m?.memory?.usage_percent, disk=m?.disk?.usage_percent;
    h += `<div class="server-card ${st}" data-id="${s.id}" onclick="showDetail('${s.id}')">
      <div class="card-header">
        <span class="card-name">${s.name||s.id}</span>
        <span class="card-status ${st}"><span class="card-status-dot"></span>${statusLabel(st)}</span>
      </div>
      <div class="card-metrics">
        <div class="metric"><span class="metric-label">CPU</span><span class="metric-value">${typeof cpu==='number'?cpu.toFixed(1)+'%':'—'}</span><div class="progress-bar-wrap"><div class="progress-bar-fill ${(cpu||0)>=80?'high':(cpu||0)>=50?'mid':'low'}" style="width:${cpu||0}%"></div></div></div>
        <div class="metric"><span class="metric-label">Memory</span><span class="metric-value">${typeof mem==='number'?mem.toFixed(1)+'%':'—'}</span><div class="progress-bar-wrap"><div class="progress-bar-fill ${(mem||0)>=80?'high':(mem||0)>=50?'mid':'low'}" style="width:${mem||0}%"></div></div></div>
        <div class="metric"><span class="metric-label">Disk</span><span class="metric-value">${typeof disk==='number'?disk.toFixed(1)+'%':'—'}</span><div class="progress-bar-wrap"><div class="progress-bar-fill ${(disk||0)>=80?'high':(disk||0)>=50?'mid':'low'}" style="width:${disk||0}%"></div></div></div>
        <div class="metric"><span class="metric-label">Uptime</span><span class="metric-value">${fmtUptime(m?.uptime)}</span></div>
      </div>
      <canvas class="mini-chart" id="chart-${s.id}"></canvas>
      <div class="card-footer">
        <span class="network-speed">↑${fmtSpeed(m?.network?.upload_speed)} ↓${fmtSpeed(m?.network?.download_speed)}</span>
        <span>${timeAgo(m?.timestamp)}</span>
      </div>
    </div>`;
  });
  $('#serverGrid').innerHTML = h;
  list.forEach(d => drawChart(d.server.id));
}

// ===== Mini Chart =====
async function drawChart(id) {
  const c = $('#chart-'+id); if (!c) return;
  const ctx = c.getContext('2d');
  c.width = c.parentElement.clientWidth - 40; c.height = 32;

  try {
    const r = await api('/api/history/'+id+'/24');
    const data = (r.history||[]).map(h=>h.cpu_usage);
    if (data.length<2) { ctx.fillStyle='var(--text-muted)'; ctx.font='9px monospace'; ctx.fillText('no history',8,20); return; }
    const max=Math.max(...data,1), bw=(c.width-4)/data.length;
    ctx.clearRect(0,0,c.width,32);
    ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=0.5;
    [8,16,24].forEach(y=>{ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke()});
    data.forEach((v,i)=>{
      const h=Math.max(2,(v/max)*30), x=i*bw+1, y=32-h;
      const g=ctx.createLinearGradient(x,y,x,32);
      g.addColorStop(0, v>80?'var(--accent-red)':v>50?'var(--accent-amber)':'var(--accent-green)');
      g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g; ctx.fillRect(x,y,bw-2,h);
    });
  } catch(e) { /* silent */ }
}

// ===== Detail Popup =====
window.showDetail = function(id) {
  const d=serverDataCache[id]; if(!d?.metrics) return;
  const m=d.metrics;
  const h = `<div style="font-family:var(--font-mono);line-height:1.8">
    <strong style="color:var(--accent-cyan)">${d.server.name}</strong><br>
    CPU Load: ${m.cpu?.load_avg?.join(' / ')||'—'}<br>
    Memory: ${fmtSize((m.memory?.used||0)*1024)} / ${fmtSize((m.memory?.total||0)*1024)}<br>
    Disk: ${(m.disk?.used||0).toFixed(1)} / ${(m.disk?.total||0).toFixed(1)} GB<br>
    Traffic: ↑${fmtSize(m.network?.total_upload||0)} ↓${fmtSize(m.network?.total_download||0)}
  </div>`;
  toast('info', h, 6000);
};

// ===== Mobile =====
function renderMobile(list) {
  const c=$('#mobileServerContainer'); if(!c) return;
  if (list.length===0) { c.innerHTML=''; return; }
  let h='';
  list.forEach(d=>{
    const s=d.server,m=d.metrics,st=status(d);
    h+=`<div class="mobile-server-card">
      <div class="mobile-card-header"><span class="mobile-card-name">${s.name||s.id}</span><span class="status-badge ${st}">${statusLabel(st)}</span></div>
      <div class="mobile-metrics">
        <div class="mobile-metric"><span class="mobile-label">CPU</span><span class="mobile-value">${typeof m?.cpu?.usage_percent==='number'?m.cpu.usage_percent.toFixed(1)+'%':'—'}</span></div>
        <div class="mobile-metric"><span class="mobile-label">MEM</span><span class="mobile-value">${typeof m?.memory?.usage_percent==='number'?m.memory.usage_percent.toFixed(1)+'%':'—'}</span></div>
        <div class="mobile-metric"><span class="mobile-label">DISK</span><span class="mobile-value">${typeof m?.disk?.usage_percent==='number'?m.disk.usage_percent.toFixed(1)+'%':'—'}</span></div>
        <div class="mobile-metric"><span class="mobile-label">UP</span><span class="mobile-value">${fmtUptime(m?.uptime)}</span></div>
      </div>
      <div style="font-size:0.62rem;color:var(--text-muted);margin-top:0.4rem;font-family:var(--font-mono)">↑${fmtSpeed(m?.network?.upload_speed)} ↓${fmtSpeed(m?.network?.download_speed)} · ${timeAgo(m?.timestamp)}</div>
    </div>`;
  });
  c.innerHTML=h;
  c.style.display=list.length>0?'':'none';
}

// ===== Sites =====
async function loadSites() {
  try {
    const d=await api('/api/sites/status');
    const sites=d.sites||[];
    let h='';
    sites.forEach(s=>{
      const st=s.last_status;
      const badgeCls = st==='UP'?'online':(st==='DOWN'||st==='TIMEOUT')?'offline':'error';
      const badgeTxt = {UP:'up',DOWN:'down',TIMEOUT:'timeout',ERROR:'error',PENDING:'pending'}[st]||st;
      const hist = (s.history||[]).slice(0,24).map(i=>`<span class="history-bar-seg ${i.status==='UP'?'up':'down'}"></span>`).join('');
      h+=`<tr><td>${s.name||s.id}</td><td style="font-size:0.7rem;color:var(--text-muted)">${s.url}</td><td><span class="status-badge ${badgeCls}">${badgeTxt}</span></td><td style="font-family:var(--font-mono)">${s.last_response_time_ms?s.last_response_time_ms+'ms':'—'}</td><td><div class="history-bar-wrap">${hist}</div></td></tr>`;
    });
    $('#siteTableBody').innerHTML=h||'<tr><td colspan="5" class="text-center" style="color:var(--text-muted)">no monitored sites</td></tr>';

    // Mobile sites
    const mc=$('#mobileSiteContainer'); if(!mc) return;
    let mh='';
    sites.forEach(s=>{
      const st=s.last_status,cls=st==='UP'?'online':'offline';
      mh+=`<div class="mobile-server-card"><div class="mobile-card-header"><span class="mobile-card-name">${s.name||s.id}</span><span class="status-badge ${cls}">${st}</span></div><div style="font-size:0.65rem;color:var(--text-muted);font-family:var(--font-mono)">${s.url}</div></div>`;
    });
    mc.innerHTML=mh;
    mc.style.display=sites.length>0?'':'none';
  } catch(e) {}
}

// ===== Toast =====
function toast(type, msg, dur=3000) {
  const c=$('#toastContainer');
  const el=document.createElement('div');
  el.className='toast-item '+type; el.innerHTML=msg;
  c.appendChild(el);
  setTimeout(()=>{ el.remove(); }, dur);
}

// ===== Theme =====
function themeInit() {
  const t=localStorage.getItem('vps-theme')||'dark';
  applyTheme(t);
  $('#themeToggler').addEventListener('click',()=>{
    const n=document.documentElement.dataset.theme==='dark'?'light':'dark';
    applyTheme(n); localStorage.setItem('vps-theme',n);
  });
}
function applyTheme(t) {
  document.documentElement.dataset.theme=t;
  const r=document.documentElement.style;
  if (t==='light') {
    r.setProperty('--bg-root','#f4f6f9');
    r.setProperty('--bg-surface','#ffffff');
    r.setProperty('--bg-card','rgba(255,255,255,0.9)');
    r.setProperty('--bg-card-hover','rgba(255,255,255,1)');
    r.setProperty('--text-primary','#1a2332');
    r.setProperty('--text-secondary','#5a6a7e');
    r.setProperty('--text-muted','#8a9ab0');
    r.setProperty('--border-subtle','rgba(0,0,0,0.06)');
    r.setProperty('--border-card','rgba(0,0,0,0.08)');
  } else {
    r.setProperty('--bg-root','#080c12');
    r.setProperty('--bg-surface','#0f1724');
    r.setProperty('--bg-card','rgba(18, 25, 40, 0.85)');
    r.setProperty('--bg-card-hover','rgba(24, 33, 52, 0.95)');
    r.setProperty('--text-primary','#dce3ed');
    r.setProperty('--text-secondary','#798aa2');
    r.setProperty('--text-muted','#4b5b72');
    r.setProperty('--border-subtle','rgba(255,255,255,0.06)');
    r.setProperty('--border-card','rgba(255,255,255,0.08)');
  }
}

// ===== Refs =====
async function startVpsRefresh() {
  let ms=60000;
  try{const d=await api('/api/admin/settings/vps-report-interval');if(d?.interval>0)ms=d.interval*1000;}catch(e){}
  if(vpsInterval)clearInterval(vpsInterval);
  vpsInterval=setInterval(loadServers,ms);
}
function startSiteRefresh() {
  if(siteInterval)clearInterval(siteInterval);
  siteInterval=setInterval(loadSites,3600000);
}

async function adminLink() {
  const l=$('#adminAuthLink'); if(!l) return;
  const t=localStorage.getItem('auth_token');
  if(!t){l.textContent='admin';l.href='/login.html';return;}
  try{const d=await api('/api/auth/status');if(d.authenticated){l.textContent='admin';l.href='/admin.html';}else{l.textContent='login';l.href='/login.html';localStorage.removeItem('auth_token');}}catch(e){l.textContent='login';}
}

// ===== Init =====
document.addEventListener('DOMContentLoaded',()=>{
  if(!$('#serverTableBody')){ themeInit(); return; }
  themeInit();
  switchView(currentView);
  loadServers(); loadSites();
  startVpsRefresh(); startSiteRefresh();
  adminLink();
  setInterval(()=>{ $('#footerTime').textContent = new Date().toISOString().replace('T',' ').slice(0,19)+' UTC'; }, 1000);

  // Detect mobile
  if(window.innerWidth<768) {
    $('#tableView').style.display='none'; $('#gridView').style.display='none';
    $('#mobileView').style.display=''; $('#tableView-sites').style.display='none';
    $('#mobileSiteContainer').style.display='';
  }
});
