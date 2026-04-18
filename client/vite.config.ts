import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
