// ubg/stitch.js — cross-repo / cross-service stitching (the moat). SAST incumbents
// (CodeQL/Semgrep/Snyk) are mono-repo by construction — a violation that crosses a service
// boundary (service A forwards a caller-supplied id to service B, which trusts it blindly) is
// invisible to all of them. SPARDA already produces the artifact that makes it possible: a
// committed `ubg.json` per repo. This pass reads N of them and joins the outbound HTTP calls of
// one to the entrypoints of another — the reproduction of BACTERIAL QUORUM SENSING: each service
// emits a signal (its graph); the collective behavior emerges from reading them together, with no
// central coordinator and no network access between services (each graph is committed in git).
//
// Soundness: cross-service findings are ADVISORY (same stance as BOLA/O7) — the join is a
// structural match, never a proof of runtime intent across the boundary. It points a human at a
// trust boundary to review; it never gates a verdict.

// A route path or an outbound URL target → comparable segment list. Strips scheme+host and query,
// lowercases, collapses every parameter form (:id, {id}, *) to a single '*' token.
function segmentsOf(target) {
  let s = String(target ?? '');
  const url = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i);
  if (url) s = url[1] ?? '/';
  s = s.split(/[?#]/)[0].toLowerCase();
  return s
    .split('/')
    .filter(Boolean)
    .map((seg) => (/^[:{*]/.test(seg) || seg.includes('*') ? '*' : seg));
}

// method from an entrypoint label ("GET /users/:id") or an http_call ("httpMethod"); default GET.
const methodOf = (label) =>
  (String(label).match(/^([A-Z]+)\s/)?.[1] ?? 'GET').toUpperCase();
const pathPart = (label) => String(label).replace(/^[A-Z]+\s+/, '');

// B's entrypoint (callee) matches A's outbound call when the methods agree and the callee's path
// segments are a SUFFIX of the caller's target segments — so a base-URL prefix
// (`http://host/api/v1/users/*` calling B's `/users/:id`) still matches. '*' matches anything.
function suffixMatch(callerSegs, calleeSegs) {
  if (calleeSegs.length === 0 || calleeSegs.length > callerSegs.length) return false;
  const off = callerSegs.length - calleeSegs.length;
  for (let i = 0; i < calleeSegs.length; i++) {
    const a = callerSegs[off + i];
    const b = calleeSegs[i];
    if (a !== b && a !== '*' && b !== '*') return false;
  }
  return true;
}

// services: [{ name, graph (canonical), findings? }]. Returns cross-service call edges and the
// advisory findings that ride them.
export function stitchServices(services) {
  const edges = [];
  const findings = [];

  // index every service's entrypoints (the callees) by method + segments
  const callees = [];
  for (const svc of services) {
    for (const n of svc.graph?.nodes ?? []) {
      if (n.kind !== 'entrypoint') continue;
      callees.push({
        service: svc.name,
        entrypoint: n.id,
        label: n.label,
        method: methodOf(n.label),
        segs: segmentsOf(pathPart(n.label)),
        bola: (svc.findings ?? []).some(
          (f) => f.rule === 'OBJECT_SCOPE_UNPROVEN' && f.entrypoint === n.id,
        ),
      });
    }
  }

  for (const svc of services) {
    for (const n of svc.graph?.nodes ?? []) {
      if (n.kind !== 'effect' || n.meta?.effectType !== 'http_call') continue;
      const callerMethod = (n.meta.httpMethod ?? 'GET').toUpperCase();
      const callerSegs = segmentsOf(n.meta.target);
      if (!callerSegs.length) continue;
      for (const c of callees) {
        if (c.service === svc.name) continue; // never stitch a service to itself
        if (c.method !== callerMethod) continue;
        if (!suffixMatch(callerSegs, c.segs)) continue;
        edges.push({
          fromService: svc.name,
          fromEffect: n.id,
          toService: c.service,
          toEntrypoint: c.entrypoint,
          method: callerMethod,
          path: '/' + c.segs.join('/'),
        });
        // the trust-boundary finding: A forwards to a B endpoint B itself flagged as accessing an
        // object by a request id with no ownership scope — so the object-level authorization
        // across the A→B boundary is unproven. Advisory (a structural match, not runtime intent).
        if (c.bola) {
          findings.push({
            rule: 'CROSS_SERVICE_OBJECT_SCOPE',
            severity: 'info',
            advisory: true,
            entrypoint: c.entrypoint,
            message: `${svc.name} calls ${c.service} ${c.method} ${'/' + c.segs.join('/')}, which accesses an object by a request id with no ownership scope proven — the object-level authorization across this service boundary is unproven (cross-service BOLA/IDOR)`,
            evidence: [`${svc.name}:${n.id}`, `${c.service}:${c.entrypoint}`],
          });
        }
      }
    }
  }
  return { edges, findings };
}
