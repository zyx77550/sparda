# SPARDA Behavior IR (SBIR) Specification — v1.1

> **From Descriptive AST Graphs to Prescriptive Constraint Runtimes.**
> Document Version: 1.1.0
> Artifact Version String: `sparda-ubg/v1.1`
> Category: System Architecture & Compiler Specifications
> Status: Normative. Every rule in this document is implemented by the compiler
> in `src/ubg/` and enforced by `tests/ubg.test.js`. A rule that cannot be
> stated as a deterministic inference procedure does not belong in this spec.

SBIR is a language-agnostic, deterministic, serialized representation of web
application behavior: a directed graph of control-flow, data-flow, state
mutations and semantic constraints. `SBIR` names the format; the artifact on
disk is `.sparda/ubg.json` and carries the version string `sparda-ubg/v1.1`.

**Additive-compatibility guarantee**: v1.1 only *adds* node metadata, edge
kinds and pass reports to v1. Every v1 consumer (readers of the five node
kinds and four v1 edge kinds) remains correct on a v1.1 artifact if it ignores
unknown edge kinds and unknown metadata keys. Consumers MUST ignore what they
do not understand; producers MUST NOT change the meaning of existing keys.

---

## 1. Core Architecture: Nodes & Edges

An SBIR representation is a directed graph $G = (V, E)$ where $V$ is a set of
typed **Nodes** and $E$ is a set of typed **Edges**.

### 1.1 Node Types ($V$)

1. **`entrypoint`** — input gateways exposing the system to external clients.
   *Metadata*: HTTP method, url path, input schemas, inferred return schemas
   (v1); `inputValidated`, `mutatesDomains` (v1.1).
2. **`logic`** — pure or side-effecting computation blocks (handlers,
   middlewares, helpers). *Metadata*: location, async flag, return shapes,
   merged block identities.
3. **`state`** — persistent storage locations (SQL tables, key-value stores,
   in-memory caches). *Metadata*: store type, table, columns (v1);
   **`invariants`**, **`references`**, **`consistencyDomain`**, **`role`** (v1.1).
4. **`effect`** — operations crossing the process boundary (DB queries, HTTP
   calls, filesystem). *Metadata*: effect type, target (v1);
   **`transaction`**, **`onFailure`**, **algebraic properties** (v1.1).
5. **`guard`** — security boundaries enforcing access conditions.
   *Metadata*: guard type, denial signal.

### 1.2 Edge Types ($E$)

| kind | from → to | meaning | since |
|---|---|---|---|
| `control_flow` | any → any | sequential execution order (`meta.order`) | v1 |
| `data_flow` | any → any | data/schema passing (`meta.via`, `meta.schema`) | v1 |
| `mutation` | effect → state | a write on a state node (`meta.op`) | v1 |
| `gate` | guard → node | target unreachable unless guard passes | v1 |
| `ownership` | state → state | aggregate root owns member (derived from FK) | v1.1 |
| `compensation` | effect → effect | source undoes target on failure paths | v1.1 |

---

## 2. Semantic Extensions (v1.1)

Each extension below is defined by (a) its representation and (b) its
**deterministic inference procedure**. The procedure is the spec: an
implementation that produces different output on the same source tree is
non-conforming, whatever its intentions.

### 2.1 Invariants

An **invariant** is a logical predicate attached to a `state` node that must
hold before and after every execution step.

**Representation** (on `state.meta.invariants`, sorted by `(type, fields)`):

```json
"invariants": [
  { "type": "primary_key", "fields": ["id"] },
  { "type": "not_null",    "fields": ["email"] },
  { "type": "unique",      "fields": ["email"] },
  { "type": "check",       "expression": "amount >= 0" },
  { "type": "foreign_key", "fields": ["user_id"],
    "references": { "table": "users", "fields": ["id"] } },
  { "type": "default",     "fields": ["active"], "value": "true" }
]
```

**Inference procedure** (from SQL DDL, the only declared truth available):

| DDL construct | invariant emitted |
|---|---|
| `PRIMARY KEY` (inline or table-level) | `primary_key` |
| `NOT NULL` | `not_null` |
| `UNIQUE` (inline or `UNIQUE (a, b)`) | `unique` |
| `CHECK (expr)` (inline or table-level) | `check` with the raw expression text, whitespace-normalized |
| `REFERENCES t(c)` / `FOREIGN KEY (a) REFERENCES t(c)` | `foreign_key` |
| `DEFAULT expr` | `default` with the raw expression text |

Application-level validation (Zod/Pydantic) is recorded as a *signal*, not an
invariant: if a handler's body calls `.parse(…)` / `.safeParse(…)` (JS) or its
route consumes a Pydantic model (Python), the entrypoint gets
`meta.inputValidated: true`. The compiler does not decompose validator
schemas in v1.1 — claiming field-level invariants it cannot verify would
violate the Law of Soundness in spirit.

### 2.2 Transaction Scopes

A **transaction scope** groups effects under an atomic boundary.

**Representation** (on `effect.meta`):

```json
"transaction": { "id": "tx:src/routes/payment.js:42", "isolation": "default" },
"onFailure": { "action": "rollback" }
```

`isolation` is `"default"` unless an isolation level appears as a **string
literal** in the transaction call options (e.g. Prisma's
`isolationLevel: "Serializable"`); the compiler never invents one.

**Inference procedure**:

* **JS** — an effect is inside scope `tx:<file>:<line>` iff it occurs within a
  function argument of a call whose callee property is `transaction`,
  `$transaction` or `withTransaction`. `<line>` is the line of that call.
