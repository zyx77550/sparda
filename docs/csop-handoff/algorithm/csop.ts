// Cross-Service Object-Ownership Proof — core algorithm
// Zero runtime dependencies. Deterministic. Sound.

import type {
  DBG,
  Service,
  Entrypoint,
  Sink,
  HttpCall,
  Report,
  Finding,
} from "./types.js";
import { MalformedInputError } from "./types.js";

// ------------------------------------------------------------------
// Label lattice
// ------------------------------------------------------------------
const enum Label {
  UNKNOWN = 0,
  CALLER_SUPPLIED = 1,
  OWNER_VERIFIED = 2,
}

/**
 * Merge two labels. UNKNOWN is the neutral element ("no information").
 * When two real labels conflict, the MORE SUSPICIOUS one wins:
 *   CALLER_SUPPLIED > OWNER_VERIFIED > UNKNOWN
 * This is the sound join: uncertainty never overrides real information,
 * but conflicting real information degrades to the most suspicious.
 */
function mergeLabel(a: Label, b: Label): Label {
  if (a === Label.UNKNOWN) return b;
  if (b === Label.UNKNOWN) return a;
  // Both real: more suspicious wins. CALLER_SUPPLIED (1) beats OWNER_VERIFIED (2)
  return a < b ? a : b;
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------
const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const VALID_PRINCIPALS = new Set(["authenticated", "public"]);
const VALID_SOURCES = new Set(["path", "query", "body", "header"]);
const VALID_OPS = new Set(["read", "create", "update", "delete"]);
const VALID_EDGE_TYPES = new Set(["reaches", "dataflow"]);
const VALID_KINDS = new Set(["entrypoint", "sink", "httpCall", "ownershipCheck"]);

function assertString(v: unknown, ctx: string): string {
  if (typeof v !== "string") throw new MalformedInputError(`${ctx} must be a string`);
  return v;
}

function assertBool(v: unknown, ctx: string): boolean {
  if (typeof v !== "boolean") throw new MalformedInputError(`${ctx} must be a boolean`);
  return v;
}

function validateDBG(dbg: unknown): DBG {
  if (!Array.isArray(dbg)) {
    throw new MalformedInputError("DBG must be an array");
  }
  const serviceNames = new Set<string>();
  for (const svc of dbg) {
    if (typeof svc !== "object" || svc === null) {
      throw new MalformedInputError("Each service must be an object");
    }
    const s = svc as Record<string, unknown>;
    const name = assertString(s.name, "service.name");
    if (serviceNames.has(name)) {
      throw new MalformedInputError(`Duplicate service name: ${name}`);
    }
    serviceNames.add(name);

    if (!Array.isArray(s.nodes)) throw new MalformedInputError(`${name}: nodes must be an array`);
    if (!Array.isArray(s.edges)) throw new MalformedInputError(`${name}: edges must be an array`);

    const nodeIds = new Set<string>();
    for (const n of s.nodes) {
      if (typeof n !== "object" || n === null) {
        throw new MalformedInputError(`${name}: each node must be an object`);
      }
      const node = n as Record<string, unknown>;
      const id = assertString(node.id, "node.id");
      if (nodeIds.has(id)) {
        throw new MalformedInputError(`${name}: duplicate node id ${id}`);
      }
      nodeIds.add(id);

      const kind = assertString(node.kind, "node.kind");
      if (!VALID_KINDS.has(kind)) {
        throw new MalformedInputError(`${name}: invalid node kind ${kind}`);
      }

      if (kind === "entrypoint") {
        const method = assertString((node as any).method, "entrypoint.method");
        if (!VALID_METHODS.has(method)) {
          throw new MalformedInputError(`${name}: invalid entrypoint method ${method}`);
        }
        assertString((node as any).path, "entrypoint.path");
        const principal = assertString((node as any).principal, "entrypoint.principal");
        if (!VALID_PRINCIPALS.has(principal)) {
          throw new MalformedInputError(`${name}: invalid principal ${principal}`);
        }
        const exposure = (node as any).exposure;
        if (exposure !== undefined && exposure !== "public" && exposure !== "internal") {
          throw new MalformedInputError(`${name}: invalid exposure ${exposure}`);
        }
        const params = (node as any).params;
        if (!Array.isArray(params)) {
          throw new MalformedInputError(`${name}: entrypoint.params must be an array`);
        }
        for (const p of params) {
          if (typeof p !== "object" || p === null) {
            throw new MalformedInputError(`${name}: param must be an object`);
          }
          assertString((p as any).name, "param.name");
          const source = assertString((p as any).source, "param.source");
          if (!VALID_SOURCES.has(source)) {
            throw new MalformedInputError(`${name}: invalid param source ${source}`);
          }
        }
      } else if (kind === "sink") {
        const op = assertString((node as any).op, "sink.op");
        if (!VALID_OPS.has(op)) {
          throw new MalformedInputError(`${name}: invalid sink op ${op}`);
        }
        assertString((node as any).table, "sink.table");
        const oid = (node as any).objectIdParam;
        if (oid !== null && typeof oid !== "string") {
          throw new MalformedInputError(`${name}: sink.objectIdParam must be string or null`);
        }
        assertBool((node as any).ownershipScoped, "sink.ownershipScoped");
      } else if (kind === "httpCall") {
        const method = assertString((node as any).method, "httpCall.method");
        if (!VALID_METHODS.has(method)) {
          throw new MalformedInputError(`${name}: invalid httpCall method ${method}`);
        }
        assertString((node as any).target, "httpCall.target");
        const forwarded = (node as any).forwarded;
        if (!Array.isArray(forwarded)) {
          throw new MalformedInputError(`${name}: httpCall.forwarded must be an array`);
        }
        for (const f of forwarded) {
          if (typeof f !== "object" || f === null) {
            throw new MalformedInputError(`${name}: forwarded item must be an object`);
          }
          assertString((f as any).calleeParam, "forwarded.calleeParam");
          assertString((f as any).fromParam, "forwarded.fromParam");
        }
      } else if (kind === "ownershipCheck") {
        assertString((node as any).verifiesParam, "ownershipCheck.verifiesParam");
      }
    }

    for (const e of s.edges) {
      if (typeof e !== "object" || e === null) {
        throw new MalformedInputError(`${name}: each edge must be an object`);
      }
      const edge = e as Record<string, unknown>;
      const from = assertString(edge.from, "edge.from");
      const to = assertString(edge.to, "edge.to");
      const type = assertString(edge.type, "edge.type");
      if (!VALID_EDGE_TYPES.has(type)) {
        throw new MalformedInputError(`${name}: invalid edge type ${type}`);
      }
      if (!nodeIds.has(from)) {
        throw new MalformedInputError(`${name}: edge.from ${from} references non-existent node`);
      }
      if (!nodeIds.has(to)) {
        throw new MalformedInputError(`${name}: edge.to ${to} references non-existent node`);
      }
      if (type === "dataflow") {
        if (typeof edge.value !== "string") {
          throw new MalformedInputError(`${name}: dataflow edge must have string value`);
        }
      }
    }
  }
  return dbg as DBG;
}

// ------------------------------------------------------------------
// Host / path extraction for stitching
// ------------------------------------------------------------------
function extractHost(raw: string): string | null {
  const schemeIdx = raw.indexOf("://");
  if (schemeIdx === -1) return null;
  const afterScheme = raw.slice(schemeIdx + 3);
  const firstSlash = afterScheme.indexOf("/");
  const hostPort = firstSlash === -1 ? afterScheme : afterScheme.slice(0, firstSlash);
  const colonIdx = hostPort.indexOf(":");
  const host = colonIdx === -1 ? hostPort : hostPort.slice(0, colonIdx);
  return host.length > 0 ? host.toLowerCase() : null;
}

function hostMatchesService(host: string, serviceName: string): boolean {
  const h = host.toLowerCase();
  const s = serviceName.toLowerCase();
  if (h === s) return true;
  // Subdomain match: "backend.svc.local" → "backend"
  const firstLabel = h.split(".")[0];
  if (firstLabel === s) return true;
  return false;
}

function normalizePath(raw: string): string[] {
  let path = raw;
  const schemeIdx = path.indexOf("://");
  if (schemeIdx !== -1) {
    const afterScheme = path.slice(schemeIdx + 3);
    const firstSlash = afterScheme.indexOf("/");
    if (firstSlash === -1) {
      path = "/";
    } else {
      path = afterScheme.slice(firstSlash);
    }
  }
  const qIdx = path.indexOf("?");
  if (qIdx !== -1) path = path.slice(0, qIdx);
  const fIdx = path.indexOf("#");
  if (fIdx !== -1) path = path.slice(0, fIdx);
  path = path.toLowerCase();
  const segments = path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => {
      if (s.startsWith(":") || s.startsWith("{") || s === "*") return "*";
      return s;
    });
  return segments;
}

