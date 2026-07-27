// Cross-Service Object-Ownership Proof — test suite
// Zero runtime dependencies. Runs with Node ≥ 18 built-in test runner.

import { test } from "node:test";
import assert from "node:assert";
import { proveCrossServiceOwnership } from "../src/csop.js";
import type { DBG, Report } from "../src/types.js";
import { MalformedInputError } from "../src/types.js";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function run(dbg: DBG): Report {
  return proveCrossServiceOwnership(dbg);
}

// ------------------------------------------------------------------
// Example 1 — the real cross-service BOLA
// ------------------------------------------------------------------
test("Example 1: cross-service BOLA (gateway -> orders-api)", () => {
  const dbg: DBG = [
    {
      name: "gateway",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "DELETE",
          path: "/orders/:orderId",
          principal: "authenticated",
          params: [{ name: "orderId", source: "path" }],
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "DELETE",
          target: "http://orders/api/orders/{orderId}",
          forwarded: [{ calleeParam: "id", fromParam: "orderId" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "orderId" },
      ],
    },
    {
      name: "orders-api",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "DELETE",
          path: "/api/orders/:id",
          principal: "public",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s2",
          kind: "sink",
          op: "delete",
          table: "order",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e2", to: "s2", type: "reaches" },
        { from: "e2", to: "s2", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r = run(dbg);
  assert.strictEqual(r.summary.unprovenXService, 1);
  assert.strictEqual(r.summary.provenSafe, 0);
  assert.strictEqual(r.summary.unprovenLocal, 0);
  assert.strictEqual(r.findings.length, 1);

  const f = r.findings[0];
  assert.strictEqual(f.verdict, "UNPROVEN_XSERVICE");
  assert.strictEqual(f.service, "orders-api");
  assert.strictEqual(f.sink, "s2");
  assert.strictEqual(f.table, "order");
  assert.strictEqual(f.objectIdLabel, "CALLER_SUPPLIED");
  assert.deepStrictEqual(f.path, ["gateway", "orders-api"]);
});

// ------------------------------------------------------------------
// Example 2 — PROVEN SAFE (ownership check before forward)
// ------------------------------------------------------------------
test("Example 2: gateway verifies ownership before forwarding -> PROVEN_SAFE", () => {
  const dbg: DBG = [
    {
      name: "gateway",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "DELETE",
          path: "/orders/:orderId",
          principal: "authenticated",
          params: [{ name: "orderId", source: "path" }],
        },
        {
          id: "chk1",
          kind: "ownershipCheck",
          verifiesParam: "orderId",
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "DELETE",
          target: "http://orders/api/orders/{orderId}",
          forwarded: [{ calleeParam: "id", fromParam: "orderId" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "orderId" },
        { from: "e1", to: "chk1", type: "reaches" },
        { from: "chk1", to: "h1", type: "reaches" },
        { from: "e1", to: "chk1", type: "dataflow", value: "orderId" },
      ],
    },
    {
      name: "orders-api",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "DELETE",
          path: "/api/orders/:id",
          principal: "public",
          exposure: "internal",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s2",
          kind: "sink",
          op: "delete",
          table: "order",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e2", to: "s2", type: "reaches" },
        { from: "e2", to: "s2", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r = run(dbg);
  assert.strictEqual(r.summary.unprovenXService, 0);
  assert.strictEqual(r.summary.provenSafe, 1);
  assert.strictEqual(r.summary.unprovenLocal, 0);
  assert.deepStrictEqual(r.findings, []);
});

// ------------------------------------------------------------------
// Example 3 — local BOLA, no boundary crossed
// ------------------------------------------------------------------
test("Example 3: local BOLA (single service, no ownership check)", () => {
  const dbg: DBG = [
    {
      name: "orders-api",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "DELETE",
          path: "/orders/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s1",
          kind: "sink",
          op: "delete",
          table: "order",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e1", to: "s1", type: "reaches" },
        { from: "e1", to: "s1", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r = run(dbg);
  assert.strictEqual(r.summary.unprovenLocal, 1);
  assert.strictEqual(r.summary.unprovenXService, 0);
  assert.strictEqual(r.summary.provenSafe, 0);
  assert.strictEqual(r.findings.length, 1);

  const f = r.findings[0];
  assert.strictEqual(f.verdict, "UNPROVEN_LOCAL");
  assert.strictEqual(f.service, "orders-api");
  assert.strictEqual(f.sink, "s1");
  assert.deepStrictEqual(f.path, ["orders-api"]);
});

// ------------------------------------------------------------------
// Chain A → B → C (transitive forward)
// ------------------------------------------------------------------
test("Chain A -> B -> C: transitive cross-service BOLA", () => {
  const dbg: DBG = [
    {
      name: "gateway",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "GET",
          target: "http://middle/items/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "middle",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "authenticated",
          exposure: "internal",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "h2",
          kind: "httpCall",
          method: "GET",
          target: "http://backend/items/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e2", to: "h2", type: "reaches" },
        { from: "e2", to: "h2", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "backend",
      nodes: [
        {
          id: "e3",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "public",
          exposure: "internal",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s3",
          kind: "sink",
          op: "read",
          table: "item",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e3", to: "s3", type: "reaches" },
        { from: "e3", to: "s3", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r = run(dbg);
  assert.strictEqual(r.summary.unprovenXService, 1);
  assert.strictEqual(r.summary.provenSafe, 0);
  assert.strictEqual(r.summary.unprovenLocal, 0);
  assert.strictEqual(r.findings.length, 1);
  assert.deepStrictEqual(r.findings[0].path, ["gateway", "middle", "backend"]);
});

// ------------------------------------------------------------------
// Chain A -> B -> C with ownership check in B -> PROVEN_SAFE
// ------------------------------------------------------------------
test("Chain A -> B -> C: B verifies ownership -> PROVEN_SAFE", () => {
  const dbg: DBG = [
    {
      name: "gateway",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "GET",
          target: "http://middle/items/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "middle",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "authenticated",
          exposure: "internal",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "chk2",
          kind: "ownershipCheck",
          verifiesParam: "id",
        },
        {
          id: "h2",
          kind: "httpCall",
          method: "GET",
          target: "http://backend/items/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e2", to: "h2", type: "reaches" },
        { from: "e2", to: "h2", type: "dataflow", value: "id" },
        { from: "e2", to: "chk2", type: "reaches" },
        { from: "chk2", to: "h2", type: "reaches" },
        { from: "e2", to: "chk2", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "backend",
      nodes: [
        {
          id: "e3",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "public",
          exposure: "internal",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s3",
          kind: "sink",
          op: "read",
          table: "item",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e3", to: "s3", type: "reaches" },
        { from: "e3", to: "s3", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r = run(dbg);
  assert.strictEqual(r.summary.provenSafe, 1);
  assert.strictEqual(r.summary.unprovenXService, 0);
  assert.strictEqual(r.summary.unprovenLocal, 0);
  assert.deepStrictEqual(r.findings, []);
});

// ------------------------------------------------------------------
// Stitch must NOT match — method mismatch
// ------------------------------------------------------------------
test("Stitch mismatch: method mismatch", () => {
  const dbg: DBG = [
    {
      name: "gateway",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "POST",
          target: "http://backend/items/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "backend",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "public",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s2",
          kind: "sink",
          op: "read",
          table: "item",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e2", to: "s2", type: "reaches" },
        { from: "e2", to: "s2", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r = run(dbg);
  assert.strictEqual(r.summary.stitchedEdges, 0);
  assert.strictEqual(r.summary.unprovenXService, 0);
  assert.strictEqual(r.summary.unprovenLocal, 1); // local to backend
});

// ------------------------------------------------------------------
// Stitch must NOT match — non-suffix path
// ------------------------------------------------------------------
test("Stitch mismatch: non-suffix path", () => {
  const dbg: DBG = [
    {
      name: "gateway",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "GET",
          target: "http://backend/api/v1/users/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "backend",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "public",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s2",
          kind: "sink",
          op: "read",
          table: "item",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e2", to: "s2", type: "reaches" },
        { from: "e2", to: "s2", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r = run(dbg);
  // callee /items/:id is NOT a suffix of caller /api/v1/users/{id}
  assert.strictEqual(r.summary.stitchedEdges, 0);
  assert.strictEqual(r.summary.unprovenXService, 0);
  assert.strictEqual(r.summary.unprovenLocal, 1);
});

// ------------------------------------------------------------------
// Malformed input — abort with MALFORMED_INPUT
// ------------------------------------------------------------------
test("Malformed input: missing node kind", () => {
  const dbg = [
    {
      name: "svc",
      nodes: [{ id: "n1" }],
      edges: [],
    },
  ];
  assert.throws(() => run(dbg as any), (err: any) => err.code === "MALFORMED_INPUT");
});

test("Malformed input: edge references non-existent node", () => {
  const dbg: DBG = [
    {
      name: "svc",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/",
          principal: "public",
          params: [],
        },
      ],
      edges: [{ from: "e1", to: "ghost", type: "reaches" }],
    },
  ];
  assert.throws(() => run(dbg), (err: any) => err.code === "MALFORMED_INPUT");
});

test("Malformed input: invalid enum value", () => {
  const dbg = [
    {
      name: "svc",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "FETCH",
          path: "/",
          principal: "public",
          params: [],
        },
      ],
      edges: [],
    },
  ];
  assert.throws(() => run(dbg as any), (err: any) => err.code === "MALFORMED_INPUT");
});

// ------------------------------------------------------------------
// Determinism — same input → byte-identical output
// ------------------------------------------------------------------
test("Determinism: identical inputs produce identical JSON", () => {
  const dbg: DBG = [
    {
      name: "gateway",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "DELETE",
          path: "/orders/:orderId",
          principal: "authenticated",
          params: [{ name: "orderId", source: "path" }],
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "DELETE",
          target: "http://orders/api/orders/{orderId}",
          forwarded: [{ calleeParam: "id", fromParam: "orderId" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "orderId" },
      ],
    },
    {
      name: "orders-api",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "DELETE",
          path: "/api/orders/:id",
          principal: "public",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s2",
          kind: "sink",
          op: "delete",
          table: "order",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e2", to: "s2", type: "reaches" },
        { from: "e2", to: "s2", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r1 = JSON.stringify(run(dbg));
  const r2 = JSON.stringify(run(dbg));
  assert.strictEqual(r1, r2);
});

// ------------------------------------------------------------------
// §6 Soundness invariants
// ------------------------------------------------------------------

// 6.1 Never a false SAFE
test("Invariant: never a false SAFE — unverified sink is UNPROVEN", () => {
  const dbg: DBG = [
    {
      name: "svc",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "public",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s1",
          kind: "sink",
          op: "read",
          table: "t",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e1", to: "s1", type: "reaches" },
        { from: "e1", to: "s1", type: "dataflow", value: "id" },
      ],
    },
  ];
  const r = run(dbg);
  assert.strictEqual(r.summary.provenSafe, 0);
  assert.strictEqual(r.summary.unprovenLocal, 1);
});

// 6.2 Authentication ≠ ownership
test("Invariant: authenticated route alone never yields PROVEN_SAFE", () => {
  const dbg: DBG = [
    {
      name: "svc",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s1",
          kind: "sink",
          op: "read",
          table: "t",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e1", to: "s1", type: "reaches" },
        { from: "e1", to: "s1", type: "dataflow", value: "id" },
      ],
    },
  ];
  const r = run(dbg);
  assert.strictEqual(r.summary.provenSafe, 0);
  assert.strictEqual(r.summary.unprovenLocal, 1);
});

// 6.3 Forwarded id is caller-supplied at callee unless caller proved ownership
test("Invariant: forwarded id is caller-supplied when caller did not prove ownership", () => {
  const dbg: DBG = [
    {
      name: "gateway",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "GET",
          target: "http://backend/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "backend",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s2",
          kind: "sink",
          op: "read",
          table: "t",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e2", to: "s2", type: "reaches" },
        { from: "e2", to: "s2", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r = run(dbg);
  assert.strictEqual(r.summary.unprovenXService, 1);
  const f = r.findings[0];
  assert.strictEqual(f.objectIdLabel, "CALLER_SUPPLIED");
});

// 6.4 Advisory, never gating — output has no pass/fail status
test("Invariant: report contains no pass/fail build status", () => {
  const dbg: DBG = [
    {
      name: "svc",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "public",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s1",
          kind: "sink",
          op: "read",
          table: "t",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e1", to: "s1", type: "reaches" },
        { from: "e1", to: "s1", type: "dataflow", value: "id" },
      ],
    },
  ];
  const r = run(dbg);
  const json = JSON.stringify(r);
  assert(!json.includes("pass"), "Report must not contain a pass field");
  assert(!json.includes("fail"), "Report must not contain a fail field");
  assert(!json.includes("status"), "Report must not contain a status field");
});

// 6.5 Deterministic & pure — already covered by determinism test above

// 6.6 Fail loud on malformed input — already covered by malformed tests above

// ------------------------------------------------------------------
// ownershipScoped=true must yield PROVEN_SAFE even without check
// ------------------------------------------------------------------
test("ownershipScoped=true yields PROVEN_SAFE", () => {
  const dbg: DBG = [
    {
      name: "svc",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "public",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s1",
          kind: "sink",
          op: "read",
          table: "t",
          objectIdParam: "id",
          ownershipScoped: true,
        },
      ],
      edges: [
        { from: "e1", to: "s1", type: "reaches" },
        { from: "e1", to: "s1", type: "dataflow", value: "id" },
      ],
    },
  ];
  const r = run(dbg);
  assert.strictEqual(r.summary.provenSafe, 1);
  assert.strictEqual(r.findings.length, 0);
});

// ------------------------------------------------------------------
// Multiple forwarders: one verified, one not -> UNPROVEN (sound join)
// ------------------------------------------------------------------
test("Multiple forwarders: conflicting labels join to most suspicious", () => {
  const dbg: DBG = [
    {
      name: "gateway-a",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "chk1",
          kind: "ownershipCheck",
          verifiesParam: "id",
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "GET",
          target: "http://backend/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "id" },
        { from: "e1", to: "chk1", type: "reaches" },
        { from: "chk1", to: "h1", type: "reaches" },
        { from: "e1", to: "chk1", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "gateway-b",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "h2",
          kind: "httpCall",
          method: "GET",
          target: "http://backend/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e2", to: "h2", type: "reaches" },
        { from: "e2", to: "h2", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "backend",
      nodes: [
        {
          id: "e3",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "public",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s3",
          kind: "sink",
          op: "read",
          table: "t",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e3", to: "s3", type: "reaches" },
        { from: "e3", to: "s3", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r = run(dbg);
  // backend receives both OWNER_VERIFIED (from gateway-a) and CALLER_SUPPLIED (from gateway-b)
  // Join = CALLER_SUPPLIED -> UNPROVEN_XSERVICE
  assert.strictEqual(r.summary.unprovenXService, 1);
  assert.strictEqual(r.findings[0].objectIdLabel, "CALLER_SUPPLIED");
});

// ------------------------------------------------------------------
// Sink with objectIdParam=null is ignored
// ------------------------------------------------------------------
test("Sink with objectIdParam=null is not analyzed", () => {
  const dbg: DBG = [
    {
      name: "svc",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "POST",
          path: "/",
          principal: "public",
          params: [],
        },
        {
          id: "s1",
          kind: "sink",
          op: "create",
          table: "t",
          objectIdParam: null,
          ownershipScoped: false,
        },
      ],
      edges: [{ from: "e1", to: "s1", type: "reaches" }],
    },
  ];
  const r = run(dbg);
  assert.strictEqual(r.summary.sinksAnalyzed, 0);
  assert.strictEqual(r.summary.provenSafe, 0);
  assert.strictEqual(r.summary.unprovenLocal, 0);
  assert.strictEqual(r.summary.unprovenXService, 0);
});

// ------------------------------------------------------------------
// Base-URL prefix suffix match
// ------------------------------------------------------------------
test("Stitch suffix match with base-URL prefix", () => {
  const dbg: DBG = [
    {
      name: "gateway",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "GET",
          target: "http://backend/api/v1/items/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "backend",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "GET",
          path: "/items/:id",
          principal: "public",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s2",
          kind: "sink",
          op: "read",
          table: "item",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e2", to: "s2", type: "reaches" },
        { from: "e2", to: "s2", type: "dataflow", value: "id" },
      ],
    },
  ];

  const r = run(dbg);
  // callee /items/:id is suffix of caller /api/v1/items/{id}
  assert.strictEqual(r.summary.stitchedEdges, 1);
  assert.strictEqual(r.summary.unprovenXService, 1);
});

// ------------------------------------------------------------------
// Guard: any input must complete in < 1s (anti-regression for non-termination)
// ------------------------------------------------------------------
test("Guard: chain A->B->C terminates in < 1 second", () => {
  const dbg: DBG = [
    {
      name: "A",
      nodes: [
        {
          id: "e1",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "authenticated",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "h1",
          kind: "httpCall",
          method: "GET",
          target: "http://B/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e1", to: "h1", type: "reaches" },
        { from: "e1", to: "h1", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "B",
      nodes: [
        {
          id: "e2",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "authenticated",
          exposure: "internal",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "h2",
          kind: "httpCall",
          method: "GET",
          target: "http://C/{id}",
          forwarded: [{ calleeParam: "id", fromParam: "id" }],
        },
      ],
      edges: [
        { from: "e2", to: "h2", type: "reaches" },
        { from: "e2", to: "h2", type: "dataflow", value: "id" },
      ],
    },
    {
      name: "C",
      nodes: [
        {
          id: "e3",
          kind: "entrypoint",
          method: "GET",
          path: "/:id",
          principal: "public",
          exposure: "internal",
          params: [{ name: "id", source: "path" }],
        },
        {
          id: "s3",
          kind: "sink",
          op: "read",
          table: "t",
          objectIdParam: "id",
          ownershipScoped: false,
        },
      ],
      edges: [
        { from: "e3", to: "s3", type: "reaches" },
        { from: "e3", to: "s3", type: "dataflow", value: "id" },
      ],
    },
  ];

  const start = performance.now();
  const r = run(dbg);
  const elapsed = performance.now() - start;

  assert.strictEqual(r.summary.unprovenXService, 1);
  assert.deepStrictEqual(r.findings[0].path, ["A", "B", "C"]);
  assert.ok(elapsed < 1000, `Algorithm took ${elapsed}ms, expected < 1000ms`);
});
