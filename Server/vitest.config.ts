import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Argon2 hashing makes these slower than a unit test; give them room.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each file spins up its own in-process Postgres, so keep them apart.
    fileParallelism: false,
  },
});
