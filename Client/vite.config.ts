import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The version and source address come from the root package.json, the one
// place they are set, and are stamped into the bundle.
const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  homepage: string;
};

/**
 * Writes sw.js with every file of this build, so the service worker can keep
 * the whole app for opening offline. Its cache is named after those files:
 * built names carry a hash of their content, so a new build gets a new cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'mise-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((file) => !file.endsWith('.map'));
      const fromPublic = readdirSync(new URL('./public', import.meta.url));
      const files = [...new Set([...built, ...fromPublic])].sort();
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const template = readFileSync(new URL('./sw/service-worker.js', import.meta.url), 'utf8');
      const source = template
        .replaceAll("'__VERSION__'", JSON.stringify(version))
        .replaceAll("'__FILES__'", JSON.stringify(JSON.stringify(files)));
      // A placeholder left in would stop the worker from ever starting.
      if (source.includes('__VERSION__') || source.includes('__FILES__')) {
        this.error('sw.js still has a placeholder in it');
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
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
