// frontend/routes.js - 前端路由 + 内联HTML模板（默认中文，可选英文）

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
  <title>VPS 监控面板</title>
  <link href="/style.css" rel="stylesheet">
</head>
<body>
  <nav class="navbar d-flex align-center justify-between">
    <a href="/" class="nav-brand"><span class="dot"></span>vps.monitor<span class="cursor"></span></a>
    <div class="d-flex align-center gap-2">
      <button class="btn-ghost" id="langToggle" title="Switch Language">EN</button>
      <button class="btn-ghost" id="themeToggler" title="切换主题">◐</button>
      <a class="btn-ghost" id="adminAuthLink" href="/login.html">管理员登录</a>
    </div>
  </nav>

  <div class="container" style="max-width:1400px;margin:0 auto;padding:1.25rem 1rem;">
    <div class="section-header">
      <span class="section-title" data-i18n="servers_title">服务器</span>
      <div class="view-toggle">
        <button id="btnTableView" class="active" onclick="switchView('table')" data-i18n="view_table">📋 表格</button>
        <button id="btnGridView" onclick="switchView('grid')" data-i18n="view_grid">⊞ 卡片</button>
      </div>
    </div>

    <div id="noServers" style="display:none;text-align:center;padding:2rem;color:var(--text-muted);font-family:var(--font-mono)" data-i18n="no_servers">
      暂无服务器 · <a href="/admin.html" style="color:var(--accent-cyan)">添加服务器</a>
    </div>

    <div id="tableView">
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr>
            <th data-i18n="th_name">名称</th><th data-i18n="th_status">状态</th><th>CPU</th><th data-i18n="th_memory">内存</th><th data-i18n="th_disk">硬盘</th><th data-i18n="th_network">网络</th><th data-i18n="th_uptime">运行时长</th><th data-i18n="th_updated">更新</th>
          </tr></thead>
          <tbody id="serverTableBody"></tbody>
        </table>
      </div>
    </div>

    <div id="gridView" style="display:none"><div id="serverGrid" class="server-grid"></div></div>
    <div id="mobileView" style="display:none"><div id="mobileServerContainer"></div></div>

    <div class="section-header mt-4"><span class="section-title" data-i18n="sites_title">网站监控</span></div>
    <div id="tableView-sites" style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>
          <th data-i18n="th_site">网站</th><th>URL</th><th data-i18n="th_status">状态</th><th data-i18n="th_response">响应时间</th><th data-i18n="th_history">24h历史</th>
        </tr></thead>
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
  <title>管理员登录 · VPS 监控</title>
  <link href="/style.css" rel="stylesheet">
</head>
<body class="login-page">
  <div class="login-card">
    <h1>> admin_auth</h1>
    <form id="loginForm" onsubmit="return handleLogin(event)">
      <div class="form-group"><label class="form-label" data-i18n="username">用户名</label><input class="form-input" id="username" required autofocus></div>
      <div class="form-group"><label class="form-label" data-i18n="password">密码</label><input class="form-input" type="password" id="password" required></div>
      <div id="loginError" class="alert alert-danger" style="display:none"></div>
      <button type="submit" class="btn-primary w-full" style="margin-top:0.5rem" data-i18n="login_btn">登录</button>
    </form>
    <div class="text-center" style="margin-top:1.5rem"><a href="/" class="btn-ghost" data-i18n="back">← 返回</a></div>
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
  <title>管理后台 · VPS 监控</title>
  <link href="/style.css" rel="stylesheet">
</head>
<body>
  <nav class="navbar d-flex align-center justify-between">
    <a href="/" class="nav-brand"><span class="dot"></span>vps.admin<span class="cursor"></span></a>
    <div class="d-flex align-center gap-2">
      <button class="btn-ghost" id="langToggle" title="Switch Language">EN</button>
      <button class="btn-ghost" id="themeToggler" title="切换主题">◐</button>
      <a class="btn-ghost" href="/" data-i18n="dashboard">控制台</a>
      <button class="btn-danger" onclick="logout()" data-i18n="exit">退出</button>
    </div>
  </nav>

  <div class="container" style="max-width:1200px;margin:0 auto;padding:1.25rem 1rem;">
    <div class="admin-tabs">
      <button class="admin-tab active" data-tab="servers" data-i18n="tab_servers">服务器</button>
      <button class="admin-tab" data-tab="sites" data-i18n="tab_sites">网站</button>
      <button class="admin-tab" data-tab="telegram">Telegram</button>
      <button class="admin-tab" data-tab="background" data-i18n="tab_background">背景</button>
      <button class="admin-tab" data-tab="settings" data-i18n="tab_settings">设置</button>
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
