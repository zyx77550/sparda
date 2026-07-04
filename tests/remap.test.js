// tests/remap.test.js — R2.4: nothing disappears, x becomes y.
// A composite whose step route was renamed re-maps to its UNIQUE deterministic
// successor; ambiguity or a user-disabled step puts it to sleep WITH a reason —
// never a silent death, never a coin flip.
import { describe, it, expect } from 'vitest';
import { remapComposites, successorFor } from '../src/server/crystallize.js';

const GET = (enabled = true) => ({ method: 'GET', enabled, params: [] });

function circuitWith(steps, composite = 'circuit_test') {
  return {
    [steps.join('>')]: {
      steps,
      links: [{ from: steps[0], to: steps[1], arg: 'id', fromKey: 'id' }],
      seen: 4,
      composite: { name: composite, description: 'chained', source: 'deterministic' },
    },
  };
}

describe('successorFor — the deterministic successor rule', () => {
  const tools = {
    get_api_v2_users: GET(),
    get_api_orders: GET(),
    post_api_users: { method: 'POST', enabled: true, params: [] },
  };

  it('finds the unique rename (segments preserved in order, same resource)', () => {
    expect(successorFor('get_api_users', tools)).toBe('get_api_v2_users');
  });

  it('refuses ambiguity — two candidates is zero candidates', () => {
    const ambiguous = { ...tools, get_internal_api_users: GET() };
    expect(successorFor('get_api_users', ambiguous)).toBeNull();
  });

  it('never maps to a write or a disabled tool', () => {
    expect(
      successorFor('get_api_users', { post_api_users: tools.post_api_users }),
    ).toBeNull();
    expect(successorFor('get_api_users', { get_api_v2_users: GET(false) })).toBeNull();
  });

  it('a different resource is never a successor', () => {
    expect(successorFor('get_api_users', { get_api_orders: GET() })).toBeNull();
  });
});

describe('remapComposites — wake-up triage', () => {
  it('leaves healthy composites untouched', () => {
    const tools = { get_api_users: GET(), get_api_health: GET() };
    const { remapped, dormant } = remapComposites(
      circuitWith(['get_api_users', 'get_api_health']),
      tools,
    );
    expect(remapped).toEqual([]);
    expect(dormant).toEqual([]);
  });

  it('re-maps a renamed step: new key, renamed links, circuit intact', () => {
    const circuits = circuitWith(['get_api_users', 'get_api_health']);
    const tools = { get_api_v2_users: GET(), get_api_health: GET() }; // users moved to /v2
    const { remapped, dormant } = remapComposites(circuits, tools);

    expect(dormant).toEqual([]);
    expect(remapped).toHaveLength(1);
    const r = remapped[0];
    expect(r.renames).toEqual({ get_api_users: 'get_api_v2_users' });
    expect(r.newKey).toBe('get_api_v2_users>get_api_health');
    expect(r.circuit.steps).toEqual(['get_api_v2_users', 'get_api_health']);
    expect(r.circuit.links[0].from).toBe('get_api_v2_users'); // link followed the rename
    expect(r.circuit.composite.name).toBe('circuit_test'); // identity survives
    expect(r.circuit.seen).toBe(4); // memory survives
    // pure: the input map was not mutated
    expect(circuits['get_api_users>get_api_health']).toBeDefined();
  });

  it('a user-disabled step means dormant, never a re-route around the user', () => {
    const tools = { get_api_users: GET(false), get_api_health: GET() };
    const { remapped, dormant } = remapComposites(
      circuitWith(['get_api_users', 'get_api_health']),
      tools,
    );
    expect(remapped).toEqual([]);
    expect(dormant).toHaveLength(1);
    expect(dormant[0].reason).toContain('disabled by the user');
  });

  it('no unique successor means dormant with the vanished step named', () => {
    const tools = { get_api_health: GET() }; // users gone, nothing close
    const { remapped, dormant } = remapComposites(
      circuitWith(['get_api_users', 'get_api_health']),
      tools,
    );
    expect(remapped).toEqual([]);
    expect(dormant[0].reason).toContain('get_api_users');
    expect(dormant[0].reason).toContain('no unique successor');
  });

  it('circuits without a composite are none of our business', () => {
    const circuits = { 'a>b': { steps: ['a', 'b'], links: [], seen: 1 } };
    const { remapped, dormant } = remapComposites(circuits, {});
    expect(remapped).toEqual([]);
    expect(dormant).toEqual([]);
  });
});
