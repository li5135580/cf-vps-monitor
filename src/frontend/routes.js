// frontend/routes.js - 前端路由 + 内联HTML模板

let indexHtml = null, loginHtml = null, adminHtml = null;
let styleCss = null, mainJs = null, loginJs = null, adminJs = null;

export async function handleFrontendRequest(request, path, url, env) {
  const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' };

  switch (path) {
    case '/': case '': case '/index.html':
      return new Response(getIndexHtml(env), { headers: htmlHeaders });
    case '/login': case '/login.html':
      return new Response(getLoginHtml(env), { headers: htmlHeaders });
    case '/admin': case '/admin.html':
      return new Response(getAdminHtml(env), { headers: htmlHeaders });
    case '/style.css':
      return new Response(getStyleCss(), { headers: { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=600' } });
    case '/main.js':
      return new Response(getMainJs(), { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=300' } });
    case '/login.js':
      return new Response(getLoginJs(), { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=300' } });
    case '/admin.js':
      return new Response(getAdminJs(), { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=300' } });
    case '/favicon.svg':
      return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0f1724"/><text x="16" y="22" font-size="18" text-anchor="middle" fill="#00d4ff" font-family="monospace" font-weight="bold">V</text></svg>`, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    case '/install.sh':
      return handleInstallScript(request, url, env);
    default:
      return new Response(getIndexHtml(env), { headers: htmlHeaders });
  }
}

async function handleInstallScript(request, url, env) {
  let interval = '60';
  try {
    const result = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'vps_report_interval_seconds'").first();
    if (result?.value) interval = result.value;
  } catch (e) {}
  const baseUrl = url.origin;
  const script = `#!/bin/bash
API_KEY="" SERVER_ID="" WORKER_URL="${baseUrl}" INSTALL_DIR="/opt/vps-monitor"
while [[ $# -gt 0 ]]; do case $1 in -k|--key) API_KEY="$2"; shift 2;; -s|--server) SERVER_ID="$2"; shift 2;; -u|--url) WORKER_URL="$2"; shift 2;; -d|--dir) INSTALL_DIR="$2"; shift 2;; *) echo "Unknown: $1"; exit 1;; esac; done
if [ -z "$API_KEY" ] || [ -z "$SERVER_ID" ]; then echo "Usage: $0 -k API_KEY -s SERVER_ID [-u WORKER_URL]"; exit 1; fi
mkdir -p "$INSTALL_DIR"
curl -sSL "https://raw.githubusercontent.com/li5135580/cf-vps-monitor/main/cf-vps-monitor.sh" -o "$INSTALL_DIR/cf-vps-monitor.sh"
chmod +x "$INSTALL_DIR/cf-vps-monitor.sh"
"$INSTALL_DIR/cf-vps-monitor.sh" install -k "$API_KEY" -s "$SERVER_ID" -u "$WORKER_URL" -i ${interval}
`;
  return new Response(script, { headers: { 'Content-Type': 'text/x-shellscript' } });
}

function getIndexHtml(env) {
  if (indexHtml) return indexHtml;
  indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VPS Monitor</title>
  <link href="/style.css" rel="stylesheet">
</head>
<body>
  <nav class="navbar d-flex align-center justify-between">
    <a href="/" class="nav-brand"><span class="dot"></span>vps.monitor<span class="cursor"></span></a>
    <div class="d-flex align-center gap-2">
      <button class="btn-ghost" id="themeToggler" title="Toggle theme">◐</button>
      <a class="btn-ghost" id="adminAuthLink" href="/login.html">admin</a>
    </div>
  </nav>

  <div class="container" style="max-width:1400px;margin:0 auto;padding:1.25rem 1rem;">
    <div class="section-header">
      <span class="section-title">servers</span>
      <div class="view-toggle">
        <button id="btnTableView" class="active" onclick="switchView('table')">📋 table</button>
        <button id="btnGridView" onclick="switchView('grid')">⊞ grid</button>
      </div>
    </div>

    <div id="noServers" style="display:none;text-align:center;padding:2rem;color:var(--text-muted);font-family:var(--font-mono)">
      no servers configured · <a href="/admin.html" style="color:var(--accent-cyan)">add one</a>
    </div>

    <div id="tableView">
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>name</th><th>status</th><th>cpu</th><th>memory</th><th>disk</th><th>network</th><th>uptime</th><th>updated</th></tr></thead>
          <tbody id="serverTableBody"></tbody>
        </table>
      </div>
    </div>

    <div id="gridView" style="display:none"><div id="serverGrid" class="server-grid"></div></div>
    <div id="mobileView" style="display:none"><div id="mobileServerContainer"></div></div>

    <div class="section-header mt-4"><span class="section-title">sites</span></div>
    <div id="tableView-sites" style="overflow-x:auto">
      <table class="data-table">
        <thead><tr><th>site</th><th>url</th><th>status</th><th>response</th><th>24h history</th></tr></thead>
        <tbody id="siteTableBody"></tbody>
      </table>
    </div>
    <div id="mobileSiteContainer" style="display:none"></div>

    <footer class="text-center" style="padding:2rem 0;font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted)">
      v3.0 · Cloudflare Workers · <span id="footerTime"></span>
    </footer>
  </div>

  <div class="toast-container" id="toastContainer"></div>
  <script src="/main.js"></script>
</body>
</html>`;
  return indexHtml;
}

function getLoginHtml(env) {
  if (loginHtml) return loginHtml;
  loginHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login · VPS Monitor</title>
  <link href="/style.css" rel="stylesheet">
</head>
<body class="login-page">
  <div class="login-card">
    <h1>> admin_auth</h1>
    <form id="loginForm" onsubmit="return handleLogin(event)">
      <div class="form-group"><label class="form-label">username</label><input class="form-input" id="username" required autofocus></div>
      <div class="form-group"><label class="form-label">password</label><input class="form-input" type="password" id="password" required></div>
      <div id="loginError" class="alert alert-danger" style="display:none"></div>
      <button type="submit" class="btn-primary w-full" style="margin-top:0.5rem">authenticate</button>
    </form>
    <div class="text-center" style="margin-top:1.5rem"><a href="/" class="btn-ghost">← back</a></div>
  </div>
  <script src="/login.js"></script>
</body>
</html>`;
  return loginHtml;
}

function getAdminHtml(env) {
  if (adminHtml) return adminHtml;
  adminHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin · VPS Monitor</title>
  <link href="/style.css" rel="stylesheet">
</head>
<body>
  <nav class="navbar d-flex align-center justify-between">
    <a href="/" class="nav-brand"><span class="dot"></span>vps.admin<span class="cursor"></span></a>
    <div class="d-flex align-center gap-2">
      <button class="btn-ghost" id="themeToggler">◐</button>
      <a class="btn-ghost" href="/">dashboard</a>
      <button class="btn-danger" onclick="logout()">exit</button>
    </div>
  </nav>

  <div class="container" style="max-width:1200px;margin:0 auto;padding:1.25rem 1rem;">
    <div class="admin-tabs">
      <button class="admin-tab active" data-tab="servers">servers</button>
      <button class="admin-tab" data-tab="sites">sites</button>
      <button class="admin-tab" data-tab="telegram">telegram</button>
      <button class="admin-tab" data-tab="background">background</button>
      <button class="admin-tab" data-tab="settings">settings</button>
    </div>
    <div id="tabContent"><div class="spinner"></div></div>
  </div>

  <div class="toast-container" id="toastContainer"></div>
  <script src="/admin.js"></script>
</body>
</html>`;
  return adminHtml;
}

function getStyleCss() {
  if (styleCss) return styleCss;
  try {
    styleCss = require('./style.css');
  } catch {
    styleCss = '/* style.css inlined at build time */';
  }
  return styleCss;
}

function getMainJs() { return mainJs || '/* main.js inlined at build time */'; }
function getLoginJs() { return loginJs || '/* login.js inlined at build time */'; }
function getAdminJs() { return adminJs || '/* admin.js inlined at build time */'; }
