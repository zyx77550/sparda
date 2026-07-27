// Adapter v2 (robust) — SPARDA UBG (N services) → CSOP DBG → verdicts. Ephemeral.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const S = 'C:/Users/zakwi/Developer/sparda-hq';
const { compileUBG } = await import(pathToFileURL(S + '/src/ubg/compile.js').href);
const { canonicalizeGraph } = await import(pathToFileURL(S + '/src/ubg/schema.js').href);
const { proveCrossServiceOwnership } = await import(pathToFileURL(process.argv[3]).href);

const root = process.argv[2];
const svcDirs = process.argv.slice(4); // explicit service dir names

const pathParams = (p) =>
  (String(p).match(/:([A-Za-z0-9_]+)/g) || []).map((s) => s.slice(1));
const segs = (p) =>
  String(p)
    .replace(/^https?:\/\/[^/]+/, '')
    .split(/[?#]/)[0]
    .split('/')
    .filter(Boolean)
    .map((s) => (/^[:{*]/.test(s) || s.includes('*') ? '*' : s));
const suffix = (caller, callee) =>
  callee.length &&
  callee.length <= caller.length &&
  callee.every((c, i) => {
    const a = caller[caller.length - callee.length + i];
    return a === c || a === '*' || c === '*';
  });
const hostOf = (t) => (String(t).match(/^https?:\/\/([^/]+)/) || [])[1] || '';

// 1) extract from each SPARDA graph
const services = svcDirs.map((dir) => {
  const g = canonicalizeGraph(compileUBG(path.join(root, dir), { write: false }).graph);
  const eps = [],
    httpCalls = [],
    sinks = [],
    guards = [];
  for (const n of g.nodes) {
    if (n.kind === 'entrypoint')
      eps.push({
        id: n.id,
        method: (n.meta.method || 'GET').toUpperCase(),
        path: n.label.replace(/^[A-Z]+\s+/, ''),
        inputs: (n.meta.inputs || []).map((i) => ({ name: i.name, source: i.in })),
      });
    if (n.kind === 'effect' && n.meta.effectType === 'http_call')
      httpCalls.push({
        id: n.id,
        method: (n.meta.httpMethod || 'GET').toUpperCase(),
        target: n.meta.target,
      });
    if (
      n.kind === 'effect' &&
      (n.meta.effectType === 'db_write' || n.meta.effectType === 'db_read')
    )
      sinks.push({
        id: n.id,
        op:
          n.meta.effectType === 'db_read'
            ? 'read'
            : n.meta.op === 'insert'
              ? 'create'
              : n.meta.op,
        table: n.meta.table,
        ownerScoped: !!n.meta.ownerScoped,
      });
    if (n.kind === 'guard' && n.meta.verified) guards.push(n);
  }
  return { dir, name: dir, g, eps, httpCalls, sinks, authed: guards.length > 0 };
});

// 2) exposure inference: a service targeted by another service's httpCall AND only exposing
//    /api|/internal paths is treated INTERNAL; otherwise PUBLIC (conservative default).
const targetedHosts = new Set();
for (const s of services)
  for (const h of s.httpCalls) targetedHosts.add(hostOf(h.target));
const allEps = services.flatMap((s) =>
  s.eps.map((e) => ({
    ...e,
    service: s.name,
    segs: segs(e.path),
    pp: pathParams(e.path),
  })),
);
const exposureOf = (s) => {
  const isTargeted = targetedHosts.has(s.name);
  const onlyApi = s.eps.length && s.eps.every((e) => /^\/(api|internal)\b/.test(e.path));
  return isTargeted && onlyApi ? 'internal' : 'public';
};

// 3) build DBG
const dbg = services.map((s) => {
  const nodes = [],
    edges = [];
  const exposure = exposureOf(s);
  for (const ep of s.eps) {
    nodes.push({
      id: ep.id,
      kind: 'entrypoint',
      method: ep.method,
      path: ep.path,
      principal: s.authed ? 'authenticated' : 'public',
      exposure,
      params: ep.inputs,
    });
    const idParam = (ep.inputs.find((p) => p.source === 'path') || ep.inputs[0] || {})
      .name;
    // reaches/dataflow from THIS entrypoint to sinks and httpCalls of the same service
    for (const sk of s.sinks) {
      if (!nodes.find((x) => x.id === sk.id)) {
        nodes.push({
          id: sk.id,
          kind: 'sink',
          op: sk.op,
          table: sk.table,
          objectIdParam: idParam || null,
          ownershipScoped: sk.ownerScoped,
        });
      }
      edges.push({ from: ep.id, to: sk.id, type: 'reaches' });
      if (idParam)
        edges.push({ from: ep.id, to: sk.id, type: 'dataflow', value: idParam });
    }
    for (const hc of s.httpCalls) {
      const callee = allEps.find(
        (c) =>
          c.service !== s.name &&
          c.method === hc.method &&
          (hostOf(hc.target) === c.service || true) &&
          suffix(segs(hc.target), c.segs) &&
          (hostOf(hc.target) === c.service ||
            !services.some((x) => x.name === hostOf(hc.target))),
      );
      const forwarded =
        callee && idParam && callee.pp.length
          ? [{ calleeParam: callee.pp[0], fromParam: idParam }]
          : [];
      if (!nodes.find((x) => x.id === hc.id))
        nodes.push({
          id: hc.id,
          kind: 'httpCall',
          method: hc.method,
          target: hc.target,
          forwarded,
        });
      edges.push({ from: ep.id, to: hc.id, type: 'reaches' });
      if (idParam)
        edges.push({ from: ep.id, to: hc.id, type: 'dataflow', value: idParam });
    }
  }
  return { name: s.name, nodes, edges, exposure };
});

const r = proveCrossServiceOwnership(dbg);
// compact verdict signature for the runner
console.log(
  JSON.stringify({
    exposure: Object.fromEntries(dbg.map((d) => [d.name, d.exposure])),
    summary: r.summary,
    findings: r.findings.map((f) => ({
      verdict: f.verdict,
      table: f.table,
      path: f.path,
    })),
  }),
);
