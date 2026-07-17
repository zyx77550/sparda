// stitch.test.js — cross-repo / cross-service stitching (the moat; quorum sensing). Joins one
// service's outbound HTTP calls to another's entrypoints across separately-compiled graphs, and
// rides an advisory across the boundary — a class of finding no mono-repo SAST (CodeQL/Semgrep/
// Snyk) can produce. Cross-service findings are ADVISORY (a structural join, never runtime intent).
import { describe, it, expect } from 'vitest';
import { stitchServices } from '../src/ubg/stitch.js';

// a minimal service graph: one entrypoint (a route), optionally one outbound http_call effect.
const service = (name, { route, method = 'GET', calls } = {}) => ({
  name,
  graph: {
    nodes: [
      route
        ? {
            id: `entrypoint:${method} ${route}`,
            kind: 'entrypoint',
            label: `${method} ${route}`,
            meta: {},
          }
        : null,
      calls
        ? {
            id: 'effect:http:1',
            kind: 'effect',
            meta: {
              effectType: 'http_call',
              httpMethod: calls.method ?? 'GET',
              target: calls.target,
            },
          }
        : null,
    ].filter(Boolean),
  },
  findings: [],
});

describe('stitchServices — cross-service join', () => {
  it('joins A’s outbound call to B’s matching entrypoint (suffix match survives a base URL)', () => {
    const a = service('gateway', {
      calls: { method: 'GET', target: 'http://users-svc/api/v1/users/*' },
    });
    const b = service('users-svc', { route: '/users/:id', method: 'GET' });
    const { edges } = stitchServices([a, b]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      fromService: 'gateway',
      toService: 'users-svc',
      method: 'GET',
    });
  });

  it('rides a cross-service BOLA advisory when B’s endpoint is id-scoped-unproven', () => {
    const a = service('gateway', {
      calls: { method: 'GET', target: 'http://users-svc/users/*' },
    });
    const b = service('users-svc', { route: '/users/:id', method: 'GET' });
    b.findings = [
      { rule: 'OBJECT_SCOPE_UNPROVEN', entrypoint: 'entrypoint:GET /users/:id' },
    ];
    const { findings } = stitchServices([a, b]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('CROSS_SERVICE_OBJECT_SCOPE');
    expect(findings[0].advisory).toBe(true); // never gates — a structural match, not proof
    expect(findings[0].evidence).toEqual([
      'gateway:effect:http:1',
      'users-svc:entrypoint:GET /users/:id',
    ]);
  });

  it('never stitches a service to itself', () => {
    const a = service('mono', {
      route: '/users/:id',
      method: 'GET',
      calls: { method: 'GET', target: 'http://mono/users/*' },
    });
    const { edges } = stitchServices([a]);
    expect(edges).toHaveLength(0);
  });

  it('does not match on a method mismatch', () => {
    const a = service('gateway', {
      calls: { method: 'POST', target: 'http://users-svc/users/*' },
    });
    const b = service('users-svc', { route: '/users/:id', method: 'GET' });
    expect(stitchServices([a, b]).edges).toHaveLength(0);
  });

  it('does not match unrelated paths', () => {
    const a = service('gateway', {
      calls: { method: 'GET', target: 'http://billing/invoices/*' },
    });
    const b = service('users-svc', { route: '/users/:id', method: 'GET' });
    expect(stitchServices([a, b]).edges).toHaveLength(0);
  });
});