function stitchServices(dbg: DBG): {
  fromService: string;
  fromCall: string;
  toService: string;
  toEntrypoint: string;
  method: string;
  path: string;
}[] {
  const entrypoints: { svc: string; ep: Entrypoint; segs: string[] }[] = [];
  const httpCalls: { svc: string; hc: HttpCall; segs: string[] }[] = [];

  for (const svc of dbg) {
    for (const n of svc.nodes) {
      if (n.kind === "entrypoint") {
        entrypoints.push({ svc: svc.name, ep: n, segs: normalizePath(n.path) });
      } else if (n.kind === "httpCall") {
        httpCalls.push({ svc: svc.name, hc: n, segs: normalizePath(n.target) });
      }
    }
  }

  const stitched: ReturnType<typeof stitchServices> = [];

  for (const hc of httpCalls) {
    const host = extractHost(hc.hc.target);

    // First pass: collect all candidates by path suffix
    const candidates: typeof entrypoints = [];
    for (const ep of entrypoints) {
      if (hc.svc === ep.svc) continue;
      if (hc.hc.method !== ep.ep.method) continue;

      const callee = ep.segs;
      const caller = hc.segs;
      if (callee.length > caller.length) continue;

      let match = true;
      for (let i = 0; i < callee.length; i++) {
        const c = caller[caller.length - callee.length + i];
        const e = callee[i];
        if (c !== "*" && e !== "*" && c !== e) {
          match = false;
          break;
        }
      }
      if (!match) continue;
      candidates.push(ep);
    }

    // Host-aware filtering: if the target URL names a host and a candidate
    // service matches that host, prefer it. Otherwise keep all candidates.
    let filtered = candidates;
    if (host) {
      const hostMatches = candidates.filter((ep) => hostMatchesService(host, ep.svc));
      if (hostMatches.length > 0) {
        filtered = hostMatches;
      }
    }

    for (const ep of filtered) {
      stitched.push({
        fromService: hc.svc,
        fromCall: hc.hc.id,
        toService: ep.svc,
        toEntrypoint: ep.ep.id,
        method: hc.hc.method,
        path: hc.hc.target,
      });
    }
  }

  stitched.sort((a, b) => {
    if (a.fromService !== b.fromService) return a.fromService.localeCompare(b.fromService);
    if (a.fromCall !== b.fromCall) return a.fromCall.localeCompare(b.fromCall);
    if (a.toService !== b.toService) return a.toService.localeCompare(b.toService);
    return a.toEntrypoint.localeCompare(b.toEntrypoint);
  });

  return stitched;
}

