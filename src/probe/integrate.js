/**
 * SPARDA — Dynamic route discovery integration (Brief #3, the final adapter)
 *
 * The "last 10%" that glues the runtime probe to SPARDA's generator pipeline:
 *
 *   probeRoutes()       → canonical dynamic routes (minimal shape)
 *   reconcile()         → set-difference vs the AST floor → gaps[] the parser missed
 *   gapToStaticRoute()  → enrich each gap into SPARDA's RICH route shape so the
 *                         existing generators (generator/express.js, fastapi.js)
 *                         consume it with ZERO special-casing.
 *
 * Static stays the floor; this only ADDS probe-only routes (§C). A probe failure
 * degrades to static-only — probeRoutes() already returns [] on any error, and
 * the init caller wraps this in try/catch as a second net.
 *
 * ESM, Node ≥ 18. Zero new deps (re-uses the sibling probe.js + reconcile.js).
 */

import { probeRoutes } from './probe.js';
import { reconcile }   from './reconcile.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Map a reconcile gap (minimal canonical shape) → SPARDA's rich static-route
 * shape. The field set is byte-identical to what parseExpressProject /
 * parseFastAPIProject emit, so the generators need no branch for "is this
 * dynamic?". Provenance is carried in a non-consumed `source:'dynamic'` field.
 *
 * Path style mirrors the static parser per framework, so the manifest stays
 * uniform (R6):
 *   - express → ':id'  (the gap is already :id — keep it)
 *   - fastapi → '{id}' (convert :id → {id} to match static FastAPI routes)
 *
 * Confidence is ALWAYS 'low': a probed route proves only that {method, path}
 * exists — we never saw the handler, query params, or body schema.
 *
 * @param {{method:string, path:string, pathParams?:string[], writeClass?:'read'|'write'}} gap
 * @param {'express'|'fastapi'} framework
 */
export function gapToStaticRoute(gap, framework) {
  const method = (gap.method ?? 'GET').toUpperCase();
  const lower  = method.toLowerCase();
  const mutating = gap.writeClass ? gap.writeClass === 'write' : WRITE_METHODS.has(method);

  const path = framework === 'fastapi'
    ? (gap.path ?? '/').replace(/:([a-zA-Z_]\w*)/g, '{$1}')
    : (gap.path ?? '/');

  // Path params, in the exact param object the static parser uses.
  const params = (gap.pathParams ?? []).map((name) => ({
    name, in: 'path', type: 'string', required: true, description: 'path parameter',
  }));
  // Mirror the static parser: mutating routes get a body param (schema unknown).
  if (mutating) {
    params.push({
      name: 'body', in: 'body', type: 'object', required: false,
      description: 'JSON body — schema not statically detected',
    });
  }

  return {
    method: lower,
    path,
    handlerName: `dynamic_${lower}_${(gap.pathParams ?? []).join('_') || 'route'}`,
    sourceFile: '(runtime probe)',
    sourceLine: 0,
    params,
    description: 'Discovered at runtime via --probe; not found by static analysis.',
    mutating,
    confidence: 'low',   // never statically verified → always low
    source: 'dynamic',
  };
}

/**
 * Probe the live app, reconcile against the static floor, and return the
 * probe-only routes enriched to SPARDA's rich shape (ready to append to the
 * `routes` array the generators consume).
 *
 * @param {{framework:'express'|'fastapi', entryFile:string, projectRoot:string, staticRoutes:object[], timeoutMs?:number}} args
 * @returns {Promise<{ added:object[], gaps:object[], staticCount:number, dynamicCount:number, probedCount:number }>}
 *   added       — gaps enriched to SPARDA's rich shape (append these to `routes`)
 *   gaps        — the raw minimal gaps (stored in the scan-report for provenance)
 *   probedCount — how many routes the probe observed (0 ⇒ probe degraded / nothing seen)
 */
export async function discoverDynamicRoutes({ framework, entryFile, projectRoot, staticRoutes, timeoutMs = 8000 }) {
  const probed = await probeRoutes({ framework, entryFile, projectRoot, timeoutMs });
  const { gaps, staticCount, dynamicCount } = reconcile(staticRoutes, probed);

  // Defensive: the probe should not emit duplicate (method, path) pairs, but
  // reconcile does not dedup gaps among themselves. Collapse here so we never
  // synthesize two identical tools.
  const seen = new Set();
  const uniqueGaps = gaps.filter((g) => {
    const k = `${g.method} ${g.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const added = uniqueGaps.map((g) => gapToStaticRoute(g, framework));
  return { added, gaps: uniqueGaps, staticCount, dynamicCount: added.length, probedCount: probed.length };
}
