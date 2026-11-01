import { readFileSync } from 'node:fs';
import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The same stamps the build puts in, so code that reads them runs unchanged.
const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  homepage: string;
};

export default defineProject({
  plugins: [react()],
  define: {
    __MISE_VERSION__: JSON.stringify(root.version),
    __MISE_SOURCE__: JSON.stringify(root.homepage),
  },
  test: {
    name: '@mise/client',
    // Layout and PDF tests need no page; the few that render say so themselves.
    environment: 'node',
  },
});
