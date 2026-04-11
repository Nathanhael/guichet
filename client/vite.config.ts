import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Injects the git short SHA into sw.js at build time so the cache name
 * is automatically tied to the deployed version. In dev mode, falls back
 * to a timestamp so the SW always refreshes.
 */
function swBuildHashPlugin() {
  let hash: string;
  return {
    name: 'sw-build-hash',
    buildStart() {
      try {
        hash = execSync('git rev-parse --short HEAD').toString().trim();
      } catch {
        hash = Date.now().toString(36);
      }
    },
    writeBundle() {
      const swPath = resolve(__dirname, 'dist', 'sw.js');
      try {
        let content = readFileSync(swPath, 'utf-8');
        content = content.replace('__BUILD_HASH__', hash);
        writeFileSync(swPath, content, 'utf-8');
      } catch {
        // sw.js may not exist in test/preview builds — ignore
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), swBuildHashPlugin()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-is'],
  },
  optimizeDeps: {
    include: ['react-is', 'recharts'],
    exclude: ['@trpc/server'],
  },
  preview: {
    allowedHosts: true,
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['client', 'localhost', '127.0.0.1'],
    watch: {
      usePolling: true,
      interval: 500,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts') || id.includes('d3')) {
              return 'vendor-charts';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-ui-icons';
            }
            // Editor stack: Tiptap + ProseMirror + tiptap-markdown (which pulls
            // markdown-it). Loaded only via lazy ComposeArea.
            if (
              id.includes('@tiptap') ||
              id.includes('tiptap-markdown') ||
              id.includes('prosemirror') ||
              id.includes('markdown-it') ||
              id.includes('linkify-it') ||
              id.includes('mdurl') ||
              id.includes('uc.micro') ||
              id.includes('entities')
            ) {
              return 'vendor-editor';
            }
            // Markdown rendering for messages (used everywhere chat renders).
            if (id.includes('marked') || id.includes('dompurify')) {
              return 'vendor-markdown';
            }
            // tRPC + react-query data layer.
            if (id.includes('@trpc') || id.includes('@tanstack/react-query')) {
              return 'vendor-trpc';
            }
            // Socket.io transport.
            if (id.includes('socket.io-client') || id.includes('engine.io-client')) {
              return 'vendor-socket';
            }
            return 'vendor';
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
