// admin-routes.js - 管理后台API (服务器/站点/Telegram/背景/设置)

import { configCache } from './config.js';
import { hashPassword, verifyPassword } from './utils.js';
import { createJWT, verifyJWTCached } from './auth.js';

export async function handleAuthRoutes(path, method, request, env, corsHeaders, clientIP) {
  const { createApiResponse, createErrorResponse, createSuccessResponse, getVpsReportInterval, isTokenRevoked, revokeToken } = await import('./utils.js');
  const { checkLoginAttempts, recordLoginAttempt, checkRateLimit } = await import('./auth.js');
  const { sendNotification } = await import('./notify.js');

  // 登录
  if (path === '/api/auth/login' && method === 'POST') {
    try {
      if (!checkLoginAttempts(clientIP, env)) {
        return createErrorResponse('Too many attempts', '登录尝试过于频繁，请15分钟后再试', 429, corsHeaders);
      }

      const { username, password } = await request.json();
      if (!username || !password) {
        recordLoginAttempt(clientIP);
        return createErrorResponse('Invalid credentials', '用户名和密码不能为空', 400, corsHeaders);
      }

      const user = await env.DB.prepare('SELECT * FROM admin_credentials WHERE username = ?').bind(username).first();
      if (!user) {
        recordLoginAttempt(clientIP);
        return createErrorResponse('Invalid credentials', '用户名或密码错误', 401, corsHeaders);
      }

      if (user.locked_until && Date.now() / 1000 < user.locked_until) {
        return createErrorResponse('Account locked', '账户已锁定，请稍后再试', 423, corsHeaders);
      }

      const passwordValid = await verifyPassword(password, user.password_hash);
      if (!passwordValid) {
        recordLoginAttempt(clientIP);
        const failedCount = (user.failed_attempts || 0) + 1;
        const updates = { failed_attempts: failedCount };
        if (failedCount >= 5) {
          updates.locked_until = Math.floor(Date.now() / 1000) + 1800;
        }
        await env.DB.prepare('UPDATE admin_credentials SET failed_attempts = ?, locked_until = ? WHERE username = ?')
          .bind(failedCount, updates.locked_until || null, username).run();
        return createErrorResponse('Invalid credentials', '用户名或密码错误', 401, corsHeaders);
      }

      // 重置失败计数
      await env.DB.prepare('UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL, last_login = ? WHERE username = ?')
        .bind(Math.floor(Date.now() / 1000), username).run();

      const token = await createJWT({ username, role: 'admin' }, env);
      return createApiResponse({ success: true, token, mustChangePassword: !!user.must_change_password }, 200, corsHeaders);

    } catch (error) {
      return createErrorResponse('Login failed', error.message, 500, corsHeaders);
    }
  }

  // 验证token状态
  if (path === '/api/auth/status' && method === 'GET') {
    const payload = await verifyJWTCached(request.headers.get('Authorization')?.substring(7) || '', env);
    return createApiResponse({
      authenticated: !!payload,
      username: payload?.username || null,
      role: payload?.role || null
    }, 200, corsHeaders);
  }

  // 登出
  if (path === '/api/auth/logout' && method === 'POST') {
    const token = request.headers.get('Authorization')?.substring(7);
    if (token) revokeToken(token);
    return createSuccessResponse({}, corsHeaders);
  }

  // 修改密码
  if (path === '/api/auth/change-password' && method === 'POST') {
    const payload = await verifyJWTCached(request.headers.get('Authorization')?.substring(7) || '', env);
    if (!payload?.role === 'admin') {
      return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    }

    try {
      const { currentPassword, newPassword } = await request.json();
      if (!newPassword || newPassword.length < (await import('./config.js').getSecurityConfig(env)).MIN_PASSWORD_LENGTH) {
        return createErrorResponse('Invalid password', `密码长度至少8位`, 400, corsHeaders);
      }

      const user = await env.DB.prepare('SELECT password_hash FROM admin_credentials WHERE username = ?').bind(payload.username).first();
      if (!user) return createErrorResponse('User not found', '用户不存在', 404, corsHeaders);

      const valid = await verifyPassword(currentPassword, user.password_hash);
      if (!valid) return createErrorResponse('Invalid password', '当前密码错误', 401, corsHeaders);

      const newHash = await hashPassword(newPassword);
      await env.DB.prepare('UPDATE admin_credentials SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE username = ?')
        .bind(newHash, Math.floor(Date.now() / 1000), payload.username).run();

      return createSuccessResponse({}, corsHeaders);
    } catch (error) {
      return createErrorResponse('Change password failed', error.message, 500, corsHeaders);
    }
  }

  return null;
}

