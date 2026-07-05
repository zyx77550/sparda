// ubg/translate.js — syntax-specific facts → the language-agnostic UBG.
// After this file, "Express" and "Next.js" no longer exist: there are only
// entrypoints, guards, logic, effects and state, wired by control_flow,
// data_flow, gate and mutation edges. The translation contract:
//
//   entrypoint ──control_flow(0)──▶ mw₁ ──cf(1)──▶ … ──cf(n)──▶ handler
//   entrypoint ──data_flow{request schema}──▶ handler
//   guard mwᵢ  ──gate{requirement}──▶ handler        (must pass to reach)
//   handler    ──control_flow(k)──▶ effectₖ           (body source order)
//   effect(db_write) ──mutation{op}──▶ state          (linker resolves table)
//   state ──data_flow{rows}──▶ effect(db_read)
//   handler ──control_flow──▶ called helper logic     (local call graph)
import {
  addEdge,
  addNode,
  createGraph,
  effectId,
  entrypointId,
  guardId,
  logicId,
  makeEdge,
  makeNode,
  stateId,
} from './schema.js';
import { isGuardLike, scanFunction } from './extract.js';

export function translate({ framework, routes, globalMiddlewares, helpers, tables }) {
  const graph = createGraph({ framework });
  const scanCache = new Map(); // nodeId -> scan result (a body is scanned once)
  const expanded = new Set(); // nodeIds whose body effects are already attached

  // ---- state layer: declared truth from SQL, one node per table
  for (const t of tables) {
    addNode(
      graph,
      makeNode(
        stateId('sql', t.name),
        'state',
        `table ${t.name}`,
        { file: t.sourceFile, line: t.sourceLine },
        {
          store: 'sql',
          table: t.name,
          columns: t.columns.map((c) => ({
            name: c.name,
            type: c.type,
            sqlType: c.sqlType,
            nullable: c.nullable,
            pk: c.pk,
          })),
          // SBIR v1.1 §2.1/§2.3 — declared truth travels with the state node
          ...(t.invariants?.length ? { invariants: t.invariants } : {}),
          ...(t.references?.length ? { references: t.references } : {}),
        },
      ),
    );
  }

  // ---- helper logic layer: every top-level function seen in scanned files.
  // Most will be reached via call edges; the rest is exactly what
  // DeadPathElimination exists to remove.
  const helperByName = new Map(); // name -> nodeId (first wins, sorted for determinism)
  const sortedHelpers = [...helpers].sort(
    (a, b) =>
      a.sourceFile.localeCompare(b.sourceFile) ||
      a.sourceLine - b.sourceLine ||
      a.name.localeCompare(b.name),
  );
  for (const h of sortedHelpers) {
    // extractors on non-JS runtimes (FastAPI) pre-compute the scan — the
    // microscope only runs when we hold an actual babel node
    const scan = h.scan ?? scanFunction(h.fn);
    const kind = isGuardLike(h.name, scan) ? 'guard' : 'logic';
    const id =
      kind === 'guard'
        ? guardId(h.sourceFile, h.name, h.sourceLine)
        : logicId(h.sourceFile, h.name, h.sourceLine);
    addNode(
      graph,
      makeNode(
        id,
        kind,
        h.name,
        { file: h.sourceFile, line: h.sourceLine },
        {
          role: 'function',
          async: scan.async,
          ...(kind === 'guard' ? { guardType: guardTypeOf(h.name, scan) } : {}),
        },
      ),
    );
    scanCache.set(id, scan);
    if (!helperByName.has(h.name)) helperByName.set(h.name, id);
  }

  // ---- routes: the behavior spine
  for (const route of routes) {
    translateRoute(graph, route, globalMiddlewares, scanCache, helperByName, expanded);
  }

  return graph;
}

function translateRoute(
  graph,
  route,
  globalMiddlewares,
  scanCache,
  helperByName,
  expanded,
) {
  const epId = entrypointId(route.method, route.path);
  addNode(
    graph,
    makeNode(
      epId,
      'entrypoint',
      `${route.method.toUpperCase()} ${route.path}`,
      { file: route.sourceFile, line: route.sourceLine },
      {
        method: route.method,
        path: route.path,
        inputs: route.params,
        mutating: route.method !== 'get',
        ...(route.description ? { description: route.description } : {}),
      },
    ),
  );

  // global middlewares run before route-level ones — same chain, lower order
  const fullChain = [...globalMiddlewares, ...route.chain];
  let prevId = epId;
  let order = 0;
  const chainNodes = [];

  for (const step of fullChain) {
    const { id: stepId, scan } = ensureChainNode(graph, step, scanCache);
    chainNodes.push({ id: stepId, step, scan });
    addEdge(graph, makeEdge('control_flow', prevId, stepId, { order: order++ }));
    prevId = stepId;
  }

  const handlerEntry = chainNodes.length > 0 ? chainNodes[chainNodes.length - 1] : null;
  if (!handlerEntry) return; // entrypoint with no resolvable chain — dead-path pass reaps it

  // SBIR v1.1 §2.1 — validator seen in the handler body (zod) or enforced by
  // the framework (FastAPI Pydantic): recorded as a signal, never decomposed
  if (handlerEntry.scan?.validatesInput) graph.nodes.get(epId).meta.inputValidated = true;

  // request data flows straight to the handler (middlewares see it too, but
  // the handler is where the schema lands and returns are produced)
  addEdge(
    graph,
    makeEdge('data_flow', epId, handlerEntry.id, {
      via: 'request',
      schema: Object.fromEntries(route.params.map((p) => [p.name, p.type])),
    }),
  );

  // every guard on the chain gates the handler
  for (const cn of chainNodes) {
    const node = graph.nodes.get(cn.id);
    if (node.kind === 'guard' && cn.id !== handlerEntry.id) {
      addEdge(
        graph,
        makeEdge('gate', cn.id, handlerEntry.id, { requirement: node.label }),
      );
    }
  }

  attachBody(
    graph,
    handlerEntry.id,
    handlerEntry.scan,
    helperByName,
    scanCache,
    expanded,
  );
}

