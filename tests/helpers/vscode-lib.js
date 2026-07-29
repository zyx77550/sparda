// The VS Code extension's pure helpers, re-exported for ESM tests. `lib.cjs` is CommonJS
// because the extension host loads it that way; this is the one-line bridge so the ordinary
// suite can assert on it without every test file repeating `createRequire`.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const {
  resolveCli,
  parseJson,
  presentationOf,
  verdictSummary,
  locOfEvidence,
  findingsToDiagnostics,
  isCliMissing,
  installCommandFor,
  quickPickFor,
  codeActionsFor,
  PRESENTATION,
  ENFORCEABLE,
} = createRequire(import.meta.url)(
  path.join(here, '..', '..', 'extensions', 'vscode', 'src', 'lib.cjs'),
);
