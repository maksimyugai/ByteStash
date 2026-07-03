import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';

// Parse allowed hosts from environment variable
const allowedHosts = process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(',').map(host => host.trim()).filter(Boolean)
  : undefined;

export default defineConfig({
  plugins: [
    react(),
    monacoEditorPlugin({ globalAPI: true }),
  ],
  server: {
    allowedHosts: allowedHosts,
    proxy: {
      // `wrangler dev` (worker/) listens on 8787
      '/api': {
        target: process.env.BACKEND_API_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
    port: 3000,
  },
  build: {
    outDir: 'build'
  }
});
