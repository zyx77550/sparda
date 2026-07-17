// ubg/prisma.js — schema.prisma → state facts.
// Most modern Node projects declare their schema in Prisma, not .sql files —
// without this parser their state layer is empty and half the compiler runs
// blind. Emits the exact table shape sql.js emits (columns, invariants,
// references) so the translator never knows the difference. Enums become
// CHECK-style invariants (`status in ('pending', 'paid')`), which is exactly
// what StateMachineInference reads — a Prisma enum IS a declared state set.
// Values and identifiers are lowercased like the SQL side: deterministic,
// case-insensitive matching against code literals.
import fs from 'node:fs';
import path from 'node:path';
import { cmp } from './schema.js';

const SCHEMA_CANDIDATES = ['prisma/schema.prisma', 'schema.prisma', 'db/schema.prisma'];
// Prisma's `prismaSchemaFolder` layout (stable since 6.x): the schema is SPLIT across many
// `*.prisma` files under a directory, no single schema.prisma. Modern apps use it (dub: 36
// files). Without this, their entire state layer — invariants, aggregates, ownership — is
// invisible (E-046). These directory candidates are scanned when no single file is found.
const SCHEMA_DIR_CANDIDATES = ['prisma/schema', 'schema', 'db/schema'];

// Gather every `.prisma` file to parse: the single file if present, else all files in a schema
// folder (bounded, deterministic order). Returns [{ file, rel }] or [] if nothing found.
function collectSchemaFiles(cwd, fileCandidates, dirCandidates) {
  for (const c of fileCandidates) {
    const abs = path.resolve(cwd, c);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return [abs];
  }
  for (const c of dirCandidates) {
    const abs = path.resolve(cwd, c);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const files = [];
    const walk = (dir, depth) => {
      if (depth > 3) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name.endsWith('.prisma')) files.push(p);
      }
    };
    walk(abs, 0);
    if (files.length) return files;
  }
  return [];
}

const TYPE_MAP = {
  string: 'string',
  int: 'number',
  bigint: 'number',
  float: 'number',
  decimal: 'number',
  boolean: 'boolean',
  datetime: 'string',
  json: 'object',
  bytes: 'string',
};

export function parsePrismaSchemas(cwd) {
  const skipped = [];
  // package.json "prisma": { "schema": "src/prisma/schema.prisma" } wins —
  // monorepos relocate the schema and declare it exactly there
  const candidates = [...SCHEMA_CANDIDATES];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    if (typeof pkg.prisma?.schema === 'string') candidates.unshift(pkg.prisma.schema);
  } catch {
    // no package.json / unparsable — the default candidates stand
  }
  const files = collectSchemaFiles(cwd, candidates, SCHEMA_DIR_CANDIDATES);
  if (!files.length) return { tables: [], skipped, sourceFile: null };

  // Read + strip comments once per file; keep the relative path for correct per-table locs.
  const parts = [];
  for (const abs of files) {
    try {
      parts.push({
        rel: path.relative(cwd, abs).split(path.sep).join('/'),
        clean: fs.readFileSync(abs, 'utf8').replace(/\/\/[^\n]*/g, ''),
      });
    } catch (err) {
      skipped.push({ reason: `unreadable prisma schema: ${err.message}` });
    }
  }
  if (!parts.length) return { tables: [], skipped, sourceFile: null };
  const sourceFile = parts.length === 1 ? parts[0].rel : path.dirname(parts[0].rel);

  // Enums and model names are collected ACROSS ALL files first — a model in one file may
  // reference an enum (or a relation target) declared in another (the whole point of the
  // folder layout). Then models are parsed per-file so each table keeps its true file:line.
  const enums = new Map(); // lowercase name -> [values lowercase]
  const modelNames = new Set();
  for (const { clean } of parts) {
    for (const m of clean.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)) {
      const values = m[2]
        .split(/\s+/)
        .map((v) => v.trim())
        .filter((v) => v && !v.startsWith('@'))
        .map((v) => v.toLowerCase());
      enums.set(m[1].toLowerCase(), values);
    }
    for (const m of clean.matchAll(/model\s+(\w+)\s*\{/g)) modelNames.add(m[1]);
  }

  const tables = [];
  for (const { rel, clean } of parts) {
    for (const m of clean.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)) {
      const line = clean.slice(0, m.index).split('\n').length;
      tables.push(parseModel(m[1], m[2], line, rel, enums, modelNames, skipped));
    }
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));
  return { tables, skipped, sourceFile };
}

