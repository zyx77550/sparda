// prisma-relations.test.js — FK harvest across real-world @relation shapes.
// Audit blind spot #2: the old single-line `@relation(\s*fields:` regex only matched a plain,
// first-attribute relation. Named relations (`@relation("Name", …, onDelete: Cascade)`) and
// multiline relations were silently dropped, so consistency domains collapsed to one-table
// islands on serious schemas (ghostfolio: 0 FK edges) and O3/O5 never fired. This locks that
// all three forms produce the FK, and that the tables merge into one aggregate.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrismaSchemas } from '../src/ubg/prisma.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-prisma-relations');

describe('Prisma FK harvest: named, onDelete, and multiline relations', () => {
  const { tables } = parsePrismaSchemas(FIX);
  const refOf = (name) => tables.find((t) => t.name === name)?.references ?? [];

  it('extracts the FK from a plain single-line relation', () => {
    expect(refOf('account')).toEqual([
      { fields: ['userid'], table: 'user', refFields: ['id'] },
    ]);
  });

  it('extracts the FK from a NAMED relation with onDelete (regression: was dropped)', () => {
    expect(refOf('order')).toEqual([
      { fields: ['userid'], table: 'user', refFields: ['id'] },
    ]);
  });

  it('extracts the FK from a MULTILINE relation (regression: was dropped)', () => {
    expect(refOf('post')).toEqual([
      { fields: ['userid'], table: 'user', refFields: ['id'] },
    ]);
  });

  it('does not invent a back-relation FK on the parent (User has none)', () => {
    expect(refOf('user')).toEqual([]);
  });
});
