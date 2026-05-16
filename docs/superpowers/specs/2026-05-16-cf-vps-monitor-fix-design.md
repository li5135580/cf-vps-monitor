# cf-vps-monitor 修复设计文档

## 日期: 2026-05-16

## 问题与修复方案

### 1. 数据不准确

**Shell 脚本修复 (cf-vps-monitor.sh):**

| 问题 | 修复 |
|------|------|
| CPU: `for i in {1..7}` 跳过了 index 0 | 改为 `for i in $(seq 1 7)` + 修正索引逻辑，直接从 cpu_line 按固定位置提取 |
| `validateAndFixVpsField` 中 `parseFloat(value) \|\| 0` 吞掉合法 0 | 改为 `typeof value === 'number' ? value : parseFloat(value) \|\| 0` |
| 磁盘只检查 `/` | 增加 `df -k` 汇总所有 ext4/xfs/btrfs 本地分区 |
| 内存 `free -k` 第7列 available 不兼容旧版 | 增加 fallback 逻辑：有第7列用第7列，否则用第4+第6列 |

**Worker 修复:**

| 问题 | 修复 |
|------|------|
| REPLACE INTO 高并发丢失数据 | 改为 `INSERT OR REPLACE` + 唯一索引 (server_id)，确保原子性 |
| CPU 数据 JSON 序列化存入DB | 统一使用 `JSON.stringify`，读取时 `JSON.parse` |
| 数值字段精度丢失 | 所有百分比保留1位小数，内存/磁盘保留整数KB |

### 2. Telegram Bot 推送修复

| 问题 | 修复 |
|------|------|
| `sendTelegramNotificationOptimized` 无响应检查 | 检查 `response.ok`，非200时 console.error 日志 |
| `checkVpsOfflineReminder` 仅在 Cron 执行 | 新增 `/api/cron/check-offline` 端点 + 前端定时调用（10分钟间隔）|
| 离线通知仅首次发送 | 保持此逻辑避免刷屏，增加1小时重复提醒间隔 |
| configCache 5分钟延迟 | Telegram token/chat_id 变化时立即 `clearKey('telegram_config')` |

### 3. 前端 UI 重构

**PC端新增卡片/网格视图:**
- 新增视图切换按钮组：表格视图 / 网格视图（小方块）
- 网格视图：每行3-4个卡片，每个卡片显示 VPS名称、状态、CPU/内存/磁盘 进度条、网络速度
- 状态颜色边框（在线绿色、离线红色、未知灰色）
- 点击卡片弹窗显示详细信息（CPU负载、历史图表等）
- 存储用户偏好到 localStorage

**移动端优化:**
- 卡片改为2列网格布局（充分利用宽度）
- 添加下拉刷新手势

**新增历史趋势小图:**
- 使用 Canvas 绘制 24h CPU/内存 迷你趋势线
- 从 D1 metrics 表查询最近24条记录

## 技术实现

### 构建系统
- esbuild 打包所有 `src/` 下的 JS 模块
- HTML/CSS 内联到 JS 字符串中
- 输出 `dist/worker.js` 单文件
