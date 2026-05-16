// db.js - D1数据库 Schema、初始化、维护

import { hashPassword } from './utils.js';
import { getAdminConfig } from './config.js';

// D1 Schema定义
export const D1_SCHEMAS = {
  servers: `
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      api_key TEXT NOT NULL,
      is_public INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT NULL,
      last_notified_down_at INTEGER DEFAULT NULL,
      created_at INTEGER DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_servers_sort_order ON servers (sort_order, name);`,

  metrics: `
    CREATE TABLE IF NOT EXISTS metrics (
      server_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      cpu TEXT DEFAULT '{}',
      memory TEXT DEFAULT '{}',
      disk TEXT DEFAULT '{}',
      network TEXT DEFAULT '{}',
      uptime INTEGER DEFAULT 0,
      PRIMARY KEY (server_id, timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_server_timestamp ON metrics (server_id, timestamp DESC);`,

  monitored_sites: `
    CREATE TABLE IF NOT EXISTS monitored_sites (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      last_checked INTEGER DEFAULT NULL,
      last_status TEXT DEFAULT 'PENDING',
      last_status_code INTEGER DEFAULT NULL,
      last_response_time_ms INTEGER DEFAULT NULL,
      last_notified_down_at INTEGER DEFAULT NULL,
      is_public INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT NULL,
      created_at INTEGER DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitored_sites_sort_order ON monitored_sites (sort_order, name);`,

  site_status_history: `
    CREATE TABLE IF NOT EXISTS site_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      response_time_ms INTEGER,
      FOREIGN KEY(site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_site_status_history_site_id_timestamp ON site_status_history (site_id, timestamp DESC);`,

  telegram_config: `
    CREATE TABLE IF NOT EXISTS telegram_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bot_token TEXT,
      chat_id TEXT,
      enable_notifications INTEGER DEFAULT 0,
      updated_at INTEGER
    );
    INSERT OR IGNORE INTO telegram_config (id, bot_token, chat_id, enable_notifications, updated_at) VALUES (1, NULL, NULL, 0, NULL);`,

  app_config: `
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    INSERT OR IGNORE INTO app_config (key, value) VALUES ('vps_report_interval_seconds', '60');
    INSERT OR IGNORE INTO app_config (key, value) VALUES ('custom_background_enabled', 'false');
    INSERT OR IGNORE INTO app_config (key, value) VALUES ('custom_background_url', '');
    INSERT OR IGNORE INTO app_config (key, value) VALUES ('page_opacity', '80');`
};

// DDL修复记录表
export const SCHEMA_ALTERATIONS = [
  "ALTER TABLE monitored_sites ADD COLUMN last_notified_down_at INTEGER DEFAULT NULL",
  "ALTER TABLE servers ADD COLUMN last_notified_down_at INTEGER DEFAULT NULL",
  "ALTER TABLE metrics ADD COLUMN uptime INTEGER DEFAULT NULL",
  "ALTER TABLE admin_credentials ADD COLUMN password_hash TEXT",
  "ALTER TABLE admin_credentials ADD COLUMN created_at INTEGER",
  "ALTER TABLE admin_credentials ADD COLUMN last_login INTEGER",
  "ALTER TABLE admin_credentials ADD COLUMN failed_attempts INTEGER DEFAULT 0",
  "ALTER TABLE admin_credentials ADD COLUMN locked_until INTEGER DEFAULT NULL",
  "ALTER TABLE admin_credentials ADD COLUMN must_change_password INTEGER DEFAULT 0",
  "ALTER TABLE admin_credentials ADD COLUMN password_changed_at INTEGER DEFAULT NULL",
  "ALTER TABLE servers ADD COLUMN is_public INTEGER DEFAULT 1",
  "ALTER TABLE monitored_sites ADD COLUMN is_public INTEGER DEFAULT 1"
];

export async function ensureTablesExist(db, env) {
  try {
    const createTableStatements = Object.values(D1_SCHEMAS).map(sql => db.prepare(sql));
    await db.batch(createTableStatements);
  } catch (error) {
    // 静默处理
  }
  await createDefaultAdmin(db, env);
  await applySchemaAlterations(db);
}

export async function applySchemaAlterations(db) {
  for (const alterSql of SCHEMA_ALTERATIONS) {
    try {
      await db.exec(alterSql);
    } catch (e) {
      // 静默处理重复列错误
    }
  }
}

export async function createDefaultAdmin(db, env) {
  try {
    const adminConfig = getAdminConfig(env);
    const adminExists = await db.prepare(
      "SELECT username FROM admin_credentials WHERE username = ?"
    ).bind(adminConfig.USERNAME).first();

    if (!adminExists) {
      const adminPasswordHash = await hashPassword(adminConfig.PASSWORD);
      const now = Math.floor(Date.now() / 1000);

      await db.prepare(`
        INSERT INTO admin_credentials (username, password_hash, created_at, failed_attempts, must_change_password)
        VALUES (?, ?, ?, 0, 0)
      `).bind(adminConfig.USERNAME, adminPasswordHash, now).run();
    }
  } catch (error) {
    if (!error.message.includes('no such table')) {
      throw error;
    }
  }
}

export async function isUsingDefaultPassword(username, password, env) {
  const adminConfig = getAdminConfig(env);
  return username === adminConfig.USERNAME && password === adminConfig.PASSWORD;
}

// 批量写入VPS数据
export async function flushVpsBatchData(vpsBatchProcessor, env) {
  const batchData = vpsBatchProcessor.getBatchData();
  if (batchData.length === 0) return;

  try {
    const statements = batchData.map(report =>
      env.DB.prepare(`
        INSERT OR REPLACE INTO metrics (server_id, timestamp, cpu, memory, disk, network, uptime)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        report.serverId, report.timestamp, report.cpu, report.memory,
        report.disk, report.network, report.uptime
      )
    );

    await env.DB.batch(statements);
    console.log(`批量写入${batchData.length}条VPS数据`);
  } catch (error) {
    console.error('批量写入VPS数据失败:', error);
    vpsBatchProcessor.batchBuffer.unshift(...batchData);
    throw error;
  }
}

// 定时刷新VPS批量数据
export async function scheduleVpsBatchFlush(vpsBatchProcessor, env, ctx) {
  try {
    const { getVpsReportInterval } = await import('./utils.js');
    const batchInterval = await getVpsReportInterval(env);
    if (vpsBatchProcessor.shouldFlush(batchInterval)) {
      ctx.waitUntil(flushVpsBatchData(vpsBatchProcessor, env));
    }
  } catch (error) {
    if (vpsBatchProcessor.shouldFlush(60)) {
      ctx.waitUntil(flushVpsBatchData(vpsBatchProcessor, env));
    }
  }
}

// 数据库维护 - 清理历史数据
export async function performDatabaseMaintenance(db) {
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

  try {
    await db.prepare('DELETE FROM site_status_history WHERE timestamp < ?').bind(thirtyDaysAgo).run();
    await db.prepare('DELETE FROM metrics WHERE timestamp < ?').bind(thirtyDaysAgo * 2).run();
  } catch (error) {
    // 静默处理
  }
}
