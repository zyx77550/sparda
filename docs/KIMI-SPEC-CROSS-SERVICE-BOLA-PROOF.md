# Clean-room spec — Cross-Service Object-Ownership Proof (CSOP)

> **For the implementer (Kimi).** You are building ONE self-contained algorithm + reference
> implementation + test suite. You do **not** have, and do **not** need, any other codebase.
> Everything required is in this document: the input format, the algorithm, the output format,
> the soundness rules, and worked examples with exact expected outputs. Build strictly to this
> spec. If something is ambiguous, choose the **soundest** interpretation (the one that never
> declares an unsafe access "safe") and note it.
>
> **Language:** TypeScript (Node ≥ 18, ESM). Zero runtime dependencies. Deterministic:
> same input → byte-identical output, always. No network, no filesystem, no clock, no randomness.

---

## 1. What this is, and why it is new

Every static security tool today (CodeQL, Semgrep, Snyk, and the BolaRay 2024 research
prototype) analyzes **one repository at a time**. So this class of bug is invisible to all of
them:

> Service **A** authenticates a user, but forwards a **caller-supplied object id** to service
> **B** over HTTP. Service **B** trusts that id and mutates the object **without checking it
> belongs to the caller.** No single repo contains the whole path, so no mono-repo tool can see
> that the object-level authorization is broken **across the A→B boundary.**