* **Python** — an effect is inside scope iff it occurs within a `with` /
  `async with` block whose context expression is a call to `begin`,
  `begin_nested`, `transaction` or `atomic`, or a bare connection name
  (`with db:` — the sqlite3/DB-API idiom).
* Scopes nest: the innermost scope wins. Effects in a scope get
  `onFailure: { "action": "rollback" }`.

**Compensating pathways** — inferred from try/catch structure:

* An effect in a `try` block gets group id `try:<line-of-try>`.
* A mutating effect (`db_write`, `http_call`, `fs_write`) in the matching
  `catch` / `except` handler is a **compensator**: the compiler emits a
  `compensation` edge from the catch-effect to *each* mutating try-effect of
  the same group, and sets on the try-effect
  `onFailure: { "action": "compensate", "by": ["<catch effect id>", …] }`.
* Reads never compensate and are never compensated.

### 2.3 Consistency Domains (Aggregates)

Domains group states under strict ownership. **Ownership is derived from
foreign keys, never guessed**: a child table's FK to a parent means the parent
owns the child.

**Inference procedure** (pure graph derivation over `state.meta.references`):

1. Build the parent→child relation from `foreign_key` invariants between
   tables present in the graph.
2. An **aggregate root** is a state with children and no parent.
3. Emit an `ownership` edge from each parent to each direct child.
4. The **domain name** is the root's table name in PascalCase; the root gets
   `meta: { consistencyDomain, role: "aggregate_root" }`, every FK-descendant
   gets `role: "member"` of the same domain.
5. A state with no FK in either direction is its own domain with
   `role: "standalone"`.
6. FK cycles: every table in a cycle becomes its own domain root
   (deterministically, in sorted table order) and the cycle is reported by the
   pass, not silently broken.

Each entrypoint additionally gets `meta.mutatesDomains`: the sorted list of
domains of all states reachable from it through a `mutation` edge. A deploy
prover reads this field alone to know an endpoint's blast radius.

### 2.4 Algebraic Effect Properties

Every effect is classified on three axes. Rules are total: every effect gets
all three booleans.

| effect | `idempotent` | `observable` | `compensable` |
|---|---|---|---|
| `db_read`, `fs_read` | `true` | `false` | `true` (nothing to undo) |
| `db_write` op `update` / `delete` / `upsert` | `true` | `false` | `true` iff in a transaction scope or targeted by a `compensation` edge |
| `db_write` op `insert` / unknown | `false` | `false` | same rule as above |
| `http_call`, method GET/HEAD | `true` | `false` | `true` |
| `http_call`, other/unknown method | `false` | `true` | `true` iff targeted by a `compensation` edge |
| `fs_write` | `false` | `false` | `true` iff targeted by a `compensation` edge |

The HTTP method comes from a **literal** `method:` option on the call
(`fetch(url, { method: 'POST' })`, `axios.post`, `requests.post`); absent a
literal, the conservative row (other/unknown) applies. `observable` means the
action is visible to third parties outside this system's own state — the
thing no rollback can un-send.

### 2.5 Non-goals of v1.1

Stated so nobody retrofits meaning: no runtime tracing (static only), no
validator schema decomposition, no cross-service domain inference, no
isolation-level guessing, no probabilistic anything. Each is either a later
round or permanently out (probabilistic inference is permanently out — it
breaks the Law of Determinism).

---

## 3. The Compiler Laws

All passes operating on SBIR must adhere to three laws:

1. **Law of Soundness** — a pass must never remove or rewrite a node or edge
   in a way that alters the observable behavior the graph claims. Anything a
   pass cannot prove it must leave in place and may only annotate.
2. **Law of Completeness (reachability form)** — `DeadPathElimination` may
   remove a node only if **no path of edges from any entrypoint reaches it**.
   This is structural reachability — a sound over-approximation of liveness.
   (Semantic unreachability — "no input can ever drive control here" — is
   undecidable in general; a spec that demands it demands a non-existent
   compiler. v1.0's wording is hereby corrected.)
3. **Law of Determinism** — the same source tree must compile to a
   byte-identical artifact: node order, edge order and key order are fully
   sorted, no timestamps, identity via `sourceHash` (sha256 of sorted
   (path, bytes) pairs). Wall-clock, filesystem enumeration order, map
   iteration order and PRNGs are forbidden inputs.

## 4. Pass Pipeline (normative order)

1. `DeadPathElimination` — reap unreachable logic/guards/effects (Law 2).
2. `StateMinimization` — merge linear unguarded logic chains (Law 1: gated or
   handler nodes are never absorbed).
3. `TypePropagation` — resolve return schemas from input params + read
   columns.
4. `EffectAlgebra` *(v1.1)* — apply §2.4 classification. Annotation-only.
5. `ConsistencyDomains` *(v1.1)* — apply §2.3 derivation. Adds `ownership`
   edges and domain tags; removes nothing.

Each pass leaves the graph valid (`validateGraph`) and reports what it did;
the report is part of the compiler's contract with the user, not debug noise.

## 5. Changelog

* **1.1.0** — detection procedures made normative (§2.1–2.4 tables);
  `ownership` and `compensation` edge kinds; `invariants`, `references`,
  `transaction`, `onFailure`, algebraic booleans, `consistencyDomain`,
  `mutatesDomains`, `inputValidated` metadata; Law of Completeness restated in
  its decidable reachability form; fixed §2.2 example JSON (was syntactically
  invalid in 1.1.0-draft); versioning & additive-compatibility contract.
* **1.1.0-draft** — initial semantic dimensions.
* **1.0** — five node kinds, four edge kinds, three passes, determinism.
