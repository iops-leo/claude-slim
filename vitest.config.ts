import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Strips the developer's profile env and puts a stub `claude` first on
    // PATH, so no test reads a real profile or runs the real CLI.
    setupFiles: ['src/__tests__/helpers/hermetic-env.ts'],
  },
});
