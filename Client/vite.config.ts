import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
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

/**
 * A gzip and a brotli copy next to every text file of the build. The server
 * hands a tablet the smaller one it understands, without compressing anything
 * itself on every request (which a Raspberry Pi would feel).
 */
function precompress(): Plugin {
  const TEXT = /\.(js|css|html|svg|json|webmanifest|txt)$/;
  let outDir = 'dist';
  return {
    name: 'mise-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
        );
      for (const file of walk(outDir).filter((name) => TEXT.test(name))) {
        const content = readFileSync(file);
        if (content.length < 1024) continue;
        writeFileSync(`${file}.gz`, gzipSync(content, { level: 9 }));
        writeFileSync(
          `${file}.br`,
          brotliCompressSync(content, {
            params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
          }),
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker(), precompress()],
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
    // Source maps would be most of what a tablet downloads, for no one there.
    sourcemap: false,
  },
});
