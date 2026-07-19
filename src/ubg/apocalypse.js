// ubg/apocalypse.js — the deployment prover.
// THE existence proof for SBIR: this file never parses source code. It reads
// the canonical graph and discharges proof obligations against the semantics
// the compiler already extracted — guards, invariants, transaction scopes,
// effect algebra, consistency domains. Every finding is a counterexample
// path (entrypoint → … → violation), never a vibe. Two modes:
//   static  — obligations over one graph (can THIS tree hurt itself?)
//   diff    — obligations over (baseline, candidate) (can THIS DEPLOY remove
//             a protection someone relies on?)
// Honesty contract: "proven" means "no declared obligation is violated under
// structural reachability" — the prover is exactly as strong as what the code
// and DDL declare. It proves the absence of whole bug classes, not of bugs.

import { cmp } from './schema.js';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, info: 3 };
const CONSTRAINING = new Set(['check', 'not_null', 'unique']);

// canonical serialized graph ({ nodes: [], edges: [] }) → indexed view
export function indexGraph(graph) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const cfOut = new Map();
  const mutOut = new Map();
  const gateTargets = new Set();
  const compensators = new Set(); // effects whose JOB is undoing another effect
  for (const e of graph.edges) {
    if (e.kind === 'control_flow') {
      if (!cfOut.has(e.from)) cfOut.set(e.from, []);
      cfOut.get(e.from).push({ to: e.to, route: e.meta?.route ?? null });
    } else if (e.kind === 'mutation') {
      if (!mutOut.has(e.from)) mutOut.set(e.from, []);
      mutOut.get(e.from).push(e);
    } else if (e.kind === 'gate') {
      gateTargets.add(e.to);
    } else if (e.kind === 'compensation') {
      compensators.add(e.from);
    }
  }
  const entrypoints = graph.nodes
    .filter((n) => n.kind === 'entrypoint')
    .sort((a, b) => cmp(a.id, b.id));
  return { nodes, cfOut, mutOut, gateTargets, compensators, entrypoints };
}

// Proof objects (the re-verifiable discharge trace, ADR-corroboration). `apocalypse` emits a
// VERDICT; a skeptic must re-run SPARDA to believe it. A proof object makes each discharged
// obligation auditable WITHOUT re-compiling: for every mutating route that passes its guard
// obligation, the exact `deny_path` — a real chain of node ids in the committed ubg.json — that
// a third party can trace to confirm the guard gates the write. Deterministic (same graph → same
// object, testable like a `verify` law), and honest: it reports provenance (verified vs asserted)
// and corroboration (which independent paths agree), never a bare "trust me, it's PROVEN".
export function buildProofObjects(graph) {
  const g = indexGraph(graph);
  const proofs = [];
  for (const ep of g.entrypoints) {
    const reached = [...reachOf(ep.id, g.cfOut)]
      .sort()
      .map((id) => g.nodes.get(id))
      .filter(Boolean);
    const guards = reached.filter((n) => n.kind === 'guard');
    const writes = [];
    for (const n of reached)
      if (n.kind === 'effect')
        for (const e of g.mutOut.get(n.id) ?? [])
          writes.push({ effect: n, stateId: e.to });
    // a proof object is emitted ONLY for a genuinely DISCHARGED obligation: a mutating route
    // (O1 applies) that actually reaches a guard. A guardless mutation is a FINDING, not a proof.
    if (!writes.length || !guards.length) continue;
    const guardInfo = guards
      .map((gd) => ({
        guard: gd.label,
        node: gd.id,
        // MUST-analysis honesty: 'verified' only when a deny path was SEEN in the body;
        // an opaque middleware trusted by name is 'asserted' — the proof says which.
        provenance: gd.meta?.verified ? 'verified' : 'asserted',
        via: gd.meta?.verifiedVia ?? 'structural',
      }))
      .sort((a, b) => cmp(a.node, b.node));
    proofs.push({
      obligation: 'GUARDED_MUTATION',
      route: ep.label,
      entrypoint: ep.id,
      discharged_by: {
        // the obligation is only as strong as its weakest guard: verified iff ALL are verified
        provenance: guardInfo.every((x) => x.provenance === 'verified')
          ? 'verified'
          : 'asserted',
        corroboratedBy: [...new Set(guardInfo.map((x) => x.via))].sort(),
        guards: guardInfo.map(({ guard, node, provenance }) => ({
          guard,
          node,
          provenance,
        })),
        // the re-checkable path: every id exists in ubg.json; a gate edge links guard→handler,
        // and the handler control-flow-reaches each listed mutation. Trace it to confirm.
        deny_path: [ep.id, ...guardInfo.map((x) => x.node)],
        mutations: [...new Set(writes.map((w) => w.effect.id))].sort(),
      },
    });
  }
  proofs.sort((a, b) => cmp(a.entrypoint, b.entrypoint));
  return proofs;
}

