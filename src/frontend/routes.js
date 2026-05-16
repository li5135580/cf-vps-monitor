// frontend/routes.js - 前端页面路由

let indexHtml = null, loginHtml = null, adminHtml = null;
let styleCss = null, mainJs = null, loginJs = null, adminJs = null;

export async function handleFrontendRequest(request, path, url, env) {
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' };

  switch (path) {
    case '/': case '': case '/index.html':
      return new Response(getIndexHtml(env), { headers });
    case '/login': case '/login.html':
      return new Response(getLoginHtml(env), { headers });
    case '/admin': case '/admin.html':
      return new Response(getAdminHtml(env), { headers });
    case '/style.css':
      return new Response(getStyleCss(), { headers: { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=300' } });
    case '/main.js':
      return new Response(getMainJs(), { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=300' } });
    case '/login.js':
      return new Response(getLoginJs(), { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=300' } });
    case '/admin.js':
      return new Response(getAdminJs(), { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=300' } });
    case '/favicon.svg':
      return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#0d6efd"/><text x="50" y="65" font-size="50" text-anchor="middle" fill="white" font-family="Arial">V</text></svg>`, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    case '/install.sh':
      return handleInstallScript(request, url, env);
    default:
      return new Response(getIndexHtml(env), { headers });
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
# VPS监控脚本 - 快速安装
API_KEY=""
SERVER_ID=""
WORKER_URL="${baseUrl}"
INSTALL_DIR="/opt/vps-monitor"

while [[ $# -gt 0 ]]; do
  case $1 in
    -k|--key) API_KEY="$2"; shift 2 ;;
    -s|--server) SERVER_ID="$2"; shift 2 ;;
    -u|--url) WORKER_URL="$2"; shift 2 ;;
    -d|--dir) INSTALL_DIR="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

if [ -z "$API_KEY" ] || [ -z "$SERVER_ID" ]; then
  echo "用法: $0 -k API_KEY -s SERVER_ID [-u WORKER_URL]"
  exit 1
fi

echo "安装VPS监控..."
mkdir -p "$INSTALL_DIR"
curl -sSL "https://raw.githubusercontent.com/li5135580/cf-vps-monitor/main/cf-vps-monitor.sh" -o "$INSTALL_DIR/cf-vps-monitor.sh"
chmod +x "$INSTALL_DIR/cf-vps-monitor.sh"
"$INSTALL_DIR/cf-vps-monitor.sh" install -k "$API_KEY" -s "$SERVER_ID" -u "$WORKER_URL" -i ${interval}
`;
  return new Response(script, { headers: { 'Content-Type': 'text/x-shellscript', 'Cache-Control': 'public, max-age=3600' } });
}

function getIndexHtml(env) {
  if (indexHtml) return indexHtml;
  indexHtml = `<!DOCTYPE html>
<html lang="zh-CN" data-bs-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VPS监控面板</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <link href="/style.css" rel="stylesheet">
</head>
<body>
  <nav class="navbar navbar-expand-lg navbar-dark bg-dark mb-3">
    <div class="container-fluid">
      <a class="navbar-brand" href="/">VPS监控</a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="navbarNav">
        <ul class="navbar-nav ms-auto">
          <li class="nav-item"><button class="btn btn-sm btn-outline-light ms-2" id="themeToggler"><i class="bi bi-moon-stars-fill"></i></button></li>
          <li class="nav-item"><a class="nav-link text-light" id="adminAuthLink" href="/login.html">管理员登录</a></li>
        </ul>
      </div>
    </div>
  </nav>

  <div class="container-fluid px-2 px-md-4">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h5 class="mb-0">VPS服务器</h5>
      <div class="btn-group">
        <button class="btn btn-sm btn-outline-secondary active" id="btnTableView" onclick="switchView('table')"><i class="bi bi-list-ul"></i> 表格</button>
        <button class="btn btn-sm btn-outline-secondary" id="btnGridView" onclick="switchView('grid')"><i class="bi bi-grid-3x3-gap-fill"></i> 卡片</button>
      </div>
    </div>

    <div id="noServers" class="alert alert-info d-none">暂无服务器数据。请管理员登录后台添加服务器。</div>

    <div id="tableView" class="d-none d-md-block">
      <div class="table-responsive">
        <table class="table table-hover table-sm">
          <thead class="table-light">
            <tr><th>名称</th><th>状态</th><th>CPU</th><th>内存</th><th>硬盘</th><th>网络 ↑/↓</th><th>运行时长</th><th>更新</th></tr>
          </thead>
          <tbody id="serverTableBody"></tbody>
        </table>
      </div>
    </div>

    <div id="gridView" class="d-none">
      <div id="serverGrid" class="server-grid"></div>
    </div>

    <div id="mobileView" class="d-md-none">
      <div id="mobileServerContainer"></div>
    </div>

    <h5 class="mt-4 mb-2">网站监控</h5>
    <div class="table-responsive d-none d-md-block">
      <table class="table table-hover table-sm">
        <thead class="table-light"><tr><th>网站</th><th>URL</th><th>状态</th><th>响应</th><th>24h</th></tr></thead>
        <tbody id="siteTableBody"></tbody>
      </table>
    </div>
    <div id="mobileSiteContainer" class="d-md-none"></div>

    <footer class="text-center text-muted small py-3 mt-4">VPS监控面板 v2.0 | Cloudflare Workers</footer>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script src="/main.js"></script>
</body>
</html>`;
  return indexHtml;
}

function getLoginHtml(env) {
  if (loginHtml) return loginHtml;
  loginHtml = `<!DOCTYPE html>
<html lang="zh-CN" data-bs-theme="light">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理员登录 - VPS监控</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <link href="/style.css" rel="stylesheet">
</head>
<body class="d-flex align-items-center justify-content-center vh-100">
  <div class="card shadow" style="width:380px;max-width:95%">
    <div class="card-body p-4">
      <h4 class="text-center mb-3">管理员登录</h4>
      <form id="loginForm" onsubmit="return handleLogin(event)">
        <div class="mb-3"><label class="form-label">用户名</label><input type="text" class="form-control" id="username" required></div>
        <div class="mb-3"><label class="form-label">密码</label><input type="password" class="form-control" id="password" required></div>
        <div id="loginError" class="alert alert-danger d-none py-2"></div>
        <button type="submit" class="btn btn-primary w-100">登录</button>
      </form>
      <div class="text-center mt-3"><a href="/" class="text-muted small">← 返回首页</a></div>
    </div>
  </div>
  <script src="/login.js"></script>
</body>
</html>`;
  return loginHtml;
}

function getAdminHtml(env) {
  if (adminHtml) return adminHtml;
  adminHtml = `<!DOCTYPE html>
<html lang="zh-CN" data-bs-theme="light">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理后台 - VPS监控</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <link href="/style.css" rel="stylesheet">
</head>
<body>
  <nav class="navbar navbar-expand-lg navbar-dark bg-dark mb-3">
    <div class="container-fluid">
      <a class="navbar-brand" href="/admin.html">管理后台</a>
      <div class="navbar-nav ms-auto d-flex flex-row align-items-center gap-2">
        <button class="btn btn-sm btn-outline-light" id="themeToggler"><i class="bi bi-moon-stars-fill"></i></button>
        <a class="btn btn-sm btn-outline-light" href="/">返回首页</a>
        <button class="btn btn-sm btn-outline-danger" onclick="logout()">登出</button>
      </div>
    </div>
  </nav>

  <div class="container-fluid px-2 px-md-4">
    <ul class="nav nav-tabs mb-3" id="adminTabs">
      <li class="nav-item"><button class="nav-link active" data-tab="servers">服务器管理</button></li>
      <li class="nav-item"><button class="nav-link" data-tab="sites">站点管理</button></li>
      <li class="nav-item"><button class="nav-link" data-tab="telegram">Telegram通知</button></li>
      <li class="nav-item"><button class="nav-link" data-tab="background">背景设置</button></li>
      <li class="nav-item"><button class="nav-link" data-tab="settings">系统设置</button></li>
    </ul>
    <div id="tabContent"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script src="/admin.js"></script>
</body>
</html>`;
  return adminHtml;
}

function getStyleCss() {
  if (styleCss) return styleCss;
  styleCss = `:root { --page-opacity: 0.8; }

/* 网格布局 */
.server-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; }

.server-card {
  border-radius: 12px; padding: 1.25rem; background: rgba(255,255,255,var(--page-opacity));
  border: 2px solid #dee2e6; transition: all 0.2s ease; cursor: pointer; position: relative;
}
.server-card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.1); }
.server-card.online { border-left: 4px solid #198754; }
.server-card.offline { border-left: 4px solid #dc3545; }
.server-card.error { border-left: 4px solid #ffc107; }
.server-card.unknown { border-left: 4px solid #6c757d; }
.server-card .card-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem; padding-right: 4rem; }
.server-card .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1rem; }
.server-card .metric-item { display: flex; flex-direction: column; }
.server-card .metric-label { font-size: 0.7rem; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; }
.server-card .metric-value { font-size: 1rem; font-weight: 500; }
.server-card .status-badge { position: absolute; top: 1.25rem; right: 1.25rem; }
.server-card .mini-chart { width: 100%; height: 36px; margin-top: 0.5rem; }

/* 移动端卡片 */
.mobile-server-card {
  border-radius: 10px; padding: 0.75rem; margin-bottom: 0.5rem;
  background: rgba(255,255,255,var(--page-opacity)); border: 2px solid #dee2e6;
}
.mobile-card-two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem 0.5rem; margin-bottom: 0.3rem; }
.mobile-card-label { font-size: 0.65rem; color: #6c757d; display: block; }
.mobile-card-value { font-size: 0.85rem; font-weight: 500; }

/* 进度条 */
.progress { background-color: #e9ecef; border-radius: 6px; }
.bg-light-green { background-color: #28a745 !important; }

/* 暗色主题 */
[data-bs-theme="dark"] .server-card { background: rgba(33,37,41,var(--page-opacity)); border-color: #495057; }
[data-bs-theme="dark"] .mobile-server-card { background: rgba(33,37,41,var(--page-opacity)); border-color: #495057; }
[data-bs-theme="dark"] .server-card:hover { box-shadow: 0 8px 25px rgba(255,255,255,0.05); }

/* Toast */
.toast-container { position: fixed; top: 1rem; right: 1rem; z-index: 9999; }
.toast-item { min-width: 280px; margin-bottom: 0.5rem; }

/* 历史条 */
.history-bar-container { display: flex; gap: 1px; height: 18px; align-items: flex-end; }
.history-bar { flex: 1; min-width: 2px; border-radius: 1px; }
.history-bar.up { background: #198754; } .history-bar.down { background: #dc3545; } .history-bar.pending { background: #6c757d; }

@media (max-width: 767px) {
  .server-grid { grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
  .server-card { padding: 0.75rem; }
  .server-card .metric-grid { grid-template-columns: 1fr; gap: 0.25rem; }
  .server-card .mini-chart { height: 28px; }
  .mobile-card-two-columns { grid-template-columns: 1fr 1fr; }
}`;
  return styleCss;
}

function getMainJs() { return mainJs || '// main.js - see src/frontend/main.js'; }
function getLoginJs() { return loginJs || '// login.js - see src/frontend/login.js'; }
function getAdminJs() { return adminJs || '// admin.js - see src/frontend/admin.js'; }
