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
    const { columns, primaryKeys, invariants, references } = parseColumns(body);
    for (const col of columns) if (primaryKeys.has(col.name)) col.pk = true;
    tables.push({
      name: name.toLowerCase(),
      columns,
      invariants: sortInvariants(invariants),
      references,
      sourceFile,
      sourceLine: lineOf(src, m.index),
    });
    re.lastIndex = bodyEnd;
  }
  return tables;
}

// SBIR §2.1 — canonical invariant order: (type, fields) so the artifact never
// depends on declaration order quirks between migration files
function sortInvariants(invariants) {
  return [...invariants].sort((a, b) => {
    const ka = `${a.type} ${(a.fields ?? []).join(',')} ${a.expression ?? ''}`;
    const kb = `${b.type} ${(b.fields ?? []).join(',')} ${b.expression ?? ''}`;
    return ka.localeCompare(kb);
  });
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

const cleanIdent = (s) => s.trim().replace(/"/g, '').toLowerCase();
const fieldList = (s) => s.split(',').map(cleanIdent);
const normalizeWs = (s) => s.trim().replace(/\s+/g, ' ');

function parseColumns(body) {
  const columns = [];
  const primaryKeys = new Set();
  const invariants = [];
  const references = [];

  const fk = (fields, refTable, refFieldsRaw) => {
    const ref = {
      table: cleanIdent(refTable).split('.').pop(),
      fields: refFieldsRaw ? fieldList(refFieldsRaw) : ['id'],
    };
    invariants.push({ type: 'foreign_key', fields, references: ref });
    references.push({ fields, table: ref.table, refFields: ref.fields });
  };

  for (const rawDef of splitTopLevel(body)) {
    let def = normalizeWs(rawDef);
    if (!def) continue;
    def = def.replace(/^constraint\s+"?\w+"?\s+/i, ''); // named → anonymous form

    if (CONSTRAINT_PREFIX.test(def)) {
      // table-level constraints (SBIR §2.1 inference table)
      let m;
      if ((m = def.match(/^primary\s+key\s*\(([^)]*)\)/i))) {
        for (const c of fieldList(m[1])) primaryKeys.add(c);
      } else if ((m = def.match(/^unique\s*\(([^)]*)\)/i))) {
        invariants.push({ type: 'unique', fields: fieldList(m[1]) });
      } else if ((m = def.match(/^check\s*\((.*)\)$/i))) {
        invariants.push({ type: 'check', expression: normalizeWs(m[1]) });
      } else if (
        (m = def.match(
          /^foreign\s+key\s*\(([^)]*)\)\s+references\s+("?[\w.]+"?)\s*(?:\(([^)]*)\))?/i,
        ))
      ) {
        fk(fieldList(m[1]), m[2], m[3]);
      }
      continue; // table-level constraints are not columns
    }

    const colMatch = def.match(/^("?[\w]+"?)\s+([\w]+(?:\s*\([^)]*\))?)/);
    if (!colMatch) continue;
    const colName = cleanIdent(colMatch[1]);
    const sqlType = colMatch[2].toLowerCase().replace(/\s+/g, '');
    const notNull = /\bnot\s+null\b/i.test(def);
    const isPk = /\bprimary\s+key\b/i.test(def);
    columns.push({
      name: colName,
      sqlType,
      type: normalizeType(sqlType),
      nullable: !notNull,
      pk: isPk,
    });
    if (isPk) primaryKeys.add(colName);

    // inline column constraints → invariants
    if (notNull) invariants.push({ type: 'not_null', fields: [colName] });
    if (/\bunique\b/i.test(def) && !isPk)
      invariants.push({ type: 'unique', fields: [colName] });
    let m;
    if ((m = def.match(/\bcheck\s*\((.*)\)/i)))
      invariants.push({ type: 'check', expression: normalizeWs(m[1]) });
    if ((m = def.match(/\breferences\s+("?[\w.]+"?)\s*(?:\(([^)]*)\))?/i)))
      fk([colName], m[1], m[2]);
    if (
      (m = def.match(
        /\bdefault\s+(.+?)(?=\s+(?:not\s+null|primary\s+key|unique|check|references)\b|$)/i,
      ))
    )
      invariants.push({ type: 'default', fields: [colName], value: normalizeWs(m[1]) });
  }

  if (primaryKeys.size)
    invariants.push({ type: 'primary_key', fields: [...primaryKeys].sort() });
  return { columns, primaryKeys, invariants, references };
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