export function reachOf(epId, cfOut) {
  const seen = new Set();
  const queue = [epId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of cfOut.get(id) ?? []) {
      // a chain edge belongs to one route — never cross into a sibling chain
      if (next.route === null || next.route === epId) queue.push(next.to);
    }
  }
  seen.delete(epId);
  return seen;
}

const locOf = (node) => (node?.loc ? `${node.loc.file}:${node.loc.line}` : 'unknown');

// ---------------------------------------------------------------------------
// static obligations
// ---------------------------------------------------------------------------

export function checkGraph(graph) {
  const g = indexGraph(graph);
  const findings = [];
  let obligations = 0;
  // Resource tables by name — the input to BolaRay ownership-model inference (O7 below).
  const statesByTable = new Map();
  for (const n of g.nodes.values())
    if (n?.kind === 'state' && n.meta?.table) statesByTable.set(n.meta.table, n);
  // Behavior polarity (ADR-036): per entrypoint, a ternary vector over the same
  // obligations checked below — +1 protection present, 0 not applicable, -1
  // violated. Built HERE so a -1 is literally the same condition as the finding
  // (one source of truth, no drift). The algebra over these vectors lives in
  // ubg/polarity.js; this function just records them.
  const polarity = [];

  for (const ep of g.entrypoints) {
    const reach = reachOf(ep.id, g.cfOut);
    const reached = [...reach].sort().map((id) => g.nodes.get(id));
    const guards = reached.filter((n) => n?.kind === 'guard');
    const writes = []; // { effect, stateId }
    for (const n of reached) {
      if (n?.kind !== 'effect') continue;
      for (const e of g.mutOut.get(n.id) ?? []) writes.push({ effect: n, stateId: e.to });
    }
    const observables = reached.filter((n) => n?.kind === 'effect' && n.meta.observable);
    const vec = { auth: 0, validation: 0, atomicity: 0, reversibility: 0, aggregate: 0 };

    // O1 — every mutation path must pass a guard
    obligations++;
    if (writes.length) vec.auth = guards.length ? 1 : -1;
    if (writes.length && guards.length === 0) {
      // taint enrichment (ADR-P1): does request data provably flow into one of these
      // writes? A tag on an ALREADY-emitted finding — never a finding of its own — so it
      // sharpens the worst routes (open AND fed by user input) without adding false
      // alarms. Under-approximated (SOUNDNESS Direction 1): a missed tag hides nothing.
      const tainted = writes.filter((w) => w.effect.meta.tainted);
      // G2 (guard taxonomy families B–D): a public-by-design route whose body checks a
      // CREDENTIAL and can refuse — a stored-token lookup (reset/invite/verification), a
      // signature/token verify call, or a webhook/callback handshake — is not "unguarded"
      // in the critical sense; it is gated by a mechanism the guard model doesn't carry.
      // The invariant (non-negotiable): this can only DOWNGRADE critical → advisory, with
      // the mechanism named. It never proves (identity scope stays unproven), never
      // silences (the finding remains, visible), so it can never make a false PROVEN on
      // its own — though fewer hard findings CAN promote a clean app; that is the
      // taxonomy's sanctioned direction (a stored-token reset flow is not a vuln).
      // Credential/refusal signals reach the entrypoint two ways: from its own middleware chain
      // (ep.meta.*, set in translate) OR from a body it REACHES through the call graph (the
      // owner.meta.body* tags — the imported/DI service where the throw actually lives). The
      // second path is what closes the first-run and API-key false criticals: their refusal sits
      // in a service method with no effect of its own, so the signal never rode the direct chain.
      const reachedDenies = reached.some((n) => n?.meta?.bodyDenies);
      const reachedVerifies = reached.some((n) => n?.meta?.bodyVerifies);
      const reachedRedirects = reached.some((n) => n?.meta?.bodyRedirects);
      const credGates = ep.meta?.credentialGates === true || reachedDenies;
      const credVerify = ep.meta?.credentialVerify === true || reachedVerifies;
      const credRedirects = ep.meta?.credentialRedirects === true || reachedRedirects;
      // family A/B: a stored-credential lookup — reset/invite/OTP/magic tokens AND long-lived API
      // keys / access tokens / personal-access tokens. Same "read the secret, refuse if it doesn't
      // match" mechanism; only the secret's lifetime differs.
      const tokenRead = reached.some(
        (n) =>
          n?.kind === 'effect' &&
          n.meta.effectType === 'db_read' &&
          /token|verif|invite|otp|magic|api[_-]?key|access[_-]?token|credential|personal[_-]?access/i.test(
            n.meta.table ?? '',
          ),
      );
      const callbackish = /(^|[:/])(callback|webhook|hook)s?([/:]|$)/i.test(ep.label);
      // family E (first-run / admin-setup): a bootstrap-shaped route — sign-up-admin, setup,
      // install, onboard, restore/recover — whose body reads an identity table and refuses. The
      // "only before an admin exists" / "only an admin may" gate. Bounded to bootstrap-shaped
      // PATHS so an ordinary route's generic "user not found → throw" can never trip it, AND still
      // requires a real refusal shape below (credGates) to downgrade.
      const bootstrapish =
        /(^|[:/\- ])(setup|install|onboard(ing)?|bootstrap|first[-_ ]?run|initiali[sz]e|admin[-_ ]?sign[-_ ]?up|register[-_ ]?admin|restore|recover)([/:\- ]|$)/i.test(
          ep.label,
        );
      const identityRead = reached.some(
        (n) =>
          n?.kind === 'effect' &&
          n.meta.effectType === 'db_read' &&
          /user|account|admin|member|identit/i.test(n.meta.table ?? ''),
      );
      const family = tokenRead
        ? 'a stored credential-token lookup'
        : credVerify
          ? 'a signature/token verification call'
          : callbackish
            ? 'a webhook/callback handshake'
            : bootstrapish && identityRead
              ? 'a first-run/admin-setup guard'
              : null;
      // refusal shapes per family: token/verify/first-run families must throw or 4xx; the callback
      // family may also refuse by redirecting away (the browser-facing OAuth deny idiom).
      const credentialGated =
        family !== null && (credGates || (callbackish && credRedirects));
      // Class 1 (public-by-design re-label): a route whose PATH is a curated public signature —
      // login/register/logout, forgot/reset-password, verify-email, oauth/sso/saml, callback/webhook,
      // health/metrics/.well-known — is *conventionally* meant to run without a session guard. Unlike
      // the credential families above this carries NO evidence of a gate; it is triage, not proof. So
      // it only ever RE-LABELS critical → info (`expectedPublic`), names the convention, and says
      // "confirm intent" — never hidden, never marked safe, never touches PROVEN. The list is the
      // HEAD of the distribution (deliberately precise, not `**/auth/**` blanket: change-password /
      // 2fa / session management are NOT public, and re-labeling those would hide a real hole).
      const expectedPublic =
        !credentialGated &&
        (/(^|[:/\- ])(log-?in|sign-?in|sign-?up|register|log-?out|sign-?out|forgot-?password|reset-?password|forgot|verify-?email|email-?verification|confirm-?email|magic-?link|oauth\d?|openid|sso|saml|health(z|check|-?check)?|livez|readyz|metrics|well-known)([/:\- ]|$)/i.test(
          ep.label,
        ) ||
          /\.well-known/i.test(ep.label) ||
          callbackish);
      const softened = credentialGated || expectedPublic;
      findings.push({
        rule: 'UNGUARDED_MUTATION',
        severity: softened ? 'info' : 'critical',
        ...(credentialGated
          ? { advisory: true, credentialFamily: family }
          : expectedPublic
            ? { advisory: true, expectedPublic: true }
            : {}),
        entrypoint: ep.id,
        message: credentialGated
          ? `${ep.label} mutates ${fmtStates(writes)} with no modeled guard — but the body checks ${family} and can refuse; verify that credential's scope covers the mutation`
          : expectedPublic
            ? `${ep.label} mutates ${fmtStates(writes)} with no modeled guard — but its path matches a public-by-design signature (auth / oauth / callback / health / metrics); confirm this endpoint is meant to be unauthenticated`
            : `${ep.label} mutates ${fmtStates(writes)} with no guard anywhere on the path${
                tainted.length ? ' — and request data flows straight into the write' : ''
              }`,
        evidence: writes.map((w) => `${w.effect.id} (${locOf(w.effect)})`),
        ...(tainted.length && !softened ? { tainted: true } : {}),
      });
    }

    // O6 — a write whose TABLE is chosen by the request (symbolic, e.g. the URL
    // names the collection) with NO guard on the path: "anyone can write to any
    // table they name" — a mass-assignment-of-target escalation, materially more
    // severe than a generic unguarded write and worth its own, sharper finding.
    // Bounded HARD (E-029): symbolic target AND no guard. A GUARDED symbolic write
    // (directus's per-collection permission layer, invisible to the static eye) is
    // NOT flagged — the corpus confirms every real symbolic write is guarded, so
    // this rule fires zero false positives there. Rides the same vec.auth = -1 O1
    // already set (no new polarity axis — the 5-axis matrix stays pinned).
    obligations++;
    const unboundedWrites = writes.filter(
      (w) => w.effect.meta.symbolic && w.effect.meta.effectType === 'db_write',
    );
    if (unboundedWrites.length && guards.length === 0) {
      findings.push({
        rule: 'UNBOUNDED_WRITE_TARGET',
        severity: 'critical',
        entrypoint: ep.id,
        message: `${ep.label} writes to a request-named table (${[...new Set(unboundedWrites.map((w) => g.nodes.get(w.stateId)?.meta.table ?? '?'))].sort().join(', ')}) with no guard — the caller chooses which table to mutate`,
        evidence: unboundedWrites.map((w) => `${w.effect.id} (${locOf(w.effect)})`),
      });
    }

    // O2 — writes into constrained tables need validated input
    obligations++;
    const constrained = writes.filter((w) =>
      (g.nodes.get(w.stateId)?.meta.invariants ?? []).some((i) =>
        CONSTRAINING.has(i.type),
      ),
    );
    if (constrained.length) vec.validation = ep.meta.inputValidated ? 1 : -1;
    if (!ep.meta.inputValidated && constrained.length) {
      findings.push({
        rule: 'UNVALIDATED_CONSTRAINED_WRITE',
        severity: 'medium',
        entrypoint: ep.id,
        message: `${ep.label} writes ${fmtStates(constrained)} whose declared invariants (CHECK/NOT NULL/UNIQUE) can be violated by unvalidated input`,
        evidence: constrained.map((w) => w.stateId),
      });
    }

    // O3 — multi-table writes inside one aggregate must share a transaction
    obligations++;
    const byDomain = new Map();
    for (const w of writes) {
      const domain = g.nodes.get(w.stateId)?.meta.consistencyDomain;
      if (!domain) continue;
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain).push(w);
    }
    for (const [domain, ws] of [...byDomain].sort((a, b) => cmp(a[0], b[0]))) {
      const states = new Set(ws.map((w) => w.stateId));
      if (states.size < 2) continue;
      const txIds = new Set(ws.map((w) => w.effect.meta.transaction?.id ?? null));
      const atomic = txIds.size === 1 && !txIds.has(null);
      vec.atomicity = atomic && vec.atomicity !== -1 ? 1 : -1;
      if (!atomic) {
        findings.push({
          rule: 'NON_ATOMIC_AGGREGATE_WRITE',
          severity: 'high',
          entrypoint: ep.id,
          message: `${ep.label} writes ${states.size} tables of aggregate "${domain}" outside a single transaction — a partial failure leaves the aggregate inconsistent`,
          evidence: ws.map((w) => `${w.effect.id} → ${w.stateId}`),
        });
      }
    }

    // O4 — an observable effect the outside world sees must be compensable
    // when the entrypoint also mutates state (the write can fail after the
    // world already saw the effect)
    obligations++;
    if (observables.length && writes.length) {
      let bad = false;
      for (const obs of observables) {
        if (obs.meta.compensable) continue;
        if (g.compensators.has(obs.id)) continue; // the undo itself is not a risk
        bad = true;
        findings.push({
          rule: 'IRREVERSIBLE_OBSERVABLE',
          severity: 'high',
          entrypoint: ep.id,
          message: `${ep.label} makes an irreversible external call (${obs.meta.target ?? obs.label}) while also mutating state — no compensation path exists if the write fails`,
          evidence: [`${obs.id} (${locOf(obs)})`],
        });
      }
      vec.reversibility = bad ? -1 : 1;
    }

    // O5 — mutating an aggregate member without touching its root
    obligations++;
    for (const w of writes) {
      const state = g.nodes.get(w.stateId);
      if (state?.meta.role !== 'member') continue;
      const touchesRoot = writes.some(
        (o) =>
          g.nodes.get(o.stateId)?.meta.role === 'aggregate_root' &&
          g.nodes.get(o.stateId)?.meta.consistencyDomain === state.meta.consistencyDomain,
      );
      vec.aggregate = touchesRoot && vec.aggregate !== -1 ? 1 : -1;
      if (!touchesRoot) {
        // ADVISORY (E-046): a direct member-table write is a design-smell, not a proven
        // violation — many ORMs/apps legitimately write members directly. On a real
        // schema-rich app it fires in bulk (dub: 174), so it points a human at the pattern,
        // it never gates the verdict. (Surfaced once the split-schema state layer became
        // visible; making it hard would have flooded every folder-schema app.)
        findings.push({
          rule: 'AGGREGATE_MEMBER_BYPASS',
          severity: 'info',
          advisory: true,
          entrypoint: ep.id,
          message: `${ep.label} mutates member table "${state.meta.table}" of aggregate "${state.meta.consistencyDomain}" without going through its root`,
          evidence: [w.stateId],
        });
      }
    }

    // O7 — object-level authorization not proven (BOLA / IDOR, OWASP API #1). ADVISORY.
    // The route accesses an object by a request-supplied id (`idScoped`) but NO query on
    // its RESOLVED path is scoped to the caller (`ownerScoped` — an ownership key or a
    // session value). Under a guard (authenticated) and not an admin/system route. This is
    // the one bug class that survives on authenticated apps, and it is ADVISORY by design
    // (ADR-058): absence of a visible scope is FP-prone — a scoped client, RLS, or a
    // helper's where clause is invisible — so it NEVER flips the verdict, it points a human
    // at the exact routes to review. MUST-analysis: `ownerScoped` is set only when proven.
    obligations++;
    const idScoped = reached.filter((n) => n?.kind === 'effect' && n.meta.idScoped);
    const ownerScopedSeen = reached.some(
      (n) => n?.kind === 'effect' && n.meta.ownerScoped,
    );
    const adminish =
      /(^|[:/])(admin|internal|system|cron|webhooks?|callback)([/:]|$)/i.test(ep.label) ||
      guards.some((gd) => /admin|internal|system|cron|super/i.test(gd?.label ?? ''));
    // G1: a call-site ownership assertion on the route (`getXOrThrow({ workspaceId:
    // workspace.id })`) scopes the object to the caller even when the proof lives in an
    // imported helper we don't expand — so it clears the BOLA advisory, same as a visible
    // `ownerScoped` query. Advisory-only, so this can never mask a hard finding.
    const ownerAsserted = ep.meta?.ownerAsserted === true;
    if (
      idScoped.length &&
      !ownerScopedSeen &&
      !ownerAsserted &&
      guards.length &&
      !adminish
    ) {
      const tables = [
        ...new Set(idScoped.map((n) => n.meta.table).filter(Boolean)),
      ].sort();
      // BolaRay (CCS 2024) step 1: infer the ownership MODEL each accessed table SHOULD carry
      // (from its declared columns/FKs), so the advisory names the scope the access is MISSING
      // instead of a vague "verify authorization". Still advisory (soundness unchanged): the
      // schema tells us the model, never the runtime intent — that gap is why O7 never gates.
      const ownership = tables.map((t) => ({
        table: t,
        ...(inferOwnershipModel(t, statesByTable) ?? { model: null, key: null }),
      }));
      const hints = ownership
        .filter((o) => o.model)
        .map((o) => `${o.table} should be ${o.model} (${o.key})`);
      findings.push({
        rule: 'OBJECT_SCOPE_UNPROVEN',
        severity: 'info',
        advisory: true,
        entrypoint: ep.id,
        ownership,
        message:
          `${ep.label} accesses ${tables.join(', ')} by a request-supplied id with no ownership scope proven on the path` +
          (hints.length ? ` — ${hints.join('; ')}` : '') +
          ` — verify object-level authorization (BOLA/IDOR)`,
        evidence: idScoped.map((n) => `${n.id} (${locOf(n)})`),
      });
    }

    polarity.push({ entrypoint: ep.id, vector: vec });
  }

  // Lateral inhibition (ADR-060): a rule that fires on a large FRACTION of the routes is a
  // codebase-wide PATTERN, not N independent findings — 97 identical lines bury the rare, sharp
  // signals (loss of contrast). Collapse a flooding rule into ONE summary at its MAX severity.
  // SOUND + verdict-neutral: a hard rule stays hard and still gates (we never HIDE a finding — a
  // suppressed danger would be a false PROVEN); we only stop it flooding the report. The retina
  // suppresses uniform light, never an edge.
  const collapsed = collapseFloods(findings, g.entrypoints.length);

  return { findings: sortFindings(collapsed), obligations, polarity };
}

