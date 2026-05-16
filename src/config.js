// config.js - 配置常量与缓存系统

// 管理员账户配置
export function getAdminConfig(env) {
  return {
    USERNAME: env.USERNAME || 'admin',
    PASSWORD: env.PASSWORD || 'monitor2025!',
  };
}

// 安全配置
export function getSecurityConfig(env) {
  if (!env.JWT_SECRET || env.JWT_SECRET === 'default-jwt-secret-please-set-in-worker-variables') {
    throw new Error('JWT_SECRET must be set in environment variables for security');
  }

  return {
    JWT_SECRET: env.JWT_SECRET,
    TOKEN_EXPIRY: 2 * 60 * 60 * 1000,
    MAX_LOGIN_ATTEMPTS: 5,
    LOGIN_ATTEMPT_WINDOW: 15 * 60 * 1000,
    API_RATE_LIMIT: 60,
    MIN_PASSWORD_LENGTH: 8,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [],
  };
}

// VPS数据默认值
export const VPS_DATA_DEFAULTS = {
  cpu: { usage_percent: 0, load_avg: [0, 0, 0] },
  memory: { total: 0, used: 0, free: 0, usage_percent: 0 },
  disk: { total: 0, used: 0, free: 0, usage_percent: 0 },
  network: { upload_speed: 0, download_speed: 0, total_upload: 0, total_download: 0 },
  uptime: 0
};

// 配置缓存系统
export class ConfigCache {
  constructor() {
    this.cache = new Map();
    this.CACHE_TTL = {
      TELEGRAM: 5 * 60 * 1000,
      MONITORING: 5 * 60 * 1000,
      SERVERS: 2 * 60 * 1000
    };
  }

  set(key, value, ttl) {
    this.cache.set(key, { value, timestamp: Date.now(), ttl });
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  clearKey(key) {
    this.cache.delete(key);
  }

  async getTelegramConfig(db) {
    const cached = this.get('telegram_config');
    if (cached) return cached;

    const config = await db.prepare(
      'SELECT bot_token, chat_id, enable_notifications FROM telegram_config WHERE id = 1'
    ).first();

    if (config) {
      this.set('telegram_config', config, this.CACHE_TTL.TELEGRAM);
    }
    return config;
  }

  async getMonitoringSettings(db) {
    const cached = this.get('monitoring_settings');
    if (cached) return cached;

    const settings = await db.prepare(
      'SELECT * FROM app_config WHERE key IN ("vps_report_interval", "site_check_interval")'
    ).all();

    if (settings?.results) {
      this.set('monitoring_settings', settings.results, this.CACHE_TTL.MONITORING);
      return settings.results;
    }
    return [];
  }

  async getServerList(db, isAdmin = false) {
    const cacheKey = isAdmin ? 'servers_admin' : 'servers_public';
    const cached = this.get(cacheKey);
    if (cached) return cached;

    let query = 'SELECT id, name, description FROM servers';
    if (!isAdmin) {
      query += ' WHERE is_public = 1';
    }
    query += ' ORDER BY sort_order ASC NULLS LAST, name ASC';

    const { results } = await db.prepare(query).all();
    this.set(cacheKey, results || [], this.CACHE_TTL.SERVERS);
    return results || [];
  }
}

// 全局配置缓存实例
export const configCache = new ConfigCache();
