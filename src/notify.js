// notify.js - 消息通知服务（含响应检查与日志）

import { configCache } from './config.js';

const TG_API = 'https://api.tele' + 'gram.org/bot';

export async function sendNotification(db, message, priority = 'normal') {
  try {
    const cfg = await configCache.getTelegramConfig(db);

    if (!cfg?.enable_notifications || !cfg.bot_token || !cfg.chat_id) {
      return { success: false, reason: 'config_incomplete' };
    }

    const url = TG_API + cfg.bot_token + '/sendMessage';
    const payload = {
      chat_id: cfg.chat_id,
      text: message,
      parse_mode: 'Markdown'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      console.error('[Notify] send failed (' + response.status + '): ' + errorBody.slice(0, 200));
      return { success: false, reason: 'api_error', status: response.status };
    }

    const result = await response.json();
    console.log('[Notify] sent: ' + message.slice(0, 50) + '...');
    return { success: true, messageId: result?.result?.message_id };

  } catch (error) {
    console.error('[Notify] exception: ' + error.message);
    return { success: false, reason: 'exception', error: error.message };
  }
}

export async function checkVpsOfflineReminder(env, ctx) {
  try {
    const cfg = await configCache.getTelegramConfig(env.DB);

    if (!cfg?.enable_notifications || !cfg.bot_token || !cfg.chat_id) {
      return { checked: false, reason: 'notifications_disabled' };
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const offlineThreshold = 5 * 60;
    const reminderInterval = 60 * 60;

    const { results: offlineServers } = await env.DB.prepare(`
      SELECT s.id, s.name, s.last_notified_down_at, m.timestamp as last_report
      FROM servers s
      LEFT JOIN metrics m ON s.id = m.server_id
      WHERE s.last_notified_down_at IS NOT NULL
        AND (m.timestamp IS NULL OR m.timestamp < ?)
        AND s.last_notified_down_at < ?
    `).bind(currentTime - offlineThreshold, currentTime - reminderInterval).all();

    let notified = 0;
    for (const server of offlineServers || []) {
      const displayName = server.name || server.id;
      const offlineHours = Math.floor((currentTime - server.last_notified_down_at) / 3600);
      const msg = 'VPS持续离线: ' + displayName + ' 已离线' + offlineHours + '小时';
      ctx.waitUntil(sendNotification(env.DB, msg));
      ctx.waitUntil(env.DB.prepare('UPDATE servers SET last_notified_down_at = ? WHERE id = ?')
        .bind(currentTime, server.id).run());
      notified++;
    }

    return { checked: true, offlineServers: notified };

  } catch (error) {
    console.error('[OfflineCheck] error: ' + error.message);
    return { checked: false, reason: 'error', error: error.message };
  }
}

export async function checkWebsiteAndNotify(site, db, ctx) {
  const { id, url, name } = site;
  const startTime = Date.now();
  let newStatus = 'PENDING';
  let newStatusCode = null;
  let newResponseTime = null;
  let previousStatus = 'PENDING';
  let siteLastNotifiedDownAt = null;

  try {
    const result = await db.prepare(
      'SELECT last_status, last_notified_down_at FROM monitored_sites WHERE id = ?'
    ).bind(id).first();
    if (result) {
      previousStatus = result.last_status || 'PENDING';
      siteLastNotifiedDownAt = result.last_notified_down_at;
    }
  } catch (e) { /* silent */ }

  const NOTIFY_INTERVAL = 60 * 60;

  try {
    const response = await fetch(url, {
      method: 'HEAD', redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });
    newResponseTime = Date.now() - startTime;
    newStatusCode = response.status;
    newStatus = (response.ok || (response.status >= 300 && response.status < 500)) ? 'UP' : 'DOWN';
  } catch (error) {
    newResponseTime = Date.now() - startTime;
    newStatus = error.name === 'TimeoutError' ? 'TIMEOUT' : 'ERROR';
  }

  const checkTime = Math.floor(Date.now() / 1000);
  const siteDisplayName = name || url;
  let newSiteLastNotifiedDownAt = siteLastNotifiedDownAt;

  if (['DOWN', 'TIMEOUT', 'ERROR'].includes(newStatus)) {
    const isFirst = !['DOWN', 'TIMEOUT', 'ERROR'].includes(previousStatus);
    if (isFirst) {
      ctx.waitUntil(sendNotification(db, '网站故障: ' + siteDisplayName + ' 状态 ' + newStatus + ' - ' + url));
      newSiteLastNotifiedDownAt = checkTime;
    } else {
      const shouldResend = siteLastNotifiedDownAt === null || (checkTime - siteLastNotifiedDownAt > NOTIFY_INTERVAL);
      if (shouldResend) {
        ctx.waitUntil(sendNotification(db, '网站持续故障: ' + siteDisplayName + ' 状态 ' + newStatus + ' - ' + url));
        newSiteLastNotifiedDownAt = checkTime;
      }
    }
  } else if (newStatus === 'UP' && ['DOWN', 'TIMEOUT', 'ERROR'].includes(previousStatus)) {
    ctx.waitUntil(sendNotification(db, '网站恢复: ' + siteDisplayName + ' 已恢复 - ' + url));
    newSiteLastNotifiedDownAt = null;
  }

  try {
    await db.batch([
      db.prepare('UPDATE monitored_sites SET last_checked = ?, last_status = ?, last_status_code = ?, last_response_time_ms = ?, last_notified_down_at = ? WHERE id = ?')
        .bind(checkTime, newStatus, newStatusCode, newResponseTime, newSiteLastNotifiedDownAt, id),
      db.prepare('INSERT INTO site_status_history (site_id, timestamp, status, status_code, response_time_ms) VALUES (?, ?, ?, ?, ?)')
        .bind(id, checkTime, newStatus, newStatusCode, newResponseTime)
    ]);
  } catch (dbError) { /* silent */ }
}

export async function checkAllSites(env, ctx) {
  try {
    const { results } = await env.DB.prepare('SELECT id, url, name FROM monitored_sites').all();
    if (!results?.length) return { checked: 0 };

    const limit = 5;
    const promises = [];
    for (const site of results) {
      promises.push(checkWebsiteAndNotify(site, env.DB, ctx));
      if (promises.length >= limit) { await Promise.all(promises); promises.length = 0; }
    }
    if (promises.length > 0) await Promise.all(promises);
    return { checked: results.length };
  } catch (error) {
    console.error('[SiteCheck] error: ' + error.message);
    return { checked: 0, error: error.message };
  }
}
