# SPARDA Behavior IR (SBIR) Specification — v1.1

> **From Descriptive AST Graphs to Prescriptive Constraint Runtimes.**
> Document Version: 1.1.0-draft
> Category: System Architecture & Compiler Specifications

This document defines the formal specification for **SPARDA Behavior IR (SBIR) v1.1**. SBIR is a language-agnostic, deterministic, serialized representation of web application behavior. It represents codebases not merely as syntax trees, but as mathematical graphs of control-flow, data-flow, state mutations, and semantic constraints.

---

## 1. Core Architecture: Nodes & Edges

An SBIR representation is a directed graph $G = (V, E)$ where $V$ is a set of typed **Nodes** and $E$ is a set of typed **Edges**.

### 1.1 Node Types ($V$)

1. **`entrypoint`**: Input gateways exposing the system to external clients.
   * *Metadata*: HTTP method, url path, query/body schemas, inferred return type schemas.
2. **`logic`**: Pure or side-effecting functional computation blocks (e.g., route handlers, middleware functions).
   * *Metadata*: Location (file, line), async boolean, compiled return shapes, merged inline logic blocks.
3. **`state`**: Persistent storage or memory locations (e.g., SQL tables, Redis keys, in-memory caches).
   * *Metadata*: Store type (sql, keyvalue), table name, columns (type, pk, nullable), and **Invariants** (v1.1).
4. **`effect`**: Operations causing out-of-process changes or reading external systems (e.g., HTTP requests, DB queries).
   * *Metadata*: Effect type (db_read, db_write, http_call, fs_write), destination target, and **Algebraic Properties** (v1.1).
5. **`guard`**: Security boundaries enforcing access conditions (e.g., authentication, RBAC checks).
   * *Metadata*: Guard type (denies-unauthorized, checks-role), logical rule.

### 1.2 Edge Types ($E$)

1. **`control_flow`**: Represents the sequential execution path of the runtime.
2. **`data_flow`**: Represents variables and type schemas passing from one node to another (e.g., request data to handlers, query results to effects).
3. **`mutation`**: A specific write edge indicating that an `effect` node mutates a `state` node.
4. **`gate`**: Enforces that a `logic` or `effect` node cannot be executed unless a specific `guard` node evaluates to true.

---

## 2. Semantic Extensions (v1.1)

To transition from a syntax-descriptive graph to a verification platform, SBIR v1.1 introduces five semantic dimensions.

### 2.1 Invariants
An **Invariant** is a logical predicate associated with a `state` node that must hold true before and after any execution step.
* **SQL Constraints**: Inferred from database DDL schemas (e.g., `CHECK (amount >= 0)`, `UNIQUE (email)`).
* **Application Invariants**: Inferred from code-level assertions or validation schemas (e.g., Zod refinements).
* **Representation**: Stored within the `state` node's metadata:
  ```json
  "invariants": [
    { "type": "unique", "fields": ["email"] },
    { "type": "check", "expression": "balance >= 0" }
  ]
  ```

### 2.2 Transaction Scopes
A **Transaction Scope** groups multiple nodes and edges under an atomic, consistent boundary.
* **Database Transactions**: Traced from code-level transaction blocks (e.g., `db.transaction(async tx => ...)`).
* **Compensating Pathways**: Traced from try/catch blocks that invoke recovery actions (e.g., refunding a charge if a database write fails).
* **Representation**: Logic and Effect nodes carry a `transaction` metadata block:
  ```json
  "meta": {
    "transactionId": "tx:src/routes/payment.js:42",
    "isolation": "serializable",
    "onFailure": { "action": "rollback", "compensates": ["effect:http_call:stripe_charge"] }
  }
}
```

### 2.3 Consistency Domains (Aggregates)
Logical domains group related states together, defining strict ownership and synchronization boundaries.
* **Aggregate Roots**: E.g., `Orders` owns `OrderItems` and `Shipments`. Only the root node can be mutated directly by external entrypoints.
* **Representation**: Nodes carry domain tags:
  ```json
  "meta": {
    "consistencyDomain": "Billing",
    "role": "aggregate_root"
  }
  ```

### 2.4 Algebraic Effect Properties
Every `effect` node is classified by its algebraic characteristics to enable dead-lock detection and out-of-order execution optimizations:
* **`idempotent`**: Executing the node $N$ times yields the same state as executing it once (e.g., SQL UPDATE vs INSERT).
* **`compensable`**: There exists a reversing effect node that can restore the state.
* **`observable`**: The out-of-process action changes a state visible to external observers (e.g., sending an email or charging a card, which cannot be silently rolled back).

```json
"meta": {
  "effectType": "http_call",
  "idempotent": false,
  "compensable": true,
  "observable": true
}
```

---

## 3. The Compiler Pass Invariants

All passes operating on the SBIR must adhere to three compiler laws:

1. **Law of Soundness**: An optimization or analysis pass must never remove an edge or node that alters the observable behavior of the runtime.
2. **Law of Completeness**: If a path is flagged as dead (`DeadPathElimination`), the pass must prove that no sequence of input states at any `entrypoint` can ever trigger control-flow to that node.
3. **Law of Determinism**: Running the same compilation pipeline on the same source files must produce a byte-identical JSON representation, verifying that graph traversal order is fully sorted.