function parseModel(modelName, body, line, sourceFile, enums, modelNames, skipped) {
  const columns = [];
  const invariants = [];
  const references = [];
  let mappedTable = null;

  const fk = (fields, refModel, refFields) => {
    const ref = { table: refModel.toLowerCase(), fields: refFields ?? ['id'] };
    invariants.push({ type: 'foreign_key', fields, references: ref });
    references.push({ fields, table: ref.table, refFields: ref.fields });
  };

  for (const rawLine of body.split('\n')) {
    const def = rawLine.trim();
    if (!def) continue;

    // block-level attributes
    if (def.startsWith('@@')) {
      let bm;
      if ((bm = def.match(/^@@map\(\s*"([^"]+)"\s*\)/)))
        mappedTable = bm[1].toLowerCase();
      else if ((bm = def.match(/^@@unique\(\s*\[([^\]]*)\]/)))
        invariants.push({ type: 'unique', fields: fieldList(bm[1]) });
      else if ((bm = def.match(/^@@id\(\s*\[([^\]]*)\]/)))
        invariants.push({ type: 'primary_key', fields: fieldList(bm[1]) });
      continue;
    }

    const fm = def.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
    if (!fm) continue;
    const [, fieldName, rawType, isList, optional, attrs] = fm;
    const name = fieldName.toLowerCase();
    const typeLower = rawType.toLowerCase();

    // relation field (points at another model) — FK lives in @relation
    if (modelNames.has(rawType)) {
      const rel = attrs.match(
        /@relation\(\s*fields:\s*\[([^\]]*)\]\s*,\s*references:\s*\[([^\]]*)\]/,
      );
      if (rel) fk(fieldList(rel[1]), rawType, fieldList(rel[2]));
      continue; // relations are edges, not columns
    }
    if (isList) continue; // scalar lists & back-relations carry no column

    const isPk = /@id\b/.test(attrs);
    const isUnique = /@unique\b/.test(attrs);
    const defaultM = attrs.match(/@default\(([^)]*)\)/);
    const enumValues = enums.get(typeLower) ?? null;

    columns.push({
      name,
      sqlType: typeLower,
      type: enumValues ? 'string' : (TYPE_MAP[typeLower] ?? typeLower),
      nullable: Boolean(optional) && !isPk,
      pk: isPk,
    });

    if (isPk) invariants.push({ type: 'primary_key', fields: [name] });
    if (!optional && !isPk) invariants.push({ type: 'not_null', fields: [name] });
    if (isUnique) invariants.push({ type: 'unique', fields: [name] });
    if (defaultM)
      invariants.push({
        type: 'default',
        fields: [name],
        value: defaultM[1].trim().replace(/"/g, "'").toLowerCase(),
      });
    // a Prisma enum IS a declared state set — emit the CHECK the
    // StateMachineInference pass already knows how to read
    if (enumValues) {
      if (!enumValues.length)
        skipped.push({ reason: `enum ${rawType} is empty`, file: sourceFile });
      else
        invariants.push({
          type: 'check',
          expression: `${name} in (${enumValues.map((v) => `'${v}'`).join(', ')})`,
        });
    }
  }

  const name = modelName.toLowerCase();
  return {
    name,
    // code says `prisma.order.create` (model), SQL says the @@map name —
    // both must resolve to this state node
    aliases: mappedTable && mappedTable !== name ? [mappedTable] : [],
    columns,
    invariants: invariants.sort((a, b) =>
      cmp(
        `${a.type} ${(a.fields ?? []).join(',')}`,
        `${b.type} ${(b.fields ?? []).join(',')}`,
      ),
    ),
    references,
    sourceFile,
    sourceLine: line,
  };
}

const fieldList = (s) =>
  s
    .split(',')
    .map((x) => x.trim().replace(/"/g, '').toLowerCase())
    .filter(Boolean);
