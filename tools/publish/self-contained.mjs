// tools/publish/self-contained.mjs — the valve's "no dangling runtime import" rule.
//
// The secret-gate proves nothing PRIVATE leaks OUT. This proves nothing REQUIRED
// is left BEHIND: the under-send failure mode (a runtime file the published code
// imports never makes it across HQ→public). That is exactly how `apocalypse`/`heal`
// shipped broken once — `src/ubg/apocalypse.js` was imported but absent from the
// public mirror, invisible to a secret-gate that only guards over-send.
//
// The rule: every RELATIVE import from a published `src/**` JS module must resolve
// to a file that is ALSO in the published set. External specifiers (bare package
// names) are the host's concern via package.json, not ours. AST-based on purpose —
// a comment like `// export { GET } from './impl'` must not count as an import
// (SPARDA is an AST tool; it does not grep for imports).

import path from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default ?? traverseModule;

// Extensions we treat as JS modules whose import graph must stay whole.
const JS_MODULE = /\.(js|mjs|cjs)$/;
// Candidate resolutions for a specifier, in Node's relative-resolution order.
const CANDIDATE_SUFFIXES = ['', '.js', '.mjs', '.cjs', '.json', '/index.js'];

// Every relative specifier a module actually depends on at load time: static
// `import`, re-`export ... from`, dynamic `import()`, and `require()`. Bare
// specifiers (packages, node: builtins) are filtered out — they are not ours to
// ship. Returns [] for a file that does not parse as a module (never throws:
// an unparseable published file is a different problem, not this gate's job).
export function collectRelativeImports(code) {
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      plugins: ['typescript', 'jsx'],
    });
  } catch {
    return [];
  }
  const specs = new Set();
  const add = (v) => {
    if (typeof v === 'string' && v.startsWith('.')) specs.add(v);
  };
  traverse(ast, {
    ImportDeclaration: (p) => add(p.node.source?.value),
    ExportNamedDeclaration: (p) => add(p.node.source?.value),
    ExportAllDeclaration: (p) => add(p.node.source?.value),
    ImportExpression: (p) => add(p.node.source?.value),
    CallExpression: (p) => {
      const callee = p.node.callee;
      const isImport = callee.type === 'Import';
      const isRequire = callee.type === 'Identifier' && callee.name === 'require';
      const arg = p.node.arguments[0];
      if ((isImport || isRequire) && arg?.type === 'StringLiteral') add(arg.value);
    },
  });
  return [...specs];
}

// Resolve `spec` relative to `fromFile` (both repo-relative, posix) against the
// set of published paths. Returns the resolved published path, or null if the
// import points outside the published surface. Mirrors Node's tolerance for a
// missing extension and a directory `index.js`.
export function resolveWithinSet(fromFile, spec, fileSet) {
  const base = path.posix.join(path.posix.dirname(fromFile), spec);
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = path.posix.normalize(base + suffix);
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

// Gate over the published set. `files` is the exact list the valve would push;
// `readFile(f)` returns its text. Only `src/**` JS modules are inspected — the
// runtime graph the host executes. Returns a list of dangling imports; empty
// means the published set is closed under its own relative imports.
export function checkSelfContained(files, readFile) {
  const fileSet = new Set(files);
  const violations = [];
  for (const f of files) {
    if (!f.startsWith('src/') || !JS_MODULE.test(f)) continue;
    const specs = collectRelativeImports(readFile(f));
    for (const spec of specs) {
      if (!resolveWithinSet(f, spec, fileSet)) {
        violations.push({ file: f, specifier: spec });
      }
    }
  }
  return violations;
}
