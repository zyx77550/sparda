// state-min-signals.test.js — StateMinimization must carry G1/G2 advisory body signals
// (bodyDenies / bodyVerifies / bodyRedirects / ownerAsserted) from an absorbed logic node onto
// the survivor when it merges a thin delegator into its callee. A credential refusal that lives
// on the absorbed node would otherwise vanish at the merge and the route would read as a FALSE
// CRITICAL. This is a direct unit test of that propagation (independent of how the signal reached
// the node during resolution), so it bites the line even when an end-to-end fixture happens to
// carry the same signal by a second path.
import { describe, it, expect } from 'vitest';
import { createGraph, addNode, addEdge, makeNode, makeEdge } from '../src/ubg/schema.js';
import { run as stateMinimize } from '../src/ubg/passes/state-minimization.js';

// a → b (single control-flow edge, same file, b not a handler, b's only incoming edge is the
// seam) is the exact shape findMergeCandidate absorbs.
function delegatorGraph(absorbedMeta) {
  const g = createGraph();
  addNode(
    g,
    makeNode('logic:f.js#a:1', 'logic', 'delegator', { file: 'f.js', line: 1 }, {}),
  );
  addNode(
    g,
    makeNode(
      'logic:f.js#b:2',
      'logic',
      'refuser',
      { file: 'f.js', line: 2 },
      absorbedMeta,
    ),
  );
  addEdge(g, makeEdge('control_flow', 'logic:f.js#a:1', 'logic:f.js#b:2', {}));
  return g;
}

describe('StateMinimization carries advisory body signals across a merge', () => {
  for (const signal of ['bodyDenies', 'bodyVerifies', 'bodyRedirects', 'ownerAsserted']) {
    it(`propagates ${signal} from the absorbed node onto the survivor`, () => {
      const g = delegatorGraph({ [signal]: true });
      const { merged } = stateMinimize(g);
      expect(merged).toBe(1); // the pair was absorbed
      expect(g.nodes.has('logic:f.js#b:2')).toBe(false); // b is gone
      expect(g.nodes.get('logic:f.js#a:1').meta[signal]).toBe(true); // signal survived
    });
  }

  it('does not invent a signal the absorbed node never carried', () => {
    const g = delegatorGraph({});
    stateMinimize(g);
    expect(g.nodes.get('logic:f.js#a:1').meta.bodyDenies).toBeUndefined();
  });
});