This is **cross-service BOLA / IDOR** (Broken Object-Level Authorization, OWASP API #1). The
algorithm below **proves or refutes** it by propagating an *ownership label* along the object
id, **across service boundaries**, over a set of independently-produced service graphs. That
cross-service ownership proof is the novel contribution — no published tool does it.

---

## 2. Input — the Distributed Behavior Graph (DBG)

The input is a JSON array of **services**. Each service is a directed graph that some upstream
compiler already produced (you do NOT produce it — you consume it). The schema below is the
**complete, closed contract**; assume nothing beyond it.

```jsonc
// Input type
type DBG = Service[];

interface Service {
  name: string;                 // unique, e.g. "orders-api"
  nodes: Node[];
  edges: Edge[];
}

type Node = Entrypoint | Sink | HttpCall | OwnershipCheck;

interface Entrypoint {
  id: string;                   // unique within the service
  kind: "entrypoint";
  method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE";
  path: string;                 // e.g. "/orders/:id"  (params as :name, {name}, or *)
  principal: "authenticated" | "public";
  // the request-supplied inputs this route exposes, each a potential object id
  params: { name: string; source: "path"|"query"|"body"|"header" }[];
}

interface Sink {
  id: string;
  kind: "sink";                 // an object-level DB access or mutation
  op: "read"|"create"|"update"|"delete";
  table: string;                // resource table, e.g. "order"
  // which value identifies the object being accessed; references a param name
  // that flows here (see dataflow edges). null = not identified by a request value.
  objectIdParam: string | null;
  // TRUE only if the query provably binds the object to the caller's principal
  // (e.g. `where { id, workspaceId: session.workspaceId }`). Producer sets this;
  // if unknown, it MUST be false (never optimistic).
  ownershipScoped: boolean;
}

interface HttpCall {
  id: string;
  kind: "httpCall";             // an outbound call to another service
  method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE";
  target: string;               // outbound URL or path, e.g. "http://orders/api/orders/{id}"
  // which of THIS service's param values are forwarded, and under what name at the callee
  forwarded: { calleeParam: string; fromParam: string }[];
}

interface OwnershipCheck {
  id: string;
  kind: "ownershipCheck";       // a proven check that binds a value to the principal
  // the param whose value is verified to belong to the authenticated principal
  // (e.g. `getOrderOrThrow({ id, workspaceId: session.workspaceId })`)
  verifiesParam: string;
}

interface Edge {
  from: string;                 // node id
  to: string;                   // node id
  type: "reaches" | "dataflow";
  // for dataflow edges: the value/param name that flows along this edge
  value?: string;
}
```

Edge semantics:
- **`reaches`**: control-flow reachability. `from` (an entrypoint or a node) can reach `to`
  on some execution path. Used to know which sinks/calls/checks a route can hit, and their order.
- **`dataflow`**: the value named in `value` flows from `from` to `to`. Used to know that an
  entrypoint param reaches a sink's `objectIdParam`, an httpCall's forwarded param, or an
  ownership check's `verifiesParam`.

**Ordering:** when both a `reaches` path and a `dataflow` exist, an `OwnershipCheck` counts as
occurring *before* a `Sink` on a path iff there is a `reaches` path `entrypoint → … → check →
… → sink` (the check node is an ancestor of the sink on that reach path).

---

## 3. The ownership lattice

Every object-id value carries exactly one label. This is a total order (join = max):

```
OWNER_VERIFIED   (2)  — provably bound to the authenticated caller's principal
CALLER_SUPPLIED  (1)  — comes from request input, NOT verified against the principal
UNKNOWN          (0)  — provenance not determinable
```

**Join rule (when two labels meet the same value):** take the **lower** (more suspicious) of
the two. `min(OWNER_VERIFIED, CALLER_SUPPLIED) = CALLER_SUPPLIED`. Never let an optimistic
label win. (This is what makes the analysis *sound*: uncertainty degrades to suspicion.)

**Initial labels:**
- An entrypoint param with `source ∈ {path, query, body, header}` on a `public` route → `CALLER_SUPPLIED`.
- On an `authenticated` route, a param is still `CALLER_SUPPLIED` **until** an `OwnershipCheck`
  verifies it. Authentication proves *who you are*, never *that this object is yours*. (This
  distinction is the entire point of BOLA.)
- Anything else / not determinable → `UNKNOWN`.

**Promotion:** a value becomes `OWNER_VERIFIED` **only** when an `OwnershipCheck` node with
`verifiesParam === value` lies on the reach path **before** the sink that consumes it. Nothing
else promotes a label. No name heuristic, no "looks authed" — only a structural check node.

---

## 4. Cross-service propagation (the novel core)

Build the stitched graph, then propagate labels across service boundaries:

**4.1 Stitch — match each `HttpCall` to a callee `Entrypoint`:**
- Normalize both paths to segment lists: strip scheme+host+query, lowercase, collapse every
  parameter segment (`:x`, `{x}`, `*`) to the token `*`.
- Match iff **methods are equal** AND the callee's segments are a **suffix** of the caller's
  target segments (so a base-URL prefix like `/api/v1` still matches). `*` matches any segment.
- Never stitch a service to itself.

**4.2 Propagate the forwarded label:**
- For each stitched edge A.httpCall → B.entrypoint, and for each `forwarded { calleeParam,
  fromParam }`: the label of `fromParam` **in A** (as computed within A, see §5) becomes an
  **incoming label** for `calleeParam` **in B**, joined (min) with whatever B already had.
- Concretely: if A forwards a `CALLER_SUPPLIED` id to B, then inside B that param starts as
  `CALLER_SUPPLIED` **even if B's own entrypoint is `authenticated`** — because the id came
  from A's caller, not from B's own verified principal. This is the crux: **B cannot trust an
  id that A forwarded unless A proved ownership before forwarding.**
- If A promoted the id to `OWNER_VERIFIED` (an ownership check on A's path before the httpCall)
  **and** the principal is carried across (see soundness note §6.3), the forwarded label may be
  `OWNER_VERIFIED`. If in doubt → `CALLER_SUPPLIED`.

**4.3 Fixed point:** propagation may chain (A→B→C). Iterate the whole label assignment to a
fixed point (labels only ever move downward under `min`, so termination is guaranteed).

---

## 5. The algorithm (deterministic)

```
function proveCrossServiceOwnership(dbg: DBG): Report {
  1. Parse & validate every service graph against the schema. On any malformed node/edge,
     abort with a typed error { code: "MALFORMED_INPUT", detail }. Never guess.

  2. For each service independently, compute the LOCAL label of every param at every sink:
     - seed entrypoint params per §3 (initial labels).
     - propagate along dataflow edges (a value keeps its label as it flows).
     - promote to OWNER_VERIFIED at a value iff an OwnershipCheck(verifiesParam=value) is an
       ancestor of the consuming sink on a `reaches` path (§3 ordering).
     - at each sink, the label of the object id = label of the param named objectIdParam
       flowing into it (UNKNOWN if none).

  3. Stitch services (§4.1) → cross-service edges.

  4. Propagate forwarded labels across edges to a fixed point (§4.2, §4.3), re-running step 2's
     promotion locally in each callee after each incoming label update (an ownership check
     inside B can still promote an id B received as CALLER_SUPPLIED).

  5. Emit an obligation for every object-mutating or object-reading sink S (op ∈
     {read,update,delete,create-with-supplied-id}) whose objectIdParam ≠ null:

       verdict(S) =
         PROVEN_SAFE      if finalLabel(objectId@S) == OWNER_VERIFIED
                          OR S.ownershipScoped == true
         UNPROVEN_LOCAL   if not safe AND the id never crossed a service boundary
         UNPROVEN_XSERVICE if not safe AND the id reached S via ≥1 stitched edge
                           (i.e. a caller-supplied id crossed A→…→S unverified)

  6. Return the Report (§7). Deterministic ordering: sort findings by
     (verdict rank: XSERVICE < LOCAL < SAFE-omitted, then service name, then sink id).
}
```

**Only `UNPROVEN_XSERVICE` and `UNPROVEN_LOCAL` are emitted as findings.** `PROVEN_SAFE` sinks
are counted, not listed. `UNPROVEN_XSERVICE` is the novel signal — the cross-service BOLA.

---

## 6. Soundness invariants — NON-NEGOTIABLE

These define correctness. A build that violates any of them is wrong even if all examples pass.

1. **Never a false SAFE.** If ownership cannot be *proven*, the verdict is UNPROVEN, never SAFE.
   Uncertainty (UNKNOWN, missing data, ambiguous stitch) always degrades to suspicion.
2. **Authentication ≠ ownership.** An `authenticated` entrypoint never, by itself, promotes an
   id to OWNER_VERIFIED. Only an explicit `OwnershipCheck` on the path does.
3. **A forwarded id is caller-supplied at the callee** unless the caller proved ownership
   *before* forwarding it. When unsure whether the principal is carried across the boundary,
   assume it is NOT → `CALLER_SUPPLIED`.
4. **Advisory, never gating.** The output is a report a human reviews. It assigns no pass/fail
   build status. (Downstream consumers may, but this algorithm does not.)
5. **Deterministic & pure.** No network/fs/clock/random. Same input → identical output. All
   ordering is total and specified (§5.6).
6. **Fail loud on malformed input.** Never silently drop a node/edge you don't understand;
   abort with `MALFORMED_INPUT`. A dropped node could hide a real finding.

---

## 7. Output — the Report

```jsonc
interface Report {
  summary: {
    services: number;
    stitchedEdges: number;
    sinksAnalyzed: number;
    provenSafe: number;
    unprovenLocal: number;
    unprovenXService: number;   // the headline number
  };
  crossServiceEdges: {
    fromService: string; fromCall: string;
    toService: string; toEntrypoint: string;
    method: string; path: string;
  }[];
  findings: {
    verdict: "UNPROVEN_XSERVICE" | "UNPROVEN_LOCAL";
    service: string;            // where the vulnerable sink lives
    sink: string;               // sink node id
    table: string;
    op: string;
    objectIdLabel: "CALLER_SUPPLIED" | "UNKNOWN";
    // for XSERVICE: the boundary path the id crossed, e.g. ["gateway", "orders-api"]
    path: string[];
    message: string;
  }[];
}
```

---

## 8. Worked examples (exact expected outputs)

### Example 1 — the real cross-service BOLA (the headline case)

Two services. A **gateway** (authenticated) forwards a caller-supplied `orderId` to an
**orders-api** that deletes by that id with no ownership scope. → **UNPROVEN_XSERVICE.**

```jsonc
[
  { "name": "gateway",
    "nodes": [
      { "id":"e1","kind":"entrypoint","method":"DELETE","path":"/orders/:orderId",
        "principal":"authenticated","params":[{"name":"orderId","source":"path"}] },
      { "id":"h1","kind":"httpCall","method":"DELETE","target":"http://orders/api/orders/{orderId}",
        "forwarded":[{"calleeParam":"id","fromParam":"orderId"}] }
    ],
    "edges":[
      {"from":"e1","to":"h1","type":"reaches"},
      {"from":"e1","to":"h1","type":"dataflow","value":"orderId"}
    ] },
  { "name":"orders-api",
    "nodes":[
      { "id":"e2","kind":"entrypoint","method":"DELETE","path":"/api/orders/:id",
        "principal":"public","params":[{"name":"id","source":"path"}] },
      { "id":"s2","kind":"sink","op":"delete","table":"order","objectIdParam":"id",
        "ownershipScoped":false }
    ],
    "edges":[
      {"from":"e2","to":"s2","type":"reaches"},
      {"from":"e2","to":"s2","type":"dataflow","value":"id"}
    ] }
]
```
**Expected:** `summary.unprovenXService === 1`. One finding: verdict `UNPROVEN_XSERVICE`,
service `orders-api`, sink `s2`, table `order`, objectIdLabel `CALLER_SUPPLIED`,
path `["gateway","orders-api"]`.

### Example 2 — the same shape but PROVEN SAFE (must NOT flag)

Identical, except the gateway verifies ownership before forwarding (an `OwnershipCheck` on
`orderId` before `h1`). The forwarded id is `OWNER_VERIFIED` → no finding.

Add to gateway nodes: `{ "id":"chk1","kind":"ownershipCheck","verifiesParam":"orderId" }`
and edges: `{"from":"e1","to":"chk1","type":"reaches"}`, `{"from":"chk1","to":"h1","type":"reaches"}`,
`{"from":"e1","to":"chk1","type":"dataflow","value":"orderId"}`.
**Expected:** `unprovenXService === 0`, `provenSafe === 1`, `findings === []`.

### Example 3 — local BOLA, no boundary crossed

A single service, authenticated route, deletes by a path id with no ownership check and no
scope. → **UNPROVEN_LOCAL** (not XSERVICE, since nothing was stitched).
**Expected:** `unprovenLocal === 1`, `unprovenXService === 0`, finding path `["orders-api"]`.

> Ship these three as executable tests plus, at minimum: a chain A→B→C (transitive forward),
> a stitch that must NOT match (method mismatch / non-suffix path), a malformed-input abort,
> and a determinism test (run twice, assert byte-identical output).

---

## 9. Deliverables & acceptance

1. `src/csop.ts` — the algorithm, exporting `proveCrossServiceOwnership(dbg): Report`.
2. `src/types.ts` — the interfaces above.
3. `test/csop.test.ts` — the 3 worked examples with their exact expected outputs + the extra
   cases listed in §8. Use any zero-dep test runner (node:test is fine).
4. `README.md` — how to run; a 6-line explanation of the lattice and the soundness stance.

**Acceptance:** all tests green; zero runtime deps; deterministic (the determinism test passes);
every §6 invariant demonstrably held (add one test per invariant, e.g. "authenticated route
alone never yields PROVEN_SAFE"). No network/fs/clock/random anywhere in `src/`.

**Definition of done, in one line:** given N service graphs, the tool prints how many
object-accessing sinks are proven owner-scoped, how many are not, and — the novel part — which
unproven ones are reached by a caller-supplied id that crossed a service boundary. Soundly:
never a false "safe".
```
