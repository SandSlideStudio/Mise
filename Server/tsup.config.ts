import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The workspace packages are source-only, so they get bundled in. Everything
  // in node_modules stays external and is installed in the runtime image.
  noExternal: [/^@mise\//],
  splitting: false,
  // The version comes from the root package.json, the one place it is set.
  define: { __MISE_VERSION__: JSON.stringify(version) },
});
