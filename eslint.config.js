// Flat config (ESLint 9). ESM, Node >= 18 — matches package.json "type":"module".
// Scope note: we lint the code WE own (src, tests, tools, bench). We deliberately
// do NOT lint:
//   - templates/**      rendered code with placeholders (__ANY_TYPE__ etc.); not
//                       real modules, must stay byte-stable (hard rule #6).
//   - tests/fixtures/** byte-sensitive: route fingerprints hash this source and
//                       `remove` asserts a byte-for-byte clean diff (hard rule #4).
//   - **/.tmp/**        generated hosts/routers (gitignored).
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '**/.tmp/**',
      'templates/**',
      'tests/fixtures/**',
      'tests/e2e/**',
      '**/*.bak',
      'bench/results.json',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Allow intentional throwaways (_unused, _req) and keep catch-bindings:
      // SPARDA convention is `catch (err)` even when only logged conditionally.
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Best-effort cleanup paths (shims, probes) use `catch {}` deliberately —
      // a swallowed failure there must never crash the host. Empty *catch* is
      // allowed; any other empty block (if/for/fn) still errors.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // CJS islands (e.g. tests/router-selftest.cjs runs outside the ESM graph).
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  // eslint-config-prettier must stay LAST: it switches off every stylistic rule
  // that would fight Prettier, so formatting is owned by Prettier alone.
  prettier,
];
