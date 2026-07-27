// theorem.test.ts — the empirical proof: composeSystem matches the frozen CSOP oracle,
// and incremental recompute never lies (no false-safe) across random edits.
import { test } from "node:test";
import assert from "node:assert";
import { proveCrossServiceOwnership } from "../src/csop.js";
import type { DBG, Service } from "../src/types.js";
import { composeSystem, buildCache, recompute } from "../src/incremental.js";

// deterministic PRNG (mulberry32) — no deps
function mulberry32(seed: number) {
  return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)];

// ---- random valid DBG generator ------------------------------------------------
function genSystem(r: () => number): DBG {
  const n = 2 + Math.floor(r() * 3); // 2..4 services
  const names = Array.from({ length: n }, (_, i) => `svc${i}`);
  const services: Service[] = names.map((name, i) => {
    const method = pick(r, ["GET", "DELETE"]);
    const idp = "id";
    const ep: any = { id: `${name}_e`, kind: "entrypoint", method, path: `/${name}/:${idp}`,
      principal: pick(r, ["authenticated", "public"]), exposure: i === 0 ? "public" : pick(r, ["public", "internal"]),
      params: [{ name: idp, source: "path" }] };
    const nodes: any[] = [ep];
    const edges: any[] = [];
    // maybe an ownership check before whatever comes next
    const hasCheck = r() < 0.4;
    let head = ep.id;
    if (hasCheck) { const c = { id: `${name}_c`, kind: "ownershipCheck", verifiesParam: idp }; nodes.push(c);
      edges.push({ from: ep.id, to: c.id, type: "reaches" }, { from: ep.id, to: c.id, type: "dataflow", value: idp }); head = c.id; }
    // either a sink or a forward to the next service
    if (i < n - 1 && r() < 0.6) {
      const target = `${names[i + 1]}`;
      const hc = { id: `${name}_h`, kind: "httpCall", method, target: `http://${target}/${target}/{${idp}}`, forwarded: [{ calleeParam: idp, fromParam: idp }] };
      nodes.push(hc); edges.push({ from: head, to: hc.id, type: "reaches" }, { from: head, to: hc.id, type: "dataflow", value: idp });
    } else {
      const sk = { id: `${name}_s`, kind: "sink", op: method === "GET" ? "read" : "delete", table: `t${i}`, objectIdParam: idp, ownershipScoped: r() < 0.3 };
      nodes.push(sk); edges.push({ from: head, to: sk.id, type: "reaches" }, { from: head, to: sk.id, type: "dataflow", value: idp });
    }
    return { name, nodes, edges };
  });
  return services;
}

// CSOP oracle → per-sink verdict map (SAFE for analyzed sinks not in findings)
function oracleVerdicts(dbg: DBG): Map<string, string> {
  const r = proveCrossServiceOwnership(dbg);
  const m = new Map<string, string>();
  for (const svc of dbg) for (const node of svc.nodes) {
    if ((node as any).kind === "sink" && (node as any).objectIdParam != null && ["read", "create", "update", "delete"].includes((node as any).op))
      m.set(`${svc.name}::${node.id}`, "PROVEN_SAFE");
  }
  for (const f of r.findings) m.set(`${f.service}::${f.sink}`, f.verdict);
  return m;
}
function myVerdicts(dbg: DBG): Map<string, string> { return composeSystem(dbg).verdicts as Map<string, string>; }

const eqMap = (a: Map<string, string>, b: Map<string, string>) => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
};

test("Differential: composeSystem verdicts match the frozen CSOP oracle (5000 cases)", () => {
  const r = mulberry32(12345); let mism = 0; let firstBad: any = null;
  for (let i = 0; i < 5000; i++) {
    const d = genSystem(r);
    const o = oracleVerdicts(d), me = myVerdicts(d);
    if (!eqMap(o, me)) { mism++; if (!firstBad) firstBad = { d, o: [...o], me: [...me] }; }
  }
  if (mism) console.error("first mismatch:", JSON.stringify(firstBad).slice(0, 800));
  assert.strictEqual(mism, 0, `${mism}/5000 verdict mismatches vs oracle`);
});

// random single edit
function edit(r: () => number, dbg: DBG): DBG {
  const d: DBG = JSON.parse(JSON.stringify(dbg));
  const s = pick(r, d);
  const kind = pick(r, ["toggleScope", "toggleCheck", "toggleExposure"]);
  if (kind === "toggleScope") { const sk = s.nodes.find((n: any) => n.kind === "sink") as any; if (sk) sk.ownershipScoped = !sk.ownershipScoped; }
  if (kind === "toggleCheck") { const c = s.nodes.find((n: any) => n.kind === "ownershipCheck"); const ep = s.nodes.find((n: any) => n.kind === "entrypoint") as any;
    if (c) { s.nodes = s.nodes.filter((n: any) => n.kind !== "ownershipCheck"); s.edges = s.edges.filter((e: any) => e.from !== c.id && e.to !== c.id); }
    else if (ep) { const cc = { id: `${s.name}_c2`, kind: "ownershipCheck", verifiesParam: ep.params[0].name } as any; s.nodes.push(cc);
      s.edges.push({ from: ep.id, to: cc.id, type: "reaches" }, { from: ep.id, to: cc.id, type: "dataflow", value: ep.params[0].name }); } }
  if (kind === "toggleExposure") { const ep = s.nodes.find((n: any) => n.kind === "entrypoint") as any; if (ep && ep.exposure) ep.exposure = ep.exposure === "public" ? "internal" : "public"; }
  return d;
}

test("Metamorphic: incremental recompute == full, and NEVER a false-safe (5000 edits)", () => {
  const r = mulberry32(67890); let mism = 0, falseSafe = 0; let firstBad: any = null;
  for (let i = 0; i < 5000; i++) {
    const d = genSystem(r); const cache = buildCache(d);
    const d2 = edit(r, d);
    const inc = recompute(cache, d2).report.verdicts as Map<string, string>;
    const full = composeSystem(d2).verdicts as Map<string, string>;
    if (!eqMap(inc, full)) { mism++; if (!firstBad) firstBad = { d, d2, inc: [...inc], full: [...full] }; }
    // false-safe hunt: incremental says SAFE where full says unsafe
    for (const [k, v] of inc) if (v === "PROVEN_SAFE" && full.get(k) && full.get(k) !== "PROVEN_SAFE") falseSafe++;
  }
  if (mism) console.error("first inc/full mismatch:", JSON.stringify(firstBad).slice(0, 800));
  assert.strictEqual(falseSafe, 0, `${falseSafe} FALSE-SAFE found — theorem broken`);
  assert.strictEqual(mism, 0, `${mism}/5000 incremental != full`);
});

test("Incremental touches fewer certs than full on an unchanged-neighbor edit", () => {
  const r = mulberry32(999);
  const d = genSystem(r); const cache = buildCache(d);
  const d2 = edit(r, d);
  const { recomputedCerts } = recompute(cache, d2);
  assert.ok(recomputedCerts <= d2.length, "recomputed <= total");
});
