import http from 'node:http';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

export default defineConfig(({ mode, command }) => {
  // 诊断代理仅供开发进程读取，不使用 VITE_ 前缀，避免把宿主地址打入浏览器产物。
  const apiTarget = loadEnv(mode, process.cwd(), 'CRM_DEV_').CRM_DEV_API_TARGET;
  if (command === 'serve' && !apiTarget) {
    throw new Error('诊断代理目标未配置：请在 .env.local 中设置 CRM_DEV_API_TARGET');
  }
  return {
    base: '/app/crm/',
    plugins: [vue(), qiankun('crm', { useDevMode: true })],
    server: {
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      proxy: apiTarget ? {
        // 禁用 keep-alive：后端/nginx 重启后 proxy 不复用死连接（否则窗口期全 502）。
        '/api': { target: apiTarget, agent: new http.Agent({ keepAlive: false }) }
      } : undefined
    }
  };
});
