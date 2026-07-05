// ubg/passes/effect-algebra.js — pass 4 (SBIR v1.1 §2.4).
// Every effect gets three booleans: idempotent (N runs == 1 run), observable
// (visible to third parties — the thing no rollback can un-send), compensable
// (a reversal exists: transaction rollback or a compensation edge). The rules
// are a total function of (effectType, op, httpMethod, transaction, incoming
// compensation edges) — no code inspection, no guessing, so the same graph
// always classifies the same way. Annotation-only: adds meta, removes nothing
// (Law of Soundness).
export const name = 'EffectAlgebra';

const IDEMPOTENT_DB_OPS = new Set(['update', 'delete', 'upsert']);
const SAFE_HTTP = new Set(['GET', 'HEAD']);

export function run(graph) {
  const compensated = new Set(
    graph.edges.filter((e) => e.kind === 'compensation').map((e) => e.to),
  );

  let classified = 0;
  const effects = [...graph.nodes.values()]
    .filter((n) => n.kind === 'effect')
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const node of effects) {
    const m = node.meta;
    const hasReversal = Boolean(m.transaction) || compensated.has(node.id);

    let idempotent;
    let observable;
    let compensable;
    switch (m.effectType) {
      case 'db_read':
      case 'fs_read':
        idempotent = true;
        observable = false;
        compensable = true; // nothing to undo
        break;
      case 'db_write':
        idempotent = IDEMPOTENT_DB_OPS.has(m.op);
        observable = false;
        compensable = hasReversal;
        break;
      case 'http_call': {
        const safe = SAFE_HTTP.has(m.httpMethod);
        idempotent = safe;
        observable = !safe; // unknown method → conservatively observable
        compensable = safe || compensated.has(node.id);
        break;
      }
      case 'fs_write':
      default:
        idempotent = false;
        observable = false;
        compensable = compensated.has(node.id);
        break;
    }

    m.idempotent = idempotent;
    m.observable = observable;
    m.compensable = compensable;
    classified++;
  }

  const observableCount = effects.filter((n) => n.meta.observable).length;
  return { classified, observable: observableCount };
}
