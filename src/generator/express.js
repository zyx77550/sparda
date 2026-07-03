// generator/express.js — router generation + marked injection (spec: blueprint 04-GENERATION §A)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { toolNameFor } from '../parser/express.js';
import { carryOverManifest, defaultSpardingMemory } from './manifest.js';
import { atomicWriteFileSync as atomicWrite } from '../server/persistence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARK_START = '// >>> sparda-injection (do not edit this block) >>>';
const MARK_END = '// <<< sparda-injection <<<';

export function generateExpress({ cwd, entryFile, moduleType, port, routes }) {
  const taken = new Set([
    'sparda_info',
    'sparda_list_disabled_tools',
    'sparda_get_context',
  ]);
  const tools = {};
  for (const r of routes) {
    const name = toolNameFor(r, taken);
    tools[name] = {
      method: r.method.toUpperCase(),
      path: r.path,
      enabled: !r.mutating, // write-safety: mutating tools off by default
      pathParams: r.params.filter((p) => p.in === 'path').map((p) => p.name),
      description: r.description,
      params: r.params,
      confidence: r.confidence,
    };
  }
  const prev = carryOverManifest(cwd, tools);

  // --- sparding safety memory & fingerprints
  const sparding = defaultSpardingMemory(prev);
  const oldFingerprints = sparding.toolFingerprints ?? {};
  const newFingerprints = {};
  for (const [name, t] of Object.entries(tools)) {
    const raw = `${t.method}|${t.path}|${JSON.stringify(t.params)}`;
    const fp = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
    newFingerprints[name] = fp;
    const oldFp = oldFingerprints[name];
    if (oldFp && oldFp !== fp) {
      sparding.events.push({
        ts: new Date().toISOString(),
        tool: name,
        decision: 'audit',
        risk: 'medium',
        reasons: [
          `route structure modified (fingerprint changed from ${oldFp} to ${fp})`,
        ],
      });
      if (sparding.events.length > 100) sparding.events.shift();
    }
  }
  sparding.toolFingerprints = newFingerprints;

  // stable across re-runs so a running bridge/host pair never desyncs
  const localKey = prev?.localKey ?? crypto.randomUUID();
  const entryAbs = path.resolve(cwd, entryFile);
  const entryDir = path.dirname(entryAbs);
  const ext = entryFile.endsWith('.ts')
    ? '.ts'
    : entryFile.endsWith('.mjs')
      ? '.mjs'
      : entryFile.endsWith('.cjs')
        ? '.cjs'
        : '.js';
  const routerFileName = `sparda-router${ext}`;
  const routerAbs = path.join(entryDir, routerFileName);

  // --- render router from template
  let tpl = fs.readFileSync(
    path.join(__dirname, '..', '..', 'templates', 'express-router.txt'),
    'utf8',
  );
  const isESM = moduleType === 'esm';
  const isTS = ext === '.ts';

  let importLine = '';
  let reqType = '';
  let resType = '';
  let nextType = '';

  if (isTS) {
    reqType = ': Request';
    resType = ': Response';
    nextType = ': NextFunction';
    if (isESM) {
      importLine = "import express, { Request, Response, NextFunction } from 'express';";
    } else {
      importLine =
        "import type { Request, Response, NextFunction } from 'express';\nconst express = require('express');";
    }
  } else {
    importLine = isESM
      ? "import express from 'express';"
      : "const express = require('express');";
  }

  tpl = tpl
    .replace('__IMPORT_LINE__', importLine)
    .replace('__SPARDING_POLICIES__', JSON.stringify(sparding.policies ?? {}))
    .replace(
      '__ROUTER_DECL__',
      isESM
        ? 'export const spardaRouter = express.Router();'
        : 'const spardaRouter = express.Router();\nmodule.exports = { spardaRouter };',
    )
    .replace('__JSON_MW__', "express.json({ limit: '64kb' })")
    .replace('__TOOLS_JSON__', JSON.stringify(tools, null, 2))
    .replace('__LOCAL_KEY__', localKey)
    .replace('__PORT__', String(port))
    .replace(/__REQ_TYPE__/g, reqType)
    .replace(/__RES_TYPE__/g, resType)
    .replace(/__NEXT_TYPE__/g, nextType)
    .replace(/__STATS_TYPE__/g, isTS ? ': Record<string, any>' : '')
    .replace(/__EVENTS_TYPE__/g, isTS ? ': any[]' : '')
    .replace(/__ANY_TYPE__/g, isTS ? ': any' : '');
  atomicWrite(routerAbs, tpl);

  // --- inject into entry file (line-based via AST positions)
  const injection = injectIntoEntry({ entryAbs, moduleType, routerFileName, cwd });

  // record what init did to .gitignore so `remove` can revert it exactly (hard rule #4, E-010)
  const gitignore = ensureGitignore(cwd) ?? prev?.gitignore ?? null;

  // --- manifest
  const manifest = {
    version: 1,
    framework: 'express',
    entryFile,
    moduleType,
    port,
    localKey,
    generatedFiles: [path.relative(cwd, routerAbs).split(path.sep).join('/')],
    injectedFiles: injection.injected ? [entryFile] : [],
    createdAt: new Date().toISOString(),
    tools: Object.fromEntries(
      Object.entries(tools).map(([k, v]) => [
        k,
        { method: v.method, path: v.path, enabled: v.enabled },
      ]),
    ),
    ...(gitignore ? { gitignore } : {}),
    ...(prev?.semantic ? { semantic: prev.semantic } : {}),
    ...(prev?.immune ? { immune: prev.immune } : {}),
    ...(prev?.labs ? { labs: prev.labs } : {}),
    sparding,
  };
  atomicWrite(path.join(cwd, 'sparda.json'), JSON.stringify(manifest, null, 2) + '\n');

  return {
    tools,
    manifest,
    routerFile: path.relative(cwd, routerAbs).split(path.sep).join('/'),
    injection,
  };
}

