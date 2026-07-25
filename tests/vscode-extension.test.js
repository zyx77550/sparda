// vscode-extension.test.js — the pure logic of the SPARDA VS Code extension (lib.cjs), tested
// without the editor host. The risky part is turning CLI JSON into diagnostics: extracting a
// file:line from an apocalypse evidence token, mapping severity, and NEVER dropping a finding.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { verdictSummary, locOfEvidence, findingsToDiagnostics } = require(
  path.join(here, '..', 'integrations', 'vscode', 'lib.cjs'),
);

describe('SPARDA VS Code extension — pure helpers', () => {
  it('verdictSummary renders coverage as a percentage', () => {
    const s = verdictSummary({ verdict: 'PARTIAL', routes: 12, coverage: 0.78 });
    expect(s.verdict).toBe('PARTIAL');
    expect(s.detail).toBe('PARTIAL · 12 routes · coverage 78%');
  });

  it('locOfEvidence prefers the trailing (file:line)', () => {
    expect(locOfEvidence('effect:db_read:src/app.js:24:0 (src/app.js:24)')).toEqual({
      file: 'src/app.js',
      line: 24,
    });
  });

  it('locOfEvidence falls back to a bare path:line, and abstains when nothing is locatable', () => {
    expect(locOfEvidence('some effect at src/x.ts:9 inside')).toEqual({
      file: 'src/x.ts',
      line: 9,
    });
    expect(locOfEvidence('no location here')).toBeNull();
  });

  it('findingsToDiagnostics maps severity and extracts the location', () => {
    const apoc = {
      findings: [
        {
          rule: 'UNGUARDED_MUTATION',
          severity: 'critical',
          message: 'unguarded write',
          evidence: ['effect:db_write:src/app.js:42:0 (src/app.js:42)'],
        },
      ],
    };
    expect(findingsToDiagnostics(apoc)).toEqual([
      {
        file: 'src/app.js',
        line: 42,
        severity: 'error',
        rule: 'UNGUARDED_MUTATION',
        message: 'unguarded write',
      },
    ]);
  });

  it('never drops a finding with no locatable evidence (file=null, line=1)', () => {
    const d = findingsToDiagnostics({
      findings: [{ rule: 'X', severity: 'info', message: 'no loc', evidence: [] }],
    });
    expect(d).toHaveLength(1);
    expect(d[0].file).toBeNull();
    expect(d[0].line).toBe(1);
    expect(d[0].severity).toBe('information');
  });
});
