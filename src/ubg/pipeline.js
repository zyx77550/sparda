// ubg/pipeline.js — the pass runner.
// Passes are ordered, pure-ish (they mutate the graph they're handed, nothing
// else), and each one leaves the graph VALID — validateGraph runs after every
// pass so a broken transform is caught at the pass boundary with its name on
// the error, not three tools downstream. Order matters and is fixed:
// eliminate dead paths first (less to merge), minimize second (less to type),
// propagate types last (over the final topology).
import { validateGraph } from './schema.js';
import * as deadPathElimination from './passes/dead-path-elimination.js';
import * as stateMinimization from './passes/state-minimization.js';
import * as typePropagation from './passes/type-propagation.js';
import * as effectAlgebra from './passes/effect-algebra.js';
import * as consistencyDomains from './passes/consistency-domains.js';
import * as capabilities from './passes/capabilities.js';
import * as resourceLifetimes from './passes/resource-lifetimes.js';
import * as stateMachines from './passes/state-machines.js';

// SBIR §4 — normative order: reap, merge, type, classify, derive domains,
// then the v1.2 derivations (capabilities, lifetimes, machines) which read
// everything the earlier passes established
export const PASSES = [
  deadPathElimination,
  stateMinimization,
  typePropagation,
  effectAlgebra,
  consistencyDomains,
  capabilities,
  resourceLifetimes,
  stateMachines,
];

export function optimize(graph, { passes = PASSES } = {}) {
  const reports = [];
  for (const pass of passes) {
    const result = pass.run(graph);
    try {
      validateGraph(graph);
    } catch (err) {
      err.message = `pass ${pass.name} broke the graph — ${err.message}`;
      throw err;
    }
    reports.push({ pass: pass.name, ...result });
  }
  return reports;
}
