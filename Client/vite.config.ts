import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The version and source address come from the root package.json, the one
// place they are set, and are stamped into the bundle.
const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  homepage: string;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __MISE_VERSION__: JSON.stringify(root.version),
    __MISE_SOURCE__: JSON.stringify(root.homepage),
  },
  server: {
    port: 5173,
    // In development the API lives on the server's own port. In production the
    // server serves this bundle itself, so the same relative paths just work.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