// A rule is "pervasive" when it fires on more than this fraction of the routes AND on at least
// FLOOD_MIN of them — measured on the corpus: real floods sit at 18% (dub member-bypass) / 41%
// (directus irreversible) on 100+ routes, while the sharp per-route signals (BOLA 10%, unvalidated
// 11%, unguarded 1%) stay below. The absolute floor keeps a small app (a 2-route fixture where one
// finding is trivially "50%") from ever collapsing — a pattern needs real breadth to be a pattern.
const FLOOD_DENSITY = 0.15;
const FLOOD_MIN = 10;
export function collapseFloods(findings, totalRoutes) {
  if (!totalRoutes) return findings;
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  const out = [];
  for (const [rule, list] of [...byRule].sort((a, b) => cmp(a[0], b[0]))) {
    const routes = new Set(list.map((f) => f.entrypoint));
    if (routes.size >= FLOOD_MIN && routes.size / totalRoutes > FLOOD_DENSITY) {
      // strongest severity wins; advisory only if EVERY collapsed finding was advisory (a hard
      // finding in the flood keeps the summary hard — it must still gate the verdict).
      const severity = list
        .map((f) => f.severity)
        .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0];
      const anyHard = list.some((f) => !f.advisory);
      out.push({
        rule,
        severity,
        ...(anyHard ? {} : { advisory: true }),
        entrypoint: '(codebase-wide)',
        pervasive: routes.size,
        message: `${rule} is pervasive — fires on ${routes.size}/${totalRoutes} routes; review the pattern, not each route (all routes listed in evidence)`,
        evidence: [...routes].sort(),
      });
    } else {
      out.push(...list);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// diff obligations — what did this deploy take away?
// ---------------------------------------------------------------------------

export function diffGraphs(baseline, candidate) {
  const base = indexGraph(baseline);
  const cand = indexGraph(candidate);
  const findings = [];

  for (const ep of base.entrypoints) {
    const now = cand.nodes.get(ep.id);
    // D1 — entrypoint disappeared
    if (!now) {
      findings.push({
        rule: 'ENTRYPOINT_REMOVED',
        severity: 'high',
        entrypoint: ep.id,
        message: `${ep.label} existed in the baseline and is gone — breaking API change`,
        evidence: [],
      });
      continue;
    }
    // D2 — guard protection dropped
    const guardedBefore = [...reachOf(ep.id, base.cfOut)].some(
      (id) => base.nodes.get(id)?.kind === 'guard',
    );
    const guardedNow = [...reachOf(ep.id, cand.cfOut)].some(
      (id) => cand.nodes.get(id)?.kind === 'guard',
    );
    if (guardedBefore && !guardedNow) {
      findings.push({
        rule: 'GUARD_REMOVED',
        severity: 'critical',
        entrypoint: ep.id,
        message: `${ep.label} was guarded in the baseline and is now reachable without any guard`,
        evidence: [],
      });
    }
    // D3 — blast radius grew
    const before = new Set(ep.meta.mutatesDomains ?? []);
    const grew = (now.meta.mutatesDomains ?? []).filter((d) => !before.has(d)).sort();
    if (grew.length) {
      findings.push({
        rule: 'BLAST_RADIUS_GREW',
        severity: 'medium',
        entrypoint: ep.id,
        message: `${ep.label} now mutates aggregate(s) it did not touch before: ${grew.join(', ')}`,
        evidence: grew,
      });
    }
  }

  // D4 — declared invariant disappeared from a still-existing table
  for (const n of baseline.nodes) {
    if (n.kind !== 'state') continue;
    const now = cand.nodes.get(n.id);
    if (!now) continue;
    const still = new Set((now.meta.invariants ?? []).map((i) => JSON.stringify(i)));
    for (const inv of n.meta.invariants ?? []) {
      if (!still.has(JSON.stringify(inv))) {
        findings.push({
          rule: 'INVARIANT_REMOVED',
          severity: 'high',
          entrypoint: n.id,
          message: `table "${n.meta.table}" lost a declared invariant: ${fmtInvariant(inv)}`,
          evidence: [JSON.stringify(inv)],
        });
      }
    }
  }

  return { findings: sortFindings(findings) };
}

// ---------------------------------------------------------------------------

// State-touching behavior SPARDA could actually fault: state nodes + db/http/fs
// effects. `entropy` (a bare `new Date()`) is not safety-relevant, so it doesn't
// count — an app of only time-reads has no behavior to prove. This is the effect-level
// analogue of the provability guard, shared by the verdict and the immunity capsule so
// the two artifacts never disagree about whether SPARDA saw anything to prove.
const OBSERVABLE_EFFECT = new Set(['db_write', 'db_read', 'http_call', 'fs_write']);
export function countObserved(graph) {
  let n = 0;
  for (const node of graph.nodes.values ? graph.nodes.values() : graph.nodes) {
    if (
      node.kind === 'state' ||
      (node.kind === 'effect' && OBSERVABLE_EFFECT.has(node.meta?.effectType))
    )
      n++;
  }
  return n;
}

// State-CHANGING behavior — the only thing a positive safety proof can be ABOUT. Every
// obligation SPARDA discharges (guard, atomicity, reversibility, unbounded-target) is about
// a MUTATION; a route that only reads, or a table that is only read, discharges nothing. So
// an app SPARDA resolved down to zero mutations proves nothing positive — it is SURFACE,
// never PROVEN. Counts db_write / http_call / fs_write effects ONLY: read-only state nodes
// (a table declared but never written) are deliberately excluded — they carry no obligation.
// This closes the reads-only hollow PROVEN a real stress test found: vendure compiled to 312
// routes / 0 writes / 26 reads and read "PROVEN" at 0% coverage.
const PROVABLE_EFFECT = new Set(['db_write', 'http_call', 'fs_write']);
export function countProvable(graph) {
  let n = 0;
  for (const node of graph.nodes.values ? graph.nodes.values() : graph.nodes) {
    if (node.kind === 'effect' && PROVABLE_EFFECT.has(node.meta?.effectType)) n++;
  }
  return n;
}

// Ownership-model inference (BolaRay, CCS 2024): from a resource table's declared columns and
// foreign keys, which object-level authorization model SHOULD it carry? DIRECT_OWNER (a
// user/owner column), GROUP_SCOPED (a workspace/team/tenant column — caller must belong to the
// group), TRANSITIVE (ownership reached via a FK to an owned table), or null (a shared/global
// resource, or intent SPARDA cannot see). Columns are lowercased (prisma.js / sql.js). Pure and
// bounded. Used ONLY to enrich the O7 advisory — it never changes the verdict (soundness: the
// schema reveals the model, never the runtime authorization intent, which is the semantic gap
// OWASP/BolaRay both name as the reason no static tool can PROVE access control).
const OWNER_DIRECT = /^(user|owner|author|creator)_?id$/;
const OWNER_GROUP =
  /^(workspace|project|team|tenant|org|organization|store|customer|partner|program|account|company|group)_?id$/;
function inferOwnershipModel(tableName, statesByTable, seen = new Set(), depth = 0) {
  const st = statesByTable.get(tableName);
  if (!st || seen.has(tableName) || depth > 3) return null;
  seen.add(tableName);
  const cols = (st.meta?.columns ?? []).map((c) => c.name);
  const direct = cols.find((n) => OWNER_DIRECT.test(n));
  if (direct) return { model: 'direct-owner', key: direct };
  const group = cols.find((n) => OWNER_GROUP.test(n));
  if (group) return { model: 'group-scoped', key: group };
  for (const ref of st.meta?.references ?? []) {
    if (!ref.table || ref.table === tableName) continue;
    const sub = inferOwnershipModel(ref.table, statesByTable, seen, depth + 1);
    if (sub)
      return {
        model: 'transitive',
        key: `${(ref.fields ?? []).join(',')}->${ref.table}.${sub.key}`,
      };
  }
  return null;
}

// Below this resolved/surface coverage ratio, a CLEAN app cannot claim PROVEN — it
// resolved too little of its own behavior for "no violation" to mean anything (the
// PROVEN-COMPLETE vs PROVEN-PARTIAL line). Measured floor: real PROVEN apps sit at 60%+
// (fixtures) / 71%+ (corpus); the hollow cases (cal-api-v2, 175 routes / 1 effect) are
// ~0%. 5% cleanly separates them with headroom. Coverage-gating only downgrades a CLEAN
// app (findings.length === 0) → it can never hide a real finding behind SURFACE.
const COVERAGE_FLOOR = 0.05;

// The PROVEN-COMPLETE line. A clean app whose coverage sits between the floor and this bar
// resolved a real slice of its behavior — enough to say "no violation in what I saw" — but
// left a meaningful fraction of its surface invisible to the static eye. That is a PARTIAL
// proof, not a complete one: honest packaging demands the word carry the difference, so a
// skeptic never reads a bare "PROVEN" over 23% of the routes and calls it a bluff. Measured:
// real complete proofs sit at 60%+ (fixtures) / 71%+ (corpus); the partial cases (cal.com,
// 175 routes / 23% coverage) fall below. Purely a LABEL refinement — it never masks a
// finding, never changes the CI gate; a PARTIAL app is still clean, just qualified.
const COVERAGE_COMPLETE = 0.6;

export function verdictOf(findings, graph, { coverage, blindHigh = 0 } = {}) {
  const counts = { critical: 0, high: 0, medium: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  // Advisory findings (BOLA/IDOR, ADR-058) are absence-based and FP-prone: they point a
  // human at routes to review, they never GATE the verdict. So the PROVEN/SURFACE gates
  // count only HARD findings — an advisory can't flip a genuinely-clean app off PROVEN.
  const hardCount = findings.filter((f) => !f.advisory).length;
  // Provability guard: a compile that reached ZERO entrypoints proved nothing —
  // an empty graph must never read as PROVEN/RISKY. A parser-coverage miss (a
  // route surface the static eye could not see) has to be loud, not a silent
  // green. `safe`/`clean` fold `provable` in, so every caller that gates on them
  // (apocalypse & review both `exit 1` on !safe) refuses a blind compile for free.
  // `graph` omitted (e.g. heal's regression delta, which isn't a whole-app
  // proof) → provability is not asserted and the old semantics hold.
  const entrypoints = graph
    ? graph.nodes.filter((n) => n.kind === 'entrypoint').length
    : null;
  const provable = entrypoints === null || entrypoints > 0;
  const observed = graph ? countObserved(graph) : null;
  // only assert surface-only for a WHOLE-app proof (graph given with entrypoints);
  // a partial graph (heal's delta, entrypoints===null) keeps the old semantics.
  // Basis is mutation-capable behavior (countProvable), not raw observed: reads-only
  // is surface (nothing to prove safety about), which stops the reads-only hollow PROVEN.
  const provableBehavior = graph ? countProvable(graph) : null;
  // A CLEAN app that resolved almost none of its behavior (coverage below the floor) is
  // SURFACE, not PROVEN — the coverage-graded verdict. Guarded by findings.length === 0
  // so it only ever downgrades a would-be-PROVEN app, never masks a NOT_PROVEN one
  // (surfaceOnly outranks NOT_PROVEN in the verdict word, so this MUST stay clean-only).
  const lowCoverage = coverage != null && coverage < COVERAGE_FLOOR && hardCount === 0;
  const surfaceOnly =
    provable && entrypoints > 0 && (provableBehavior === 0 || lowCoverage);
  // guard provenance: how many guards did SPARDA actually VERIFY (see a deny path in
  // the body) vs only assert by name (opaque middleware/decorators it couldn't read).
  // Honest signal — it does not change the verdict, but it tells you how much of the
  // auth posture rests on trust vs proof.
  const guards = graph ? graph.nodes.filter((n) => n.kind === 'guard') : [];
  const guardsVerified = guards.filter((g) => g.meta?.verified).length;
  // A clean whole-app proof below the completeness bar is PARTIAL — proved, but not over
  // the whole surface. Only meaningful when coverage was measured (whole-app run); a partial
  // graph (heal delta, coverage undefined) is never labelled partial.
  //
  // E-047 (the blind-spot rung, from the cal.com giant test): coverage is a RATIO, so on a
  // huge app it can clear the bar (cal.com/api/v2: 71%) while the ABSOLUTE count of high-risk
  // blind spots is large (46 guarded mutations whose writes never resolved). A bare "PROVEN"
  // over 46 unproven high-risk mutations over-claims. So a clean app is also PARTIAL when any
  // high-severity blind spot remains — the label carries the uncertainty (metrology's error
  // bars), independent of the ratio. Sound: only ever SOFTENS PROVEN→PARTIAL, never masks a
  // finding, never touches the CI gate (`safe`). blindHigh defaults to 0, so a caller that
  // did not survey blind spots (heal delta) is unaffected.
  const clean = provable && !surfaceOnly && hardCount === 0;
  const partial =
    clean &&
    entrypoints > 0 &&
    ((coverage != null && coverage < COVERAGE_COMPLETE) || blindHigh > 0);
  // `safe` is the CI gate (block a risky deploy): a surface-only app has no
  // critical/high findings and is NOT risky, so it does not fail the gate — it just
  // isn't a positive proof. `clean` is the strong claim (PROVEN) and DOES require
  // observed behavior, so a hollow "everything's fine" can never read as PROVEN.
  return {
    counts,
    entrypoints,
    observed,
    provable,
    surfaceOnly,
    guards: guards.length,
    guardsVerified,
    safe: provable && counts.critical === 0 && counts.high === 0,
    clean,
    partial,
    complete: clean && !partial,
  };
}

// The one verdict word, from a verdictOf() result. The single source of truth every surface
// (prove, badge, CI) shares, so the public artifact can never disagree with the CLI — and the
// PARTIAL rung is baked in, so a badge can never read "PROVEN" over a 23%-resolved app.
export function verdictState(verdict) {
  return !verdict.provable
    ? 'NO_PROOF'
    : verdict.surfaceOnly
      ? 'SURFACE'
      : verdict.clean
        ? verdict.partial
          ? 'PARTIAL'
          : 'PROVEN'
        : verdict.safe
          ? 'RISKY'
          : 'NOT_PROVEN';
}

// shields.io "flat" palette — the colour IS a claim, so it tracks the verdict exactly.
const BADGE_COLOR = {
  PROVEN: '#4c1', // brightgreen — a complete proof
  PARTIAL: '#dfb317', // yellow — proved, but not over the whole surface
  RISKY: '#fe7d37', // orange — no critical/high, but findings to review
  NOT_PROVEN: '#e05d44', // red — a real critical/high finding
  SURFACE: '#9f9f9f', // grey — not enough behaviour resolved to prove
  NO_PROOF: '#9f9f9f', // grey — 0 routes
};

// The badge label/colour for a verdict — the single source `badge` and `prove --markdown`
// both consume, so the SVG file and the PR comment can never show different words. Inherits
// verdictState, so the PARTIAL anti-overclaim rung is automatic everywhere a badge appears.
export function badgeFor(verdict, { coverage } = {}) {
  const state = verdictState(verdict);
  const cov = coverage != null ? Math.round(coverage * 100) : null;
  const c = verdict.counts ?? { critical: 0, high: 0, medium: 0, info: 0 };
  const message =
    state === 'PROVEN'
      ? `proven · ${cov}%`
      : state === 'PARTIAL'
        ? `partial · ${cov}%`
        : state === 'SURFACE'
          ? `surface · ${cov}%`
          : state === 'NO_PROOF'
            ? 'no routes'
            : state === 'RISKY'
              ? `review · ${c.medium + c.info}`
              : `${c.critical + c.high} findings`;
  return { state, message, color: BADGE_COLOR[state] };
}

function sortFindings(findings) {
  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      cmp(a.rule, b.rule) ||
      cmp(a.entrypoint, b.entrypoint),
  );
}

const fmtStates = (writes) =>
  [...new Set(writes.map((w) => w.stateId.split(':').pop()))].sort().join(', ');

const fmtInvariant = (inv) =>
  inv.type === 'check'
    ? `CHECK (${inv.expression})`
    : `${inv.type.toUpperCase()} (${(inv.fields ?? []).join(', ')})`;
