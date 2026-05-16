// build.js - 构建脚本：读取前端文件内联到 routes，esbuild 打包输出 dist/worker.js

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, 'src');

// 读取前端源文件
const styleCss = readFileSync(resolve(SRC, 'frontend', 'style.css'), 'utf8');
const mainJsSrc = readFileSync(resolve(SRC, 'frontend', 'main.js'), 'utf8');
const loginJsSrc = readFileSync(resolve(SRC, 'frontend', 'login.js'), 'utf8');
const adminJsSrc = readFileSync(resolve(SRC, 'frontend', 'admin.js'), 'utf8');

// 生成 routes.generated.js，将所有前端资源内联为字符串常量
// 读取原始 routes.js 并替换占位符
let routesSrc = readFileSync(resolve(SRC, 'frontend', 'routes.js'), 'utf8');

// 替换 getStyleCss 函数体
routesSrc = routesSrc.replace(
  /function getStyleCss\(\)\s*\{[\s\S]*?return styleCss;\s*\}/,
  `function getStyleCss() { if (styleCss) return styleCss; styleCss = \`${styleCss.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`; return styleCss; }`
);

// 替换 getMainJs — 返回内联的 main.js
routesSrc = routesSrc.replace(
  /function getMainJs\(\)\s*\{[^}]*\}/,
  `function getMainJs() { if (mainJs) return mainJs; mainJs = \`${mainJsSrc.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`; return mainJs; }`
);

// 替换 getLoginJs
routesSrc = routesSrc.replace(
  /function getLoginJs\(\)\s*\{[^}]*\}/,
  `function getLoginJs() { if (loginJs) return loginJs; loginJs = \`${loginJsSrc.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`; return loginJs; }`
);

// 替换 getAdminJs
routesSrc = routesSrc.replace(
  /function getAdminJs\(\)\s*\{[^}]*\}/,
  `function getAdminJs() { if (adminJs) return adminJs; adminJs = \`${adminJsSrc.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`; return adminJs; }`
);

writeFileSync(resolve(SRC, 'frontend', 'routes.generated.js'), routesSrc);

// esbuild 打包
mkdirSync(resolve(__dirname, 'dist'), { recursive: true });

await esbuild.build({
  entryPoints: [resolve(SRC, 'worker.js')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: resolve(__dirname, 'dist', 'worker.js'),
  minify: false,
  platform: 'browser',
  banner: { js: '// cf-vps-monitor v2.0 - Built ' + new Date().toISOString() },
  alias: {}
});

console.log('✅ dist/worker.js built successfully');
