// auth.js - 认证与授权 JWT、密码、限流

import { getSecurityConfig } from './config.js';
import { getClientIP, verifyPassword, isTokenRevoked } from './utils.js';

// JWT验证缓存
const jwtCache = new Map();
const JWT_CACHE_TTL = 60000;
const MAX_CACHE_SIZE = 1000;

// 限流存储
const rateLimitStore = new Map();
const loginAttemptStore = new Map();

function cleanupJWTCache() {
  const now = Date.now();
  for (const [key, value] of jwtCache.entries()) {
    if (now - value.timestamp > JWT_CACHE_TTL) jwtCache.delete(key);
  }
  if (jwtCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(jwtCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, jwtCache.size - MAX_CACHE_SIZE);
    toDelete.forEach(([key]) => jwtCache.delete(key));
  }
}

export async function createJWT(payload, env) {
  const config = getSecurityConfig(env);
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Date.now();
  const jwtPayload = { ...payload, iat: now, exp: now + config.TOKEN_EXPIRY };

  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(jwtPayload));
  const data = encodedHeader + '.' + encodedPayload;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(config.JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return data + '.' + encodedSignature;
}

export async function verifyJWT(token, env) {
  try {
    if (isTokenRevoked(token)) return null;
    const config = getSecurityConfig(env);
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) return null;

    const data = encodedHeader + '.' + encodedPayload;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(config.JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signature = Uint8Array.from(atob(encodedSignature), c => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data));
    if (!isValid) return null;

    const payload = JSON.parse(atob(encodedPayload));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyJWTCached(token, env) {
  if (isTokenRevoked(token)) { jwtCache.delete(token); return null; }

  const cached = jwtCache.get(token);
  if (cached && Date.now() - cached.timestamp < JWT_CACHE_TTL) {
    if (cached.payload.exp && Date.now() > cached.payload.exp) {
      jwtCache.delete(token); return null;
    }
    if (isTokenRevoked(token)) { jwtCache.delete(token); return null; }
    return cached.payload;
  }

  const payload = await verifyJWT(token, env);
  if (payload && !isTokenRevoked(token)) {
    if (Math.random() < 0.01) cleanupJWTCache();
    jwtCache.set(token, { payload, timestamp: Date.now() });
  }
  return payload;
}

// 管理员认证
export async function authenticateAdmin(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  const payload = await verifyJWTCached(token, env);
  if (!payload?.role || payload.role !== 'admin') return null;
  return payload;
}

// 可选认证（不报错）
export async function authenticateRequestOptional(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);
  const payload = await verifyJWTCached(token, env);
  return payload?.role === 'admin' ? payload : null;
}

// 限流检查
export function checkRateLimit(clientIP, endpoint, env) {
  const config = getSecurityConfig(env);
  const key = `${clientIP}:${endpoint}`;
  const now = Date.now();
  const windowMs = 60 * 1000;

  let entry = rateLimitStore.get(key);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    rateLimitStore.set(key, entry);
  }

  entry.count++;
  if (entry.count > config.API_RATE_LIMIT) return false;

  // 定期清理
  if (Math.random() < 0.01) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (now - v.start > windowMs) rateLimitStore.delete(k);
    }
  }
  return true;
}

// 登录尝试检查
export function checkLoginAttempts(clientIP, env) {
  const config = getSecurityConfig(env);
  const now = Date.now();
  const entry = loginAttemptStore.get(clientIP);

  if (!entry || now - entry.start > config.LOGIN_ATTEMPT_WINDOW) {
    loginAttemptStore.set(clientIP, { start: now, count: 0 });
    return true;
  }

  return entry.count < config.MAX_LOGIN_ATTEMPTS;
}

export function recordLoginAttempt(clientIP) {
  const entry = loginAttemptStore.get(clientIP);
  if (entry) entry.count++;
}

// 服务器认证
export async function validateServerAuth(path, request, env) {
  const parts = path.split('/');
  let serverIdIndex = -1;

  if (path.startsWith('/api/config/')) serverIdIndex = 3;
  else if (path.startsWith('/api/report/')) serverIdIndex = 3;
  else if (path.startsWith('/api/status/')) serverIdIndex = 3;

  if (serverIdIndex < 0) {
    return { success: false, error: 'Invalid path', message: '无效的路径' };
  }

  const serverId = parts[serverIdIndex];
  if (!serverId || !/^[a-zA-Z0-9_-]{1,64}$/.test(serverId)) {
    return { success: false, error: 'Invalid server ID', message: '无效的服务器ID' };
  }

  const serverData = await env.DB.prepare(
    'SELECT id, name, description, api_key FROM servers WHERE id = ?'
  ).bind(serverId).first();

  if (!serverData) {
    return { success: false, error: 'Server not found', message: '服务器未注册' };
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { success: false, error: 'Missing API key', message: '缺少API密钥' };
  }

  const apiKey = authHeader.substring(7);
  if (apiKey !== serverData.api_key) {
    return { success: false, error: 'Invalid API key', message: 'API密钥无效' };
  }

  return { success: true, serverId, serverData };
}

// CORS头处理
export function getSecureCorsHeaders(origin, env) {
  const config = getSecurityConfig(env);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  if (origin) {
    if (config.ALLOWED_ORIGINS.length === 0 || config.ALLOWED_ORIGINS.includes('*') || config.ALLOWED_ORIGINS.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
    } else {
      headers['Access-Control-Allow-Origin'] = config.ALLOWED_ORIGINS[0];
    }
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }

  return headers;
}

// API认证中间件
export function requireAdmin(handler) {
  return async (request, env, ctx, ...args) => {
    const user = await authenticateAdmin(request, env);
    if (!user) {
      const { createErrorResponse } = await import('./utils.js');
      const corsHeaders = getSecureCorsHeaders(request.headers.get('Origin'), env);
      return createErrorResponse('Unauthorized', '需要管理员权限', 401, corsHeaders);
    }
    return handler(request, env, ctx, user, ...args);
  };
}
