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
  const file = candidates
    .map((c) => path.resolve(cwd, c))
    .find((abs) => fs.existsSync(abs));
  if (!file) return { tables: [], skipped, sourceFile: null };

  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (err) {
    skipped.push({ reason: `unreadable schema.prisma: ${err.message}` });
    return { tables: [], skipped, sourceFile: null };
  }
  const sourceFile = path.relative(cwd, file).split(path.sep).join('/');
  const clean = src.replace(/\/\/[^\n]*/g, '');

  // enums first — model fields reference them
  const enums = new Map(); // lowercase name -> [values lowercase]
  for (const m of clean.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)) {
    const values = m[2]
      .split(/\s+/)
      .map((v) => v.trim())
      .filter((v) => v && !v.startsWith('@'))
      .map((v) => v.toLowerCase());
    enums.set(m[1].toLowerCase(), values);
  }

  const modelNames = new Set([...clean.matchAll(/model\s+(\w+)\s*\{/g)].map((m) => m[1]));

  const tables = [];
  for (const m of clean.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)) {
    const modelName = m[1];
    const body = m[2];
    const line = clean.slice(0, m.index).split('\n').length;
    tables.push(
      parseModel(modelName, body, line, sourceFile, enums, modelNames, skipped),
    );
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