export async function handleAdminRoutes(path, method, request, env, corsHeaders, ctx) {
  const { createApiResponse, createErrorResponse, createSuccessResponse, getVpsReportInterval } = await import('./utils.js');
  const { authenticateAdmin } = await import('./auth.js');
  const { sendNotification } = await import('./notify.js');

  // ==================== 服务器管理API ====================

  // 获取服务器列表
  if ((path === '/api/admin/servers' || path === '/api/servers') && method === 'GET') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    try {
      // 管理员获取服务器列表（含api_key用于安装脚本复制）
      const { results } = await env.DB.prepare(
        'SELECT id, name, description, api_key, is_public, sort_order FROM servers ORDER BY sort_order ASC NULLS LAST, name ASC'
      ).all();
      const servers = results || [];
      return createApiResponse({ servers }, 200, corsHeaders);
    } catch (error) {
      return createErrorResponse('Server list error', error.message, 500, corsHeaders);
    }
  }

  // 添加服务器（API密钥自动生成随机强密钥）
  if ((path === '/api/admin/servers' || path === '/api/servers') && method === 'POST') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    try {
      const { id, name, description, is_public } = await request.json();
      if (!id || !name) return createErrorResponse('Invalid input', '服务器ID和名称为必填项', 400, corsHeaders);

      // 自动生成随机32位强密钥
      const randomBytes = crypto.getRandomValues(new Uint8Array(24));
      const api_key = 'sk-' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      await env.DB.prepare(
        'INSERT INTO servers (id, name, description, api_key, is_public, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, name, description || '', api_key, is_public !== false ? 1 : 0, Math.floor(Date.now() / 1000)).run();

      configCache.clearKey('servers_admin');
      configCache.clearKey('servers_public');
      return createSuccessResponse({ id, api_key }, corsHeaders);
    } catch (error) {
      if (error.message?.includes('UNIQUE')) return createErrorResponse('Duplicate', '服务器ID已存在', 409, corsHeaders);
      return createErrorResponse('Create server failed', error.message, 500, corsHeaders);
    }
  }

  // 更新服务器
  if (path.startsWith('/api/admin/servers/') && method === 'PUT') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    const serverId = path.split('/')[4];
    try {
      const { name, description, api_key, is_public, sort_order } = await request.json();
      const updates = [];
      const values = [];

      if (name !== undefined) { updates.push('name = ?'); values.push(name); }
      if (description !== undefined) { updates.push('description = ?'); values.push(description); }
      if (api_key !== undefined) { updates.push('api_key = ?'); values.push(api_key); }
      if (is_public !== undefined) { updates.push('is_public = ?'); values.push(is_public ? 1 : 0); }
      if (sort_order !== undefined) { updates.push('sort_order = ?'); values.push(sort_order); }

      if (updates.length === 0) return createErrorResponse('No updates', '没有提供更新字段', 400, corsHeaders);

      values.push(serverId);
      await env.DB.prepare(`UPDATE servers SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

      configCache.clearKey('servers_admin');
      configCache.clearKey('servers_public');
      return createSuccessResponse({}, corsHeaders);
    } catch (error) {
      return createErrorResponse('Update server failed', error.message, 500, corsHeaders);
    }
  }

  // 删除服务器
  if (path.startsWith('/api/admin/servers/') && method === 'DELETE') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    const serverId = path.split('/')[4];
    try {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM metrics WHERE server_id = ?').bind(serverId),
        env.DB.prepare('DELETE FROM servers WHERE id = ?').bind(serverId)
      ]);
      configCache.clearKey('servers_admin');
      configCache.clearKey('servers_public');
      return createSuccessResponse({}, corsHeaders);
    } catch (error) {
      return createErrorResponse('Delete server failed', error.message, 500, corsHeaders);
    }
  }

  // 批量排序
  if ((path === '/api/admin/servers/batch-reorder' || path === '/api/servers/batch-reorder') && method === 'POST') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    try {
      const { serverIds } = await request.json();
      if (!Array.isArray(serverIds)) return createErrorResponse('Invalid input', 'serverIds必须为数组', 400, corsHeaders);

      const statements = serverIds.map((id, index) =>
        env.DB.prepare('UPDATE servers SET sort_order = ? WHERE id = ?').bind(index, id)
      );
      await env.DB.batch(statements);
      configCache.clearKey('servers_admin');
      configCache.clearKey('servers_public');
      return createSuccessResponse({}, corsHeaders);
    } catch (error) {
      return createErrorResponse('Reorder failed', error.message, 500, corsHeaders);
    }
  }

  // ==================== Telegram配置API ====================

  if (path === '/api/admin/telegram-settings' && method === 'GET') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    try {
      const settings = await configCache.getTelegramConfig(env.DB);
      return createApiResponse(settings || { bot_token: null, chat_id: null, enable_notifications: 0 }, 200, corsHeaders);
    } catch (error) {
      return createErrorResponse('Telegram settings error', error.message, 500, corsHeaders);
    }
  }

  if (path === '/api/admin/telegram-settings' && method === 'POST') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    try {
      const { bot_token, chat_id, enable_notifications } = await request.json();
      const updatedAt = Math.floor(Date.now() / 1000);
      const enableNotifValue = (enable_notifications === true || enable_notifications === 1) ? 1 : 0;

      await env.DB.prepare(
        'UPDATE telegram_config SET bot_token = ?, chat_id = ?, enable_notifications = ?, updated_at = ? WHERE id = 1'
      ).bind(bot_token || null, chat_id || null, enableNotifValue, updatedAt).run();

      // 立即清除缓存
      configCache.clearKey('telegram_config');

      // 发送测试通知
      if (enableNotifValue === 1 && bot_token && chat_id) {
        const testMessage = "✅ Telegram通知已在此监控面板激活。这是一条测试消息。";
        if (ctx?.waitUntil) {
          ctx.waitUntil(sendNotification(env.DB, testMessage));
        } else {
          sendNotification(env.DB, testMessage).catch(() => {});
        }
      }

      return createSuccessResponse({}, corsHeaders);
    } catch (error) {
      return createErrorResponse('Telegram settings error', error.message, 500, corsHeaders);
    }
  }

  // ==================== 背景设置API ====================

  if (path === '/api/admin/background-settings' && method === 'GET') {
    try {
      const { results } = await env.DB.prepare(
        "SELECT key, value FROM app_config WHERE key IN ('custom_background_enabled', 'custom_background_url', 'page_opacity')"
      ).all();

      const settings = { enabled: false, url: '', opacity: 80 };
      (results || []).forEach(row => {
        if (row.key === 'custom_background_enabled') settings.enabled = row.value === 'true';
        else if (row.key === 'custom_background_url') settings.url = row.value || '';
        else if (row.key === 'page_opacity') settings.opacity = parseInt(row.value, 10) || 80;
      });
      return createApiResponse(settings, 200, corsHeaders);
    } catch (error) {
      return createApiResponse({ enabled: false, url: '', opacity: 80 }, 200, corsHeaders);
    }
  }

  if (path === '/api/admin/background-settings' && method === 'POST') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    try {
      const { enabled, url, opacity } = await request.json();
      if (enabled && url && !url.startsWith('https://')) {
        return createErrorResponse('Invalid URL', '背景图片URL必须以https://开头', 400, corsHeaders);
      }
      if (typeof opacity !== 'number' || opacity < 0 || opacity > 100) {
        return createErrorResponse('Invalid opacity', '透明度必须是0-100之间的数字', 400, corsHeaders);
      }

      await env.DB.batch([
        env.DB.prepare('REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('custom_background_enabled', (!!enabled).toString()),
        env.DB.prepare('REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('custom_background_url', url || ''),
        env.DB.prepare('REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('page_opacity', String(opacity || 80))
      ]);
      return createSuccessResponse({}, corsHeaders);
    } catch (error) {
      return createErrorResponse('Background settings error', error.message, 500, corsHeaders);
    }
  }

  // ==================== VPS上报间隔设置 ====================

  if (path === '/api/admin/settings/vps-report-interval' && method === 'GET') {
    try {
      const interval = await getVpsReportInterval(env);
      return createApiResponse({ interval }, 200, corsHeaders);
    } catch (error) {
      return createApiResponse({ interval: 60 }, 200, corsHeaders);
    }
  }

  if (path === '/api/admin/settings/vps-report-interval' && method === 'POST') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    try {
      const { interval } = await request.json();
      if (typeof interval !== 'number' || interval < 10 || interval > 3600) {
        return createErrorResponse('Invalid interval', '间隔必须在10-3600秒之间', 400, corsHeaders);
      }
      await env.DB.prepare("REPLACE INTO app_config (key, value) VALUES ('vps_report_interval_seconds', ?)").bind(String(interval)).run();
      return createSuccessResponse({ interval }, corsHeaders);
    } catch (error) {
      return createErrorResponse('Interval setting error', error.message, 500, corsHeaders);
    }
  }

  // ==================== 站点管理API ====================

  if ((path === '/api/admin/sites' || path === '/api/sites') && method === 'GET') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    try {
      const { results } = await env.DB.prepare('SELECT * FROM monitored_sites ORDER BY sort_order ASC NULLS LAST, name ASC').all();
      return createApiResponse({ sites: results || [] }, 200, corsHeaders);
    } catch (error) {
      return createErrorResponse('Site list error', error.message, 500, corsHeaders);
    }
  }

  if ((path === '/api/admin/sites' || path === '/api/sites') && method === 'POST') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    try {
      const { id, url, name, is_public } = await request.json();
      if (!id || !url) return createErrorResponse('Invalid input', '站点ID和URL为必填项', 400, corsHeaders);

      await env.DB.prepare(
        'INSERT INTO monitored_sites (id, url, name, is_public, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(id, url, name || '', is_public !== false ? 1 : 0, Math.floor(Date.now() / 1000)).run();

      return createSuccessResponse({ id }, corsHeaders);
    } catch (error) {
      if (error.message?.includes('UNIQUE')) return createErrorResponse('Duplicate', '站点ID已存在', 409, corsHeaders);
      return createErrorResponse('Create site failed', error.message, 500, corsHeaders);
    }
  }

  // 站点状态查询（公开）
  if (path === '/api/sites/status' && method === 'GET') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '请先登录', 401, corsHeaders);
    try {

      const { results } = await env.DB.prepare(`
        SELECT id, url, name, last_checked, last_status, last_status_code, last_response_time_ms, is_public
        FROM monitored_sites
        ORDER BY sort_order ASC NULLS LAST, name ASC
      `).all();

      // 查询每个站点的最近24条历史
      for (const site of (results || [])) {
        try {
          const { results: historyResults } = await env.DB.prepare(
            'SELECT timestamp, status, response_time_ms FROM site_status_history WHERE site_id = ? ORDER BY timestamp DESC LIMIT 24'
          ).bind(site.id).all();
          site.history = historyResults || [];
        } catch (e) {
          site.history = [];
        }
      }

      return createApiResponse({ sites: results || [] }, 200, corsHeaders);
    } catch (error) {
      return createErrorResponse('Site status error', error.message, 500, corsHeaders);
    }
  }

  // 站点历史
  if (path.match(/\/api\/sites\/[^\/]+\/history$/) && method === 'GET') {
    try {
      const siteId = path.split('/')[3];
      const { results } = await env.DB.prepare(
        'SELECT timestamp, status, response_time_ms FROM site_status_history WHERE site_id = ? ORDER BY timestamp DESC LIMIT 24'
      ).bind(siteId).all();
      return createApiResponse({ history: results || [] }, 200, corsHeaders);
    } catch (error) {
      return createApiResponse({ history: [] }, 200, corsHeaders);
    }
  }

  // 默认密码检查
  if (path === '/api/admin/check-default-password' && method === 'GET') {
    const user = await authenticateAdmin(request, env);
    if (!user) return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    try {
      const adminConfig = (await import('./config.js')).getAdminConfig(env);
      const isDefault = adminConfig.PASSWORD === 'monitor2025!' || adminConfig.USERNAME === 'admin';
      return createApiResponse({ isDefaultPassword: isDefault }, 200, corsHeaders);
    } catch (error) {
      return createErrorResponse('Check failed', error.message, 500, corsHeaders);
    }
  }

  return null;
}
