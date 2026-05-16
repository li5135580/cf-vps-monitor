// vps-routes.js - VPS数据上报、状态查询、通知API

import { validateAndFixVpsData, sharedBatchProcessor } from './utils.js';

async function flushLocalBatch(env) {
  const { flushLocalBatch } = await import('./db.js');
  return flushLocalBatch(sharedBatchProcessor, env);
}

export async function handleVpsRoutes(path, method, request, env, corsHeaders, ctx) {
  const { createApiResponse, createErrorResponse, createSuccessResponse, getVpsReportInterval } = await import('./utils.js');
  const { validateServerAuth, authenticateRequestOptional } = await import('./auth.js');
  const { sendNotification } = await import('./notify.js');

  // VPS配置获取（API密钥认证）
  if (path.startsWith('/api/config/') && method === 'GET') {
    try {
      const authResult = await validateServerAuth(path, request, env);
      if (!authResult.success) {
        return createErrorResponse(authResult.error, authResult.message,
          authResult.error === 'Invalid server ID' ? 400 : 401, corsHeaders);
      }

      const { serverData } = authResult;
      const reportInterval = await getVpsReportInterval(env);

      return createApiResponse({
        success: true,
        config: {
          report_interval: reportInterval,
          enabled_metrics: ['cpu', 'memory', 'disk', 'network', 'uptime'],
          server_info: { id: serverData.id, name: serverData.name, description: serverData.description || '' }
        },
        timestamp: Math.floor(Date.now() / 1000)
      }, 200, corsHeaders);

    } catch (error) {
      return createErrorResponse('Config error', error.message, 500, corsHeaders);
    }
  }

  // VPS数据上报
  if (path.startsWith('/api/report/') && method === 'POST') {
    try {
      const authResult = await validateServerAuth(path, request, env);
      if (!authResult.success) {
        return createErrorResponse(authResult.error, authResult.message,
          authResult.error === 'Invalid server ID' ? 400 : 401, corsHeaders);
      }

      const { serverId } = authResult;
      let reportData;
      try {
        reportData = JSON.parse(await request.text());
      } catch (parseError) {
        return createErrorResponse('Invalid JSON format', `JSON解析失败: ${parseError.message}`, 400, corsHeaders);
      }

      const validationResult = validateAndFixVpsData(reportData);
      if (!validationResult.success) {
        return createErrorResponse(validationResult.error, validationResult.message, 400, corsHeaders);
      }

      reportData = validationResult.data;
      const currentInterval = await getVpsReportInterval(env);
      const shouldFlush = sharedBatchProcessor.addReport(serverId, reportData, currentInterval);

      if (shouldFlush || sharedBatchProcessor.shouldFlush(currentInterval)) {
        ctx.waitUntil(flushLocalBatch(env));
      }

      return createSuccessResponse({ interval: currentInterval }, corsHeaders);

    } catch (error) {
      return createErrorResponse('Report error', error.message, 500, corsHeaders);
    }
  }

  // 批量VPS状态查询（需要登录）
  if (path === '/api/status/batch' && method === 'GET') {
    try {
      const user = await authenticateRequestOptional(request, env);
      if (!user) return createErrorResponse('Unauthorized', '请先登录', 401, corsHeaders);

      const { results } = await env.DB.prepare(`
        SELECT s.id, s.name, s.description,
               m.timestamp, m.cpu, m.memory, m.disk, m.network, m.uptime
        FROM servers s
        LEFT JOIN metrics m ON s.id = m.server_id
        ORDER BY s.sort_order ASC NULLS LAST, s.name ASC
      `).all();

      const servers = (results || []).map(row => {
        const server = { id: row.id, name: row.name, description: row.description };
        let metrics = null;
        if (row.timestamp) {
          metrics = { timestamp: row.timestamp, uptime: row.uptime };
          try {
            if (row.cpu) metrics.cpu = JSON.parse(row.cpu);
            if (row.memory) metrics.memory = JSON.parse(row.memory);
            if (row.disk) metrics.disk = JSON.parse(row.disk);
            if (row.network) metrics.network = JSON.parse(row.network);
          } catch (e) { /* 静默处理 */ }
        }
        return { server, metrics, error: false };
      });

      return createApiResponse({ servers }, 200, corsHeaders);

    } catch (error) {
      return createErrorResponse('Batch query error', error.message, 500, corsHeaders);
    }
  }

  // 单个VPS状态查询
  if (path.startsWith('/api/status/') && method === 'GET') {
    try {
      const serverId = path.split('/')[3];
      if (!serverId) return createErrorResponse('Invalid server ID', '无效的服务器ID', 400, corsHeaders);

      const serverData = await env.DB.prepare('SELECT id, name, description FROM servers WHERE id = ?').bind(serverId).first();
      if (!serverData) return createErrorResponse('Server not found', '服务器不存在', 404, corsHeaders);

      const metricsData = await env.DB.prepare('SELECT * FROM metrics WHERE server_id = ? ORDER BY timestamp DESC LIMIT 1').bind(serverId).first();

      if (metricsData) {
        try {
          if (metricsData.cpu) metricsData.cpu = JSON.parse(metricsData.cpu);
          if (metricsData.memory) metricsData.memory = JSON.parse(metricsData.memory);
          if (metricsData.disk) metricsData.disk = JSON.parse(metricsData.disk);
          if (metricsData.network) metricsData.network = JSON.parse(metricsData.network);
        } catch (e) { /* 静默处理 */ }
      }

      return createApiResponse({
        server: serverData,
        metrics: metricsData || null,
        error: false
      }, 200, corsHeaders);

    } catch (error) {
      return createErrorResponse('Status error', error.message, 500, corsHeaders);
    }
  }

  // VPS历史数据API - 新增，用于前端趋势图
  if (path.startsWith('/api/history/') && method === 'GET') {
    try {
      const parts = path.split('/');
      const serverId = parts[3];
      const limit = parseInt(parts[4]) || 24;
      if (!serverId) return createErrorResponse('Invalid server ID', '无效的服务器ID', 400, corsHeaders);

      const { results } = await env.DB.prepare(
        'SELECT timestamp, cpu, memory FROM metrics WHERE server_id = ? ORDER BY timestamp DESC LIMIT ?'
      ).bind(serverId, Math.min(limit, 168)).all();

      const history = (results || []).reverse().map(row => {
        let cpu = null, memory = null;
        try { if (row.cpu) cpu = JSON.parse(row.cpu); } catch (e) {}
        try { if (row.memory) memory = JSON.parse(row.memory); } catch (e) {}
        return {
          timestamp: row.timestamp,
          cpu_usage: cpu?.usage_percent || 0,
          mem_usage: memory?.usage_percent || 0
        };
      });

      return createApiResponse({ history }, 200, corsHeaders);

    } catch (error) {
      return createErrorResponse('History error', error.message, 500, corsHeaders);
    }
  }

  // VPS离线通知（前端调用）
  if (path === '/api/notify/offline' && method === 'POST') {
    try {
      const { serverId, serverName } = await request.json();
      const server = await env.DB.prepare('SELECT last_notified_down_at FROM servers WHERE id = ?').bind(serverId).first();
      if (server?.last_notified_down_at) {
        return createApiResponse({ success: true, message: 'Already notified' }, 200, corsHeaders);
      }

      const message = `🔴 VPS故障: 服务器 *${serverName}* 已离线超过5分钟`;
      await env.DB.prepare('UPDATE servers SET last_notified_down_at = ? WHERE id = ?')
        .bind(Math.floor(Date.now() / 1000), serverId).run();
      ctx.waitUntil(sendNotification(env.DB, message));

      return createApiResponse({ success: true }, 200, corsHeaders);
    } catch (error) {
      return createErrorResponse('Notification failed', '通知发送失败', 500, corsHeaders);
    }
  }

  // VPS恢复通知
  if (path === '/api/notify/recovery' && method === 'POST') {
    try {
      const { serverId, serverName } = await request.json();
      const message = `✅ VPS恢复: 服务器 *${serverName}* 已恢复在线`;
      await env.DB.prepare('UPDATE servers SET last_notified_down_at = NULL WHERE id = ?').bind(serverId).run();
      ctx.waitUntil(sendNotification(env.DB, message));

      return createApiResponse({ success: true }, 200, corsHeaders);
    } catch (error) {
      return createErrorResponse('Notification failed', '通知发送失败', 500, corsHeaders);
    }
  }

  // Cron检查离线（API手动触发 + Cron自动调用）
  if (path === '/api/cron/check-offline' && (method === 'POST' || method === 'GET')) {
    const { checkVpsOfflineReminder, checkAllSites } = await import('./notify.js');
    const vpsResult = await checkVpsOfflineReminder(env, ctx);
    const siteResult = await checkAllSites(env, ctx);
    return createApiResponse({
      success: true,
      vps: vpsResult,
      sites: siteResult
    }, 200, corsHeaders);
  }

  return null;
}
