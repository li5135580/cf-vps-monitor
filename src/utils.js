// utils.js - 工具函数

// VPS数据验证与修复
import { VPS_DATA_DEFAULTS } from './config.js';

export function validateSqlIdentifier(value, type) {
  if (!value || typeof value !== 'string') return false;
  if (value.length > 255) return false;
  const tablePatterns = {
    table: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    column: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
  };
  return tablePatterns[type]?.test(value) ?? false;
}

export function maskSensitive(value, type = 'key') {
  if (!value || value.length < 8) return '***';
  if (type === 'password') return '******';
  return value.substring(0, 4) + '***' + value.substring(value.length - 4);
}

// Token撤销列表（内存存储）
const revokedTokens = new Set();
const MAX_REVOKED_TOKENS = 10000;

export function revokeToken(token) {
  if (token) {
    revokedTokens.add(token.substring(0, 32));
    if (revokedTokens.size > MAX_REVOKED_TOKENS) {
      const entries = [...revokedTokens];
      entries.slice(0, entries.length - MAX_REVOKED_TOKENS).forEach(e => revokedTokens.delete(e));
    }
  }
}

export function isTokenRevoked(token) {
  return token ? revokedTokens.has(token.substring(0, 32)) : false;
}

export async function parseJsonSafely(request, maxSize = 1024 * 1024) {
  const body = await request.text();
  if (body.length > maxSize) {
    throw new Error('Request body too large');
  }
  return JSON.parse(body);
}

export function extractPathSegment(path, index) {
  const parts = path.split('/').filter(Boolean);
  return parts[index] || '';
}

export function extractAndValidateServerId(path) {
  const parts = path.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const segment = parts[i];
    if (segment && /^[a-zA-Z0-9_-]{1,64}$/.test(segment)) {
      return segment;
    }
  }
  return null;
}

export function validateInput(input, type, maxLength = 255) {
  if (!input || typeof input !== 'string') return false;
  if (input.length > maxLength) return false;

  const patterns = {
    serverName: /^[\w\s\-.一-鿿()（）]+$/,
    url: /^https?:\/\/.+/,
    description: /^[\w\s\-.,!?()（）一-鿿]*$/,
    token: /^[a-zA-Z0-9\-_]+$/,
    serverId: /^[a-zA-Z0-9\-_]+$/,
    siteId: /^[a-zA-Z0-9\-_]+$/,
    username: /^[a-zA-Z0-9_\-@.]+$/
  };

  return patterns[type]?.test(input) ?? true;
}

// VPS数据字段验证与修复 - 修复 parseFloat 吞0的bug
export function validateAndFixVpsField(data, field) {
  if (!data || typeof data !== 'object') return { ...VPS_DATA_DEFAULTS[field] };

  const converted = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number') {
      converted[key] = value;
    } else if (typeof value === 'string') {
      const parsed = parseFloat(value);
      converted[key] = isNaN(parsed) ? 0 : parsed;
    } else {
      converted[key] = 0;
    }
  }
  return converted;
}

export function validateAndFixVpsData(reportData) {
  const requiredFields = ['timestamp', 'cpu', 'memory', 'disk', 'network', 'uptime'];

  for (const field of requiredFields) {
    if (!reportData[field]) {
      return { error: 'Invalid data format', message: `缺少字段: ${field}` };
    }
  }

  ['cpu', 'memory', 'disk', 'network'].forEach(field => {
    reportData[field] = validateAndFixVpsField(reportData[field], field);
  });

  reportData.timestamp = parseInt(reportData.timestamp) || Math.floor(Date.now() / 1000);
  reportData.uptime = parseInt(reportData.uptime) || 0;

  return { success: true, data: reportData };
}

// API响应工具
export function createApiResponse(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

export function createErrorResponse(error, message, status = 500, corsHeaders = {}, details = null) {
  return new Response(JSON.stringify({ success: false, error, message, details }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

export function createSuccessResponse(data, corsHeaders = {}) {
  return new Response(JSON.stringify({ success: true, ...data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

export function handleDbError(error, corsHeaders, operation = 'database operation') {
  console.error(`Database error during ${operation}:`, error.message);
  return createErrorResponse(
    'Database error',
    `${operation}失败，请稍后重试`,
    500,
    corsHeaders
  );
}

// VPS上报间隔获取
export async function getVpsReportInterval(env) {
  try {
    const result = await env.DB.prepare(
      "SELECT value FROM app_config WHERE key = 'vps_report_interval_seconds'"
    ).first();
    if (result?.value) {
      const parsed = parseInt(result.value);
      if (parsed > 0 && parsed <= 3600) return parsed;
    }
  } catch (e) {
    // 使用默认值
  }
  return 60;
}

let vpsIntervalCacheValue = null;
let vpsIntervalCacheTime = 0;

export function clearVpsIntervalCache() {
  vpsIntervalCacheValue = null;
  vpsIntervalCacheTime = 0;
}

// VPS批量处理器
export class VpsBatchProcessor {
  constructor() {
    this.batchBuffer = [];
    this.lastBatch = Math.floor(Date.now() / 1000);
    this.maxBatchSize = 100;
  }

  addReport(serverId, reportData, batchInterval) {
    this.batchBuffer.push({
      serverId,
      timestamp: reportData.timestamp,
      cpu: JSON.stringify(reportData.cpu),
      memory: JSON.stringify(reportData.memory),
      disk: JSON.stringify(reportData.disk),
      network: JSON.stringify(reportData.network),
      uptime: reportData.uptime
    });

    const now = Math.floor(Date.now() / 1000);
    if (now - this.lastBatch >= batchInterval || this.batchBuffer.length >= this.maxBatchSize) {
      return true;
    }
    return false;
  }

  getBatchData() {
    const data = [...this.batchBuffer];
    this.batchBuffer = [];
    this.lastBatch = Math.floor(Date.now() / 1000);
    return data;
  }

  shouldFlush(batchInterval) {
    const now = Math.floor(Date.now() / 1000);
    return this.batchBuffer.length > 0 && (now - this.lastBatch >= batchInterval);
  }
}

// HTTP URL验证
export function isValidHttpUrl(string) {
  try {
    const url = new URL(string);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

// 获取客户端IP
export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         request.headers.get('X-Real-IP') ||
         'unknown';
}

// 密码哈希
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

  const encoder = new TextEncoder();
  let hash = encoder.encode(password + saltHex);

  for (let i = 0; i < 1000; i++) {
    hash = new Uint8Array(await crypto.subtle.digest('SHA-256', hash));
  }

  const hashHex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}$${hashHex}`;
}

export async function verifyPassword(password, hashedPassword) {
  if (hashedPassword.includes('$')) {
    const [saltHex, expectedHash] = hashedPassword.split('$');
    const encoder = new TextEncoder();
    let hash = encoder.encode(password + saltHex);
    for (let i = 0; i < 1000; i++) {
      hash = new Uint8Array(await crypto.subtle.digest('SHA-256', hash));
    }
    const computedHash = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
    return computedHash === expectedHash;
  } else {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return computedHash === hashedPassword;
  }
}