function injectIntoEntry({ entryAbs, moduleType, routerFileName, cwd }) {
  const src = fs.readFileSync(entryAbs, 'utf8');
  // backup first
  const backupDir = path.join(cwd, '.sparda', 'backup');
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, `${path.basename(entryAbs)}.${Date.now()}`), src);

  const importSpec =
    `./${routerFileName.replace(/\.(ts|js|mjs|cjs)$/, moduleType === 'esm' && routerFileName.endsWith('.js') ? '.js' : '')}`.replace(
      /\.$/,
      '',
    );
  const importLine =
    moduleType === 'esm'
      ? `import { spardaRouter } from '${importSpec}';`
      : `const { spardaRouter } = require('${importSpec}');`;

  // strip previous injection blocks (idempotence)
  let body = src;
  const blockRx = new RegExp(
    `\\n?${escapeRx(MARK_START)}[\\s\\S]*?${escapeRx(MARK_END)}\\n?`,
    'g',
  );
  body = body.replace(blockRx, '\n');

  let ast;
  try {
    ast = parse(body, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx'],
      attachComment: false,
    });
  } catch {
    return manualFallback(importLine);
  }

  const lines = body.split('\n');
  let lastImportLine = 0;
  let appAssignLine = null;
  let listenLine = null;
  let appName = 'app';

  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration')
      lastImportLine = Math.max(lastImportLine, node.loc.end.line);
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        if (d.init?.type === 'CallExpression' && d.init.callee?.name === 'express') {
          appAssignLine = node.loc.end.line;
          appName = d.id.name;
        }
        if (d.init?.type === 'CallExpression' && d.init.callee?.name === 'require') {
          lastImportLine = Math.max(lastImportLine, node.loc.end.line);
        }
      }
    }
    if (
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'CallExpression' &&
      node.expression.callee?.property?.name === 'listen'
    ) {
      listenLine = node.loc.start.line;
    }
  }

  const useBlock = [
    MARK_START,
    importLine,
    `${appName}.use('/mcp', spardaRouter);`,
    MARK_END,
  ];

  let insertAt; // 0-based index AFTER which we DON'T insert; we splice before index
  if (appAssignLine !== null)
    insertAt = appAssignLine; // after app = express()
  else if (listenLine !== null)
    insertAt = listenLine - 1; // before app.listen
  else return manualFallback(importLine);

  lines.splice(insertAt, 0, ...useBlock);
  const out = lines.join('\n');

  // post-injection re-parse safety check (blueprint pitfall #6)
  try {
    parse(out, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
  } catch {
    return manualFallback(importLine);
  }
  atomicWrite(entryAbs, out);
  return { injected: true, manual: null };

  function manualFallback(imp) {
    return {
      injected: false,
      manual: [imp, `app.use('/mcp', spardaRouter);`],
    };
  }
}

export function removeInjection(cwd, manifest) {
  const results = [];
  for (const relFile of manifest.injectedFiles ?? []) {
    const abs = path.resolve(cwd, relFile);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    const blockRx = new RegExp(
      `\\n?${escapeRx(MARK_START)}[\\s\\S]*?${escapeRx(MARK_END)}`,
      'g',
    );
    const out = src.replace(blockRx, '');
    try {
      parse(out, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
      atomicWrite(abs, out);
      results.push({ file: relFile, ok: true });
    } catch {
      results.push({ file: relFile, ok: false });
    }
  }
  return results;
}

// Returns what was done ('created' | 'appended' | null) so the manifest can
// record it and `remove` can revert the exact edit (byte-for-byte promise).
// Exported: the Next.js generator shares the exact same contract.
export function ensureGitignore(cwd) {
  const gi = path.join(cwd, '.gitignore');
  const line = '.sparda/';
  if (fs.existsSync(gi)) {
    const content = fs.readFileSync(gi, 'utf8');
    if (content.split(/\r?\n/).includes(line)) return null;
    fs.appendFileSync(gi, `\n${line}\n`);
    return 'appended';
  }
  fs.writeFileSync(gi, `${line}\n`);
  return 'created';
}

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
