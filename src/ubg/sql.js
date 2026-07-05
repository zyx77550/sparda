// ubg/sql.js — SQL DDL → state facts.
// The database schema is the only part of a backend that is pure declared
// truth (no control flow to guess at), so it anchors the UBG's state layer.
// We parse CREATE TABLE statements from .sql files with a balanced-paren
// scanner (regex alone dies on VARCHAR(255) and CHECK(...)), extract columns
// with normalized types, and skip everything else with a reason — never guess.
import fs from 'node:fs';
import path from 'node:path';

const EXCLUDE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.sparda',
  'venv',
  '.venv',
]);
const MAX_SQL_FILES = 50;

// SQL type family → UBG scalar type. Unknown families stay as-is (lowercased)
// so the information survives instead of collapsing into "unknown".
const TYPE_MAP = [
  [/^(big|small|tiny)?(int|integer|serial)/, 'number'],
  [/^(numeric|decimal|real|double|float|money)/, 'number'],
  [/^(var)?char|^text|^uuid|^citext|^inet/, 'string'],
  [/^bool/, 'boolean'],
  [/^(timestamp|date|time|interval)/, 'string'],
  [/^json/, 'object'],
  [/^bytea|^blob/, 'string'],
];

export function parseSqlSchemas(cwd) {
  const tables = [];
  const skipped = [];
  const files = findSqlFiles(cwd);

  for (const abs of files) {
    let src;
    try {
      src = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(cwd, abs).split(path.sep).join('/');
    for (const t of extractCreateTables(stripSqlComments(src), rel, skipped)) {
      tables.push(t);
    }
  }

  // deterministic regardless of filesystem enumeration order; last definition
  // wins on duplicates (migrations redefine tables — latest file path sorts last)
  tables.sort((a, b) =>
    a.name === b.name
      ? a.sourceFile.localeCompare(b.sourceFile)
      : a.name.localeCompare(b.name),
  );
  const byName = new Map();
  for (const t of tables) byName.set(t.name, t);
  return { tables: [...byName.values()], skipped };
}

function findSqlFiles(cwd) {
  const found = [];
  walk(cwd, 0);
  return found.sort();

  function walk(dir, depth) {
    if (depth > 6 || found.length >= MAX_SQL_FILES) return;
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_SQL_FILES) return;
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (!EXCLUDE.has(item.name) && !item.name.startsWith('.')) walk(abs, depth + 1);
      } else if (item.isFile() && item.name.toLowerCase().endsWith('.sql')) {
        found.push(abs);
      }
    }
  }
}

function stripSqlComments(src) {
  return src.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractCreateTables(src, sourceFile, skipped) {
  const tables = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?("?[\w.]+"?)\s*\(/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const rawName = m[1].replace(/"/g, '');
    const name = rawName.includes('.') ? rawName.split('.').pop() : rawName; // strip schema prefix
    const bodyStart = m.index + m[0].length;
    const bodyEnd = findMatchingParen(src, bodyStart);
    if (bodyEnd === -1) {
      skipped.push({
        reason: `unbalanced parens in CREATE TABLE ${name}`,
        file: sourceFile,
      });
      continue;
    }
    const body = src.slice(bodyStart, bodyEnd);
    const { columns, primaryKeys } = parseColumns(body);
    for (const col of columns) if (primaryKeys.has(col.name)) col.pk = true;
    tables.push({
      name: name.toLowerCase(),
      columns,
      sourceFile,
      sourceLine: lineOf(src, m.index),
    });
    re.lastIndex = bodyEnd;
  }
  return tables;
}

// scan from the char after the opening paren; returns index of its match
function findMatchingParen(src, start) {
  let depth = 1;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

const CONSTRAINT_PREFIX =
  /^(primary\s+key|foreign\s+key|constraint|unique\s*\(|check\s*\(|exclude|like\s)/i;

function parseColumns(body) {
  const columns = [];
  const primaryKeys = new Set();

  for (const rawDef of splitTopLevel(body)) {
    const def = rawDef.trim();
    if (!def) continue;

    if (CONSTRAINT_PREFIX.test(def)) {
      const pkMatch = def.match(/^primary\s+key\s*\(([^)]*)\)/i);
      if (pkMatch) {
        for (const c of pkMatch[1].split(','))
          primaryKeys.add(c.trim().replace(/"/g, '').toLowerCase());
      }
      continue; // table-level constraints are not columns
    }

    const colMatch = def.match(/^("?[\w]+"?)\s+([\w]+(?:\s*\([^)]*\))?)/);
    if (!colMatch) continue;
    const colName = colMatch[1].replace(/"/g, '').toLowerCase();
    const sqlType = colMatch[2].toLowerCase().replace(/\s+/g, '');
    columns.push({
      name: colName,
      sqlType,
      type: normalizeType(sqlType),
      nullable: !/\bnot\s+null\b/i.test(def),
      pk: /\bprimary\s+key\b/i.test(def),
    });
    if (/\bprimary\s+key\b/i.test(def)) primaryKeys.add(colName);
  }
  return { columns, primaryKeys };
}

// split on commas at paren depth 0 — DECIMAL(10,2) stays intact
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const c of body) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  parts.push(current);
  return parts;
}

function normalizeType(sqlType) {
  for (const [re, t] of TYPE_MAP) if (re.test(sqlType)) return t;
  return sqlType.replace(/\(.*\)/, '');
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;
