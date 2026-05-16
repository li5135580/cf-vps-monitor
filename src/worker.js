// worker.js - Cloudflare Worker 主入口

import { ensureTablesExist, scheduleVpsBatchFlush } from './db.js';
import { VpsBatchProcessor, getVpsReportInterval } from './utils.js';
import { getSecureCorsHeaders, checkRateLimit } from './auth.js';
import { getClientIP, createErrorResponse, createSuccessResponse } from './utils.js';
import { handleAuthRoutes } from './admin-routes.js';
import { handleVpsRoutes } from './vps-routes.js';
import { handleAdminRoutes } from './admin-routes.js';
import { scheduledEventHandler } from './monitor.js';

let dbInitialized = false;
const vpsBatchProcessor = new VpsBatchProcessor();

async function handleApiRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const clientIP = getClientIP(request);
  const origin = request.headers.get('Origin');
  const corsHeaders = getSecureCorsHeaders(origin, env);

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 速率限制（登录接口除外）
  if (path !== '/api/auth/login' && !checkRateLimit(clientIP, path, env)) {
    return createErrorResponse('Rate limit exceeded', '请求过于频繁，请稍后再试', 429, corsHeaders);
  }

  // 数据库初始化
  if (path === '/api/init-db' && ['POST', 'GET'].includes(method)) {
    try {
      await ensureTablesExist(env.DB, env);
      return createSuccessResponse({ message: '数据库初始化完成' }, corsHeaders);
    } catch (error) {
      return createErrorResponse('Database initialization failed', `数据库初始化失败: ${error.message}`, 500, corsHeaders);
    }
  }

  // 认证路由
  if (path.startsWith('/api/auth/')) {
    const result = await handleAuthRoutes(path, method, request, env, corsHeaders, clientIP);
    if (result) return result;
  }

  // VPS监控路由
  if (path.startsWith('/api/config/') || path.startsWith('/api/report/') || path.startsWith('/api/status/') ||
      path.startsWith('/api/notify/') || path.startsWith('/api/history/') || path.startsWith('/api/cron/')) {
    const result = await handleVpsRoutes(path, method, request, env, corsHeaders, ctx);
    if (result) return result;
  }

  // 管理后台路由
  if (path.startsWith('/api/admin/') || path.startsWith('/api/servers') || path.startsWith('/api/sites')) {
    const result = await handleAdminRoutes(path, method, request, env, corsHeaders, ctx);
    if (result) return result;
  }

  return createErrorResponse('Not Found', `未找到API路径: ${path}`, 404, corsHeaders);
}

// ==================== 导出 ====================

export default {
  async fetch(request, env, ctx) {
    // 首次访问时初始化数据库
    if (!dbInitialized) {
      try {
        await ensureTablesExist(env.DB, env);
        dbInitialized = true;
      } catch (error) {
        // 静默处理
      }
    }

    // 定时刷新VPS批量数据
    scheduleVpsBatchFlush(vpsBatchProcessor, env, ctx);

    const url = new URL(request.url);
    const path = url.pathname;

    // API请求
    if (path.startsWith('/api/')) {
      return handleApiRequest(request, env, ctx);
    }

    // 前端页面
    const { handleFrontendRequest } = await import('./frontend/routes.generated.js');
    return handleFrontendRequest(request, path, url, env);
  },

  async scheduled(event, env, ctx) {
    await scheduledEventHandler(event, env, ctx);
  }
};
