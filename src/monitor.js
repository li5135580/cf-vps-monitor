// monitor.js - Cron定时任务调度器

import { ensureTablesExist, performDatabaseMaintenance } from './db.js';
import { checkVpsOfflineReminder, checkAllSites } from './notify.js';

let dbInitialized = false;
let taskCounter = 0;

export async function scheduledEventHandler(event, env, ctx) {
  taskCounter++;

  try {
    // 智能数据库初始化
    if (!dbInitialized || taskCounter % 10 === 1) {
      await ensureTablesExist(env.DB, env);
      dbInitialized = true;
    }

    // 网站监控
    await checkAllSites(env, ctx);

    // VPS离线提醒检查
    await checkVpsOfflineReminder(env, ctx);

    // 每日数据库维护
    if (taskCounter % 1440 === 0) {
      await performDatabaseMaintenance(env.DB);
    }

  } catch (error) {
    console.error('[Cron] 定时任务执行错误:', error.message);
  }
}

export { dbInitialized };
export function setDbInitialized(val) { dbInitialized = val; }
