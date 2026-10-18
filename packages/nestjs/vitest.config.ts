import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite()],
  resolve: {
    // Run against core's SOURCE so `npm test` needs no prior build and edits
    // in packages/core are picked up immediately. The build resolves the
    // workspace symlink to packages/core/dist instead (see tsconfig.build.json).
    alias: { '@remote-repl/core': resolve(__dirname, '../core/src/index.ts') },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['reflect-metadata'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});
