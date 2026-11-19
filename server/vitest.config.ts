import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test makes a real database on disk, and a disk that is busy (in Docker, just after packages were
    // installed) can take seconds over each save.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