// ------------------------------------------------------------------
// Local graph helpers
// ------------------------------------------------------------------
function buildReachesAdj(service: Service): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of service.edges) {
    if (e.type !== "reaches") continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  return adj;
}

function buildDataflowAdj(service: Service): Map<string, { to: string; value: string }[]> {
  const adj = new Map<string, { to: string; value: string }[]>();
  for (const e of service.edges) {
    if (e.type !== "dataflow" || !e.value) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push({ to: e.to, value: e.value });
  }
  return adj;
}

function reachableFrom(starts: string[], adj: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const stack = [...starts];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const nxt of adj.get(cur) || []) {
      if (!visited.has(nxt)) stack.push(nxt);
    }
  }
  return visited;
}

/**
 * For each value name, compute the set of nodes that are reachable from an
 * OwnershipCheck that verifies that value, where the check itself is reachable
 * from an entrypoint.  Used as a QUERY (not a loop mutation).
 */
function computePromotedNodes(service: Service): Map<string, Set<string>> {
  const reachesAdj = buildReachesAdj(service);
  const entrypointIds = service.nodes
    .filter((n): n is Entrypoint => n.kind === "entrypoint")
    .map((e) => e.id);

  const reachableFromEntrypoints = reachableFrom(entrypointIds, reachesAdj);
  const result = new Map<string, Set<string>>();

  for (const node of service.nodes) {
    if (node.kind !== "ownershipCheck") continue;
    if (!reachableFromEntrypoints.has(node.id)) continue;

    const reachableFromCheck = reachableFrom([node.id], reachesAdj);
    const v = node.verifiesParam;
    if (!result.has(v)) result.set(v, new Set());
    for (const n of reachableFromCheck) {
      result.get(v)!.add(n);
    }
  }
  return result;
}

