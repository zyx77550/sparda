// suggest-app-dirs.test.js — the "never a silent 0 routes" diagnostic (URGENT-ADOPTION J1 #2).
// A monorepo root has no framework of its own; a dead "No framework found" / "0 routes" there
// is the #1 time-to-wow killer. suggestAppDirs turns that dead-end into an actionable pointer:
// scan the conventional containers (apps/, packages/, services/, …) for sub-dirs that LOOK
// like an analyzable app, cheaply (deps + structural signatures, no entry-file tree scan).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestAppDirs, detectStack } from '../src/detect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = (name) => path.join(here, 'fixtures', name);

describe('suggestAppDirs — monorepo dead-end recovery', () => {
  it('points at the analyzable sub-apps under apps/ and packages/', () => {
    const dirs = suggestAppDirs(fix('mono-suggest'));
    const byDir = Object.fromEntries(dirs.map((d) => [d.dir, d.framework]));
    expect(byDir['apps/web']).toBe('Next.js');
    expect(byDir['packages/api']).toBe('Express');
  });

  it('skips a sub-dir that is NOT an app (no framework dep, no signature)', () => {
    const dirs = suggestAppDirs(fix('mono-suggest'));
    expect(dirs.find((d) => d.dir === 'services/worker')).toBeUndefined();
  });

  it('every suggestion actually resolves to a real framework (the pointer is honest)', () => {
    for (const d of suggestAppDirs(fix('mono-suggest'))) {
      const stack = detectStack(path.join(fix('mono-suggest'), d.dir));
      expect(stack.framework).toBeTruthy();
    }
  });

  it('a single-app leaf dir yields no suggestions (no false monorepo noise)', () => {
    // the web app itself is a leaf — nothing to suggest under it
    expect(suggestAppDirs(fix('mono-suggest/apps/web'))).toEqual([]);
  });

  it('the no-framework error at a monorepo root carries the suggestions in its hint', () => {
    let hint = '';
    try {
      detectStack(fix('mono-suggest'));
    } catch (e) {
      hint = e.hint ?? '';
    }
    expect(hint).toContain('apps/web');
    expect(hint).toContain('monorepo');
  });
});
