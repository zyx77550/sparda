import { defineConfig, configDefaults } from 'vitest/config';

// Coverage-only config. Test discovery stays on Vitest defaults (it already finds
// the co-located *.test.js files), so `npm test` behaves exactly as before —
// instrumentation activates only under `--coverage` (`npm run coverage`).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tools/corpus/**', '_public_sync/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      // Measure the shipped product only; tests/tools/bench are the harness.
      include: ['src/**/*.{js,cjs,mjs}'],
      // No thresholds yet — reporting first, gate later.
    },
  },
});