// ------------------------------------------------------------------
// Main algorithm
// ------------------------------------------------------------------
export function proveCrossServiceOwnership(dbg: DBG): Report {
  const validated = validateDBG(dbg);

  const serviceMap = new Map<string, Service>();
  for (const svc of validated) serviceMap.set(svc.name, svc);

  const stitchedEdges = stitchServices(validated);

  // Per-service state: svc -> nodeId -> value -> { label, cb, path }
  type ValueState = { label: Label; cb: boolean; path: string[] };
  type NodeState = Map<string, ValueState>;
  type ServiceState = Map<string, NodeState>;
  const state = new Map<string, ServiceState>();

  function getState(svc: string, nodeId: string, value: string): ValueState {
    if (!state.has(svc)) state.set(svc, new Map());
    const ns = state.get(svc)!;
    if (!ns.has(nodeId)) ns.set(nodeId, new Map());
    const vs = ns.get(nodeId)!;
    if (!vs.has(value)) {
      vs.set(value, { label: Label.UNKNOWN, cb: false, path: [svc] });
    }
    return vs.get(value)!;
  }

  /**
   * Update state.  Convergence is driven ONLY by the monotone lattice state
   * (label, cb).  Path is metadata and must NOT gate the fixed-point loop.
   */
  function setState(
    svc: string,
    nodeId: string,
    value: string,
    label: Label,
    cb: boolean,
    path: string[]
  ): boolean {
    const cur = getState(svc, nodeId, value);
    const latticeChanged = cur.label !== label || cur.cb !== cb;
    if (latticeChanged) {
      cur.label = label;
      cur.cb = cb;
      cur.path = path;
    }
    return latticeChanged;
  }

  // Pre-compute promoted nodes per service (used as queries, not mutations)
  const promotedByService = new Map<string, Map<string, Set<string>>>();
  for (const svc of validated) {
    promotedByService.set(svc.name, computePromotedNodes(svc));
  }

  // ----------------------------------------------------------------
  // Step 1 — fixed-point loop (downward-only, guaranteed termination)
  // ----------------------------------------------------------------
  let changed = true;
  while (changed) {
    changed = false;

    // ---- 1. Forward across stitched edges ----
    for (const se of stitchedEdges) {
      const callerSvc = serviceMap.get(se.fromService)!;
      const callerNode = callerSvc.nodes.find((n) => n.id === se.fromCall);
      if (!callerNode || callerNode.kind !== "httpCall") continue;

      const calleeSvc = serviceMap.get(se.toService)!;
      const calleeNode = calleeSvc.nodes.find((n) => n.id === se.toEntrypoint);
      if (!calleeNode || calleeNode.kind !== "entrypoint") continue;

      // Query: is there an OwnershipCheck for this value that dominates the httpCall?
      const callerPromoted = promotedByService.get(se.fromService)!;

      for (const f of callerNode.forwarded) {
        const callerSt = getState(se.fromService, se.fromCall, f.fromParam);
        if (callerSt.label === Label.UNKNOWN) continue;

        const calleeParam = (calleeNode as Entrypoint).params.find((p) => p.name === f.calleeParam);
        if (!calleeParam) continue;

        const cur = getState(se.toService, se.toEntrypoint, f.calleeParam);

        // If the caller proved ownership before forwarding, the forwarded label is OWNER_VERIFIED.
        const isVerifiedForward = callerPromoted.get(f.fromParam)?.has(se.fromCall) ?? false;
        const forwardedLabel = isVerifiedForward ? Label.OWNER_VERIFIED : callerSt.label;

        const newLabel = mergeLabel(cur.label, forwardedLabel);
        const newCB = true;
        const newPath = [...callerSt.path, se.toService];

        if (setState(se.toService, se.toEntrypoint, f.calleeParam, newLabel, newCB, newPath)) {
          changed = true;
        }
      }
    }

    // ---- 2. Seed entrypoint params that are still UNKNOWN ----
    // Only public entrypoints are directly attackable; internal ones are
    // reachable only via stitched forwards and start as UNKNOWN.
    for (const svc of validated) {
      for (const node of svc.nodes) {
        if (node.kind !== "entrypoint") continue;
        if (node.exposure === "internal") continue;
        for (const p of node.params) {
          const st = getState(svc.name, node.id, p.name);
          if (st.label === Label.UNKNOWN) {
            if (setState(svc.name, node.id, p.name, Label.CALLER_SUPPLIED, false, [svc.name])) {
              changed = true;
            }
          }
        }
      }
    }

    // ---- 3. Propagate dataflow ----
    for (const svc of validated) {
      const dfAdj = buildDataflowAdj(svc);
      for (const [fromId, outs] of dfAdj) {
        for (const { to: toId, value } of outs) {
          const fromSt = getState(svc.name, fromId, value);
          if (fromSt.label === Label.UNKNOWN) continue;

          const toSt = getState(svc.name, toId, value);
          const newLabel = mergeLabel(toSt.label, fromSt.label);
          const newCB = toSt.cb || fromSt.cb;

          // Carry the provenance path across dataflow edges.
          // Keep the LONGEST boundary-crossing path (full trail), not the shortest.
          // Tie-break equal-length paths lexicographically for determinism.
          let newPath: string[];
          if (newCB) {
            // At least one side crossed a boundary: prefer the longer trail.
            const fromLen = fromSt.cb ? fromSt.path.length : 0;
            const toLen = toSt.cb ? toSt.path.length : 0;
            if (fromLen > toLen) {
              newPath = fromSt.path;
            } else if (toLen > fromLen) {
              newPath = toSt.path;
            } else {
              // Same length (or neither has cb): lexicographic tie-break
              const aStr = fromSt.path.join(">");
              const bStr = toSt.path.join(">");
              newPath = aStr <= bStr ? fromSt.path : toSt.path;
            }
          } else {
            // Local-only: deterministic tie-break by lexicographic order.
            const aStr = toSt.path.join(">");
            const bStr = fromSt.path.join(">");
            newPath = aStr <= bStr ? toSt.path : fromSt.path;
          }

          if (setState(svc.name, toId, value, newLabel, newCB, newPath)) {
            changed = true;
          }
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // Step 2 — final per-sink verdict (no loop, just queries)
  // ----------------------------------------------------------------
  let sinksAnalyzed = 0;
  let provenSafe = 0;
  let unprovenLocal = 0;
  let unprovenXService = 0;
  const findings: Finding[] = [];

  for (const svc of validated) {
    const promoted = promotedByService.get(svc.name)!;

    for (const node of svc.nodes) {
      if (node.kind !== "sink") continue;
      if (node.objectIdParam === null) continue;
      if (!VALID_OPS.has(node.op)) continue;

      sinksAnalyzed++;
      const st = getState(svc.name, node.id, node.objectIdParam);

      // Is this sink on a reaches path after an OwnershipCheck for this value?
      const locallyVerified = promoted.get(node.objectIdParam)?.has(node.id) ?? false;

      if (st.label === Label.OWNER_VERIFIED || node.ownershipScoped || locallyVerified) {
        provenSafe++;
        continue;
      }

      const objectIdLabel: "CALLER_SUPPLIED" | "UNKNOWN" =
        st.label === Label.CALLER_SUPPLIED ? "CALLER_SUPPLIED" : "UNKNOWN";

      if (st.cb) {
        unprovenXService++;
        findings.push({
          verdict: "UNPROVEN_XSERVICE",
          service: svc.name,
          sink: node.id,
          table: node.table,
          op: node.op,
          objectIdLabel,
          path: st.path.length > 0 ? st.path : [svc.name],
          message:
            `Cross-service object-level ${node.op} on '${node.table}' uses a ` +
            `caller-supplied id that was never verified against the authenticated principal.`,
        });
      } else {
        unprovenLocal++;
        findings.push({
          verdict: "UNPROVEN_LOCAL",
          service: svc.name,
          sink: node.id,
          table: node.table,
          op: node.op,
          objectIdLabel,
          path: [svc.name],
          message:
            `Local object-level ${node.op} on '${node.table}' uses a ` +
            `caller-supplied id that was never verified against the authenticated principal.`,
        });
      }
    }
  }

  findings.sort((a, b) => {
    const rankA = a.verdict === "UNPROVEN_XSERVICE" ? 0 : 1;
    const rankB = b.verdict === "UNPROVEN_XSERVICE" ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    if (a.service !== b.service) return a.service.localeCompare(b.service);
    return a.sink.localeCompare(b.sink);
  });

  const report: Report = {
    summary: {
      services: validated.length,
      stitchedEdges: stitchedEdges.length,
      sinksAnalyzed,
      provenSafe,
      unprovenLocal,
      unprovenXService,
    },
    crossServiceEdges: stitchedEdges.map((se) => ({
      fromService: se.fromService,
      fromCall: se.fromCall,
      toService: se.toService,
      toEntrypoint: se.toEntrypoint,
      method: se.method,
      path: se.path,
    })),
    findings,
  };

  return report;
}
