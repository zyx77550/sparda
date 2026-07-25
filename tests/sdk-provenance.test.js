// sdk-provenance.test.js — import-provenance for effect clients (the "colony odor" label).
// A binding imported from an effect package (or built from one via new/factory/alias) carries an
// effect label acquired at its source; any call on it is recognized by ORIGIN, not by guessing
// the method name. This catches the bare `.send()` tail (SendGrid `sgMail.send`) the path catalog
// can't. Read-shaped methods stay GET (not observable) so a `.retrieve` is never a false
// irreversible effect; a binding from a non-effect package (lodash) never fires.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileUBG } from '../src/ubg/compile.js';
import { canonicalizeGraph } from '../src/ubg/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'ubg-sdk-provenance');

const httpCalls = (() => {
  const { graph } = compileUBG(FIX, { write: false });
  return canonicalizeGraph(graph).nodes.filter(
    (n) => n.kind === 'effect' && n.meta.effectType === 'http_call',
  );
})();

const call = (frag) => httpCalls.find((n) => n.meta.target.includes(frag));

describe('import-provenance for effect SDK clients', () => {
  it('resolves a bare sgMail.send() as an observable external effect (by origin)', () => {
    const c = call('sgMail.send');
    expect(c).toBeTruthy();
    expect(c.meta.observable).toBe(true);
  });

  it('classifies a read-shaped method on the client as a non-observable GET', () => {
    const c = call('stripe.retrieve');
    expect(c).toBeTruthy();
    expect(c.meta.observable).toBe(false);
  });

  it('does NOT fire on a binding from a non-effect package (lodash)', () => {
    expect(httpCalls.some((n) => /lodash|_\.|pick/.test(n.meta.target))).toBe(false);
  });
});