// A chain step (middleware or handler) becomes a guard or logic node.
function ensureChainNode(graph, step, scanCache) {
  const scan = step.scan ?? scanFunction(step.fn);
  const kind =
    isGuardLike(step.name, scan) && step.role !== 'handler' ? 'guard' : 'logic';
  const id =
    kind === 'guard'
      ? guardId(step.sourceFile, step.name, step.sourceLine)
      : logicId(step.sourceFile, step.name, step.sourceLine);
  const existing = graph.nodes.get(id);
  if (existing) {
    // helper already registered — upgrade role if this use is more specific
    if (step.role === 'handler') existing.meta.role = 'handler';
    const cachedScan = scanCache.get(id) ?? scan;
    if (step.role === 'handler' && cachedScan.returnShapes.length)
      existing.meta.returnShapes = cachedScan.returnShapes;
    return { id, scan: cachedScan };
  }
  addNode(
    graph,
    makeNode(
      id,
      kind,
      step.name,
      { file: step.sourceFile, line: step.sourceLine },
      {
        role: step.role,
        async: scan.async,
        ...(kind === 'guard' ? { guardType: guardTypeOf(step.name, scan) } : {}),
        ...(step.role === 'handler' && scan.returnShapes.length
          ? { returnShapes: scan.returnShapes }
          : {}),
      },
    ),
  );
  scanCache.set(id, scan);
  return { id, scan };
}

// handler body → effect nodes (source order) + call edges into helper logic
function attachBody(graph, ownerId, scan, helperByName, scanCache, expanded) {
  if (expanded.has(ownerId)) return; // one body, one expansion
  expanded.add(ownerId);
  const owner = graph.nodes.get(ownerId);

  let order = 0;
  let ordinal = 0;
  const created = []; // effects of THIS body — compensation pairs live here
  for (const eff of scan.effects) {
    const id = effectId(eff.effectType, owner.loc.file, eff.line, ordinal++);
    addNode(
      graph,
      makeNode(
        id,
        'effect',
        effectLabel(eff),
        { file: owner.loc.file, line: eff.line },
        {
          effectType: eff.effectType,
          ...(eff.op ? { op: eff.op } : {}),
          ...(eff.table ? { table: eff.table } : {}),
          ...(eff.target ? { target: eff.target } : {}),
          ...(eff.driver ? { driver: eff.driver } : {}),
          ...(eff.httpMethod ? { httpMethod: eff.httpMethod } : {}),
          // SBIR v1.1 §2.2 — transaction scope id is file-qualified here,
          // where the owner's file is known
          ...(eff.txLine != null
            ? {
                transaction: {
                  id: `tx:${owner.loc.file}:${eff.txLine}`,
                  isolation: eff.txIsolation ?? 'default',
                },
                onFailure: { action: 'rollback' },
              }
            : {}),
        },
      ),
    );
    addEdge(graph, makeEdge('control_flow', ownerId, id, { order: order++ }));
    created.push({ id, eff });
  }

  // SBIR v1.1 §2.2 — compensating pathways: a mutating catch-effect undoes
  // every mutating try-effect of its group
  const MUTATING = new Set(['db_write', 'http_call', 'fs_write']);
  for (const c of created) {
    if (c.eff.catchOf == null || !MUTATING.has(c.eff.effectType)) continue;
    for (const t of created) {
      if (t.eff.tryId !== c.eff.catchOf || !MUTATING.has(t.eff.effectType)) continue;
      addEdge(graph, makeEdge('compensation', c.id, t.id, { reason: 'catch-handler' }));
      const target = graph.nodes.get(t.id);
      const by = new Set([...(target.meta.onFailure?.by ?? []), c.id]);
      target.meta.onFailure = { action: 'compensate', by: [...by].sort() };
    }
  }

  for (const call of scan.calls) {
    const calleeId = helperByName.get(call.name);
    if (!calleeId || calleeId === ownerId) continue;
    addEdge(graph, makeEdge('control_flow', ownerId, calleeId, { order: order++ }));
    // called helpers expand their own bodies (bounded: the set prevents re-entry)
    const calleeScan = scanCache.get(calleeId);
    if (calleeScan)
      attachBody(graph, calleeId, calleeScan, helperByName, scanCache, expanded);
  }
}

function effectLabel(eff) {
  if (eff.effectType === 'db_write') return `db ${eff.op} ${eff.table ?? '?'}`;
  if (eff.effectType === 'db_read') return `db ${eff.op ?? 'read'} ${eff.table ?? '?'}`;
  if (eff.effectType === 'http_call') return `http ${eff.target}`;
  return `${eff.effectType} ${eff.target ?? ''}`.trim();
}

function guardTypeOf(name, scan) {
  if (scan?.guardSignals.deniesWithStatus) return 'denies-unauthorized';
  return /role|admin|permission|acl/i.test(name ?? '')
    ? 'authorization'
    : 'authentication';
}
