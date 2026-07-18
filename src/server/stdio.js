// server/stdio.js — MCP stdio bridge (spec: blueprint 05-MCP-SERVER)
// CRITICAL: stdout is the MCP protocol. All human logs -> stderr. (pitfall #1)
import fs from 'node:fs';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { sanitizeDescription } from '../security/sanitize.js';
import { createIdleHarvester } from './idle.js';
import { createSequenceRecorder, sequenceRecordingEnabled } from './condenser.js';
import {
  eligibleForCrystallization,
  remapComposites,
  fallbackComposite,
  normalizeCompositeName,
  compositeSchema,
  runComposite,
} from './crystallize.js';
import { writeManifestSync, mergeManifestKeySync } from './persistence.js';
import { createSpardaEngine } from './engine.js';
import { initiateWrite, preapproveWrite, confirmWrite } from './confirmation.js';
import { resolveContext, injectContext, fingerprintContext } from './context-carrier.js';
import { resolveSpardaKey } from '../generator/manifest.js';
import { compileUBG } from '../ubg/compile.js';
import { canonicalizeGraph } from '../ubg/schema.js';
import { checkGraph, diffGraphs, verdictOf, verdictState } from '../ubg/apocalypse.js';
import { surveyBlindspots } from '../ubg/blindspots.js';

const EVENT_POLL_MS = Number(process.env.SPARDA_EVENT_POLL_MS ?? 5000);

// Built-in MCP prompts (workflows) served by every SPARDA server, regardless of the app's own
// inferred workflows. `prove-my-edit` is the discoverability surface for `sparda_prove`: the
// workflow an editing agent lists and follows to check its OWN change before committing — the
// one check an LLM cannot do to itself by re-reading its code.
export const BUILTIN_WORKFLOWS = [
  {
    name: 'prove-my-edit',
    description:
      "Prove an edit didn't break a guard before you commit — the check an LLM can't do to itself by re-reading its own code.",
    steps: [
      'Call sparda_prove. If you just edited one route, pass route with its method+path (e.g. "DELETE /orders") to focus the finding list — the verdict still reflects the whole app.',
      'Read the verdict: PROVEN / PARTIAL are safe to commit. SURFACE / NO_PROOF mean SPARDA could not resolve enough to prove it — treat that as "unknown", never as a pass.',
      'Fix every finding with regression:true first — that edit removed a guard, dropped a route, or grew the blast radius vs the last proven baseline.',
      'If baselined is false, run `sparda apocalypse --save-baseline` once on a known-good state so future sparda_prove calls can catch regressions.',
    ],
  },
];

// App-inferred workflows (carry-over, sacred) win on a name clash; built-ins fill the rest.
export function mergeWorkflows(appWorkflows) {
  const out = [...(appWorkflows ?? [])];
  for (const b of BUILTIN_WORKFLOWS) {
    if (!out.some((w) => w.name === b.name)) out.push(b);
  }
  return out;
}
// Advertised MCP server version — read from package.json so it can never drift from the
// published package (it was pinned at a stale '0.5.2' for many releases).
const SPARDA_VERSION = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ).version;
  } catch {
    return '0.0.0';
  }
})();
// the sampling budgets below are also what the recycling gauge counts as "avoided"
// when cached knowledge short-circuits a call — the estimate is honest by construction
const DIAGNOSIS_TOKENS = 120;
const SEMANTIC_TOKENS = 1500;
const CRYSTAL_TOKENS = 150; // naming a crystallized circuit: once per circuit, ever

export async function startStdioBridge({ cwd, portOverride }) {
  // pitfall #1: neutralize any stray console.log from deps
  console.log = (...a) => console.error(...a);

  const manifestPath = path.join(cwd, 'sparda.json');
  if (!fs.existsSync(manifestPath)) {
    throw Object.assign(new Error('sparda.json not found.'), {
      code: 'USER',
      hint: 'Run `npx sparda-mcp init` first.',
    });
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    // A truncated/garbled sparda.json (interrupted write, bad merge) must fail
    // with the same code:'USER'+hint discipline used everywhere else — never a
    // raw SyntaxError that crashes the bridge with an unreadable stack.
    throw Object.assign(
      new Error(`sparda.json is unreadable or corrupted: ${e.message}`),
      {
        code: 'USER',
        hint: 'Restore it from git, or re-run `npx sparda-mcp init` to regenerate.',
      },
    );
  }
  const port = Number(portOverride ?? manifest.port);
  const framework = manifest.framework;
  const key = resolveSpardaKey(cwd, manifest);
  if (!key) {
    throw Object.assign(new Error('localKey missing or not configured.'), {
      code: 'USER',
      hint: 'Re-run `npx sparda-mcp init` to generate it, or set SPARDA_LOCAL_KEY.',
    });
  }

  // Brief #4 — tenant context carrier. Resolved ONCE, here, from operator-pinned
  // sources (CLI --context > env SPARDA_CONTEXT_* > sparda.json names the headers).
  // The AI is the adversary and can forge anything it sends; pinning at launch (not
  // per call) is the only scope it cannot choose. Throws USER on CRLF/over-bound so
  // a malformed scope stops the bridge instead of degrading to "no scope". Absent
  // config → frozen empty map → injectContext is a no-op (byte-identical forwarding).
  const ctx = resolveContext({
    argv: process.argv,
    env: process.env,
    config: manifest.contextPropagation ?? null,
  });
  const ctxFp = fingerprintContext(ctx); // value-free: names + 8-hex SHA-256 only (R2/R7)
  if (Object.keys(ctxFp).length > 0) {
    console.error(
      `[sparda] context carrier active (forwarded verbatim on every host call): ${JSON.stringify(ctxFp)}`,
    );
  }

  const base = await waitForHost(port, key, framework, ctx);

  // full tool specs live in the generated router; fetch them (single source of truth)
  const toolSpecs = await (
    await fetch(`${base}/mcp/tools`, { headers: hostHeaders(key, ctx) })
  ).json();

  const enabled = () => Object.entries(toolSpecs).filter(([, t]) => t.enabled);
  const disabled = () => Object.entries(toolSpecs).filter(([, t]) => !t.enabled);

  const server = new Server(
    { name: `sparda-${path.basename(cwd)}`, version: SPARDA_VERSION },
    {
      capabilities: {
        tools: { listChanged: true },
        prompts: { listChanged: true },
        logging: {},
      },
    },
  );

  // R4.1, intelligence side of the gauge: sampling calls NOT spent because cached
  // knowledge (semantic pass, antibodies) answered instead. Compute side lives in
  // the router (/mcp/stats.recycle).
  const intel = { samplingAvoided: 0, tokensAvoidedEst: 0 };

  // R4.4: every internal organ works only when the event loop is quiet
  const harvester = createIdleHarvester();
  // engine (Bloc B, slice 1 — "cerveau de stabilité"): a passive per-tool read of
  // which response fields stay put vs move. Fed off the hot path via the harvester,
  // holds field fingerprints only (never values, ADR-014), runtime-only — no
  // carry-over, same posture as the router's purity detector.
  const engine = createSpardaEngine();
  // R4.3 kill-switch (decision A, ADR-020): the flywheel SERVES proven-stable reads
  // from memory by default. SPARDA_FLYWHEEL=off keeps every organ learning but stops
  // serving, so a suspect cache can be cut without losing the brain. Gated here at the
  // bridge; the engine itself stays env-free.
  const flywheelServes = process.env.SPARDA_FLYWHEEL !== 'off';
  // R2.1 (Labs, default OFF): record the current of calls, detect circuits;
  // R2.2: at the observation threshold a circuit crystallizes into a composite tool
  const composites = new Map(); // composite tool name -> { sig, circuit }
  const recorder = sequenceRecordingEnabled(manifest)
    ? createSequenceRecorder({
        manifest,
        manifestPath,
        harvester,
        onCircuit: (sig, c) => {
          crystallizeCircuit(sig, c).catch((e) =>
            console.error(`[sparda] crystallization skipped: ${e.message}`),
          );
        },
      })
    : null;

  const compositeNameTaken = (n) =>
    Boolean(toolSpecs[n]) ||
    composites.has(n) ||
    ['sparda_info', 'sparda_list_disabled_tools', 'sparda_get_context'].includes(n);
  const uniqueCompositeName = (base) => {
    if (!compositeNameTaken(base)) return base;
    for (let i = 2; ; i++) if (!compositeNameTaken(`${base}_${i}`)) return `${base}_${i}`;
  };

  async function crystallizeCircuit(sig, circuit) {
    if (circuit.composite || !eligibleForCrystallization(circuit, toolSpecs)) {
      // observed but not crystallizable (write step, missing fromKey…): say so, once
      await server
        .sendLoggingMessage({
          level: 'info',
          logger: 'sparda',
          data: {
            source: 'condenser',
            circuit: sig,
            seen: circuit.seen,
            note: `circuit observed ${circuit.seen}× — not crystallized (composites are GET-only and need a traceable data flow)`,
          },
        })
        .catch(() => {});
      return;
    }
    // the client's LLM names the newborn (one call, ever); no sampling → deterministic name
    let named = null;
    if (server.getClientCapabilities()?.sampling) {
      try {
        const flow = circuit.links
          .map(
            (l) =>
              `'${l.arg}' of ${l.to} comes from '${l.fromKey}' in the response of ${l.from}`,
          )
          .join('; ');
        const res = await server.createMessage({
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `A repeated tool-call sequence was observed ${circuit.seen}× in a live ${manifest.framework} app:\nsteps: ${circuit.steps.join(' -> ')}\ndata flow: ${flow}\ntools:\n${circuit.steps.map((s) => `- ${s}: ${toolSpecs[s].method} ${toolSpecs[s].path}`).join('\n')}\n\nReply with ONLY a JSON object {"name": "<snake_case verb_noun, max 40 chars>", "description": "<one sentence: what this combined operation achieves in business terms>"}.`,
              },
            },
          ],
          maxTokens: CRYSTAL_TOKENS,
        });
        const raw = res?.content?.type === 'text' ? res.content.text : '';
        const parsed = JSON.parse(
          raw.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, ''),
        );
        const name = normalizeCompositeName(parsed.name);
        const { text: desc, flagged } = sanitizeDescription(
          String(parsed.description ?? ''),
          '',
        );
        if (name && desc && !flagged)
          named = { name, description: desc, source: 'mcp-sampling' };
      } catch {
        /* graceful degradation: deterministic naming below */
      }
    }
    const comp = named ?? fallbackComposite(circuit);
    comp.name = uniqueCompositeName(comp.name);
    comp.createdAt = new Date().toISOString();
    circuit.composite = comp;
    persistLabs(manifestPath, manifest);
    composites.set(comp.name, { sig, circuit });
    await server.sendToolListChanged().catch(() => {});
    await server
      .sendLoggingMessage({
        level: 'info',
        logger: 'sparda',
        data: {
          source: 'condenser',
          circuit: sig,
          composite: comp.name,
          note: `circuit observed ${circuit.seen}× — crystallized as composite tool '${comp.name}' (born mid-session, see tools/list)`,
        },
      })
      .catch(() => {});
    console.error(`[sparda] condenser: circuit ${sig} crystallized as ${comp.name}`);
  }

  // composites born in past sessions wake up with the bridge — re-validated
  // against today's tools (a route may have changed or been disabled since)
  if (recorder) {
    // R2.4 — nothing disappears, x becomes y: a step whose route was renamed is
    // re-mapped to its UNIQUE deterministic successor instead of killing the
    // composite silently; the unmappable go dormant WITH a recorded lesson.
    const { remapped, dormant } = remapComposites(
      manifest.labs?.circuits ?? {},
      toolSpecs,
    );
    for (const [sig, c] of Object.entries(manifest.labs?.circuits ?? {})) {
      if (c.composite?.name && eligibleForCrystallization(c, toolSpecs)) {
        composites.set(uniqueCompositeName(c.composite.name), { sig, circuit: c });
      }
    }
    for (const r of remapped) {
      delete manifest.labs.circuits[r.oldKey];
      manifest.labs.circuits[r.newKey] = r.circuit;
      composites.set(uniqueCompositeName(r.circuit.composite.name), {
        sig: r.newKey,
        circuit: r.circuit,
      });
      manifest.sparding ??= {};
      manifest.sparding.events ??= [];
      manifest.sparding.events.push({
        ts: new Date().toISOString(),
        tool: r.circuit.composite.name,
        decision: 'audit',
        risk: 'low',
        reasons: [
          `composite re-mapped (R2.4): ${Object.entries(r.renames)
            .map(([a, b]) => `${a} → ${b}`)
            .join(', ')}`,
        ],
      });
      if (manifest.sparding.events.length > 100) manifest.sparding.events.shift();
      console.error(
        `[sparda] R2.4: composite '${r.circuit.composite.name}' re-mapped (${Object.entries(
          r.renames,
        )
          .map(([a, b]) => `${a} → ${b}`)
          .join(', ')})`,
      );
    }
    for (const d of dormant) {
      manifest.sparding ??= {};
      manifest.sparding.failures ??= {};
      const fsig = `composite|${d.composite}|dormant`;
      const prev = manifest.sparding.failures[fsig] ?? { count: 0, lesson: '' };
      manifest.sparding.failures[fsig] = { count: prev.count + 1, lesson: d.reason };
      console.error(`[sparda] R2.4: composite '${d.composite}' dormant — ${d.reason}`);
    }
    if (remapped.length || dormant.length) {
      mergeManifestKeySync(manifestPath, 'labs', manifest.labs);
      mergeManifestKeySync(manifestPath, 'sparding', manifest.sparding);
    }
  }

  const descFor = (name, t) => {
    const semantic = manifest.semantic?.descriptions?.[name];
    const text = semantic || t.description || `${t.method} ${t.path}`;
    return `${t.confidence === 'low' ? '[partial schema] ' : ''}${text}`;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...enabled().map(([name, t]) => ({
        name,
        description: descFor(name, t),
        inputSchema: schemaFor(t),
        annotations: annotationsFor(t.method),
      })),
      // crystallized circuits (Labs): tools nobody wrote, condensed from real usage
      ...[...composites.entries()].map(([name, { circuit }]) => ({
        name,
        description: `[Labs circuit ×${circuit.seen}] ${circuit.composite.description}`,
        inputSchema: compositeSchema(circuit, toolSpecs),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        }, // GET-only by construction
      })),
      {
        name: 'sparda_info',
        description:
          'Info about this MCP server. Generated by SPARDA (npx sparda-mcp init) — turn any codebase into an MCP server in 3 minutes. By Residual Labs (residual-labs.fr) — github.com/zyx77550/sparda',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'sparda_list_disabled_tools',
        description:
          'Lists write tools (POST/PUT/DELETE) disabled by SPARDA write-safety, and how to enable them.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'sparda_get_context',
        description:
          'Call this FIRST. Returns the full living context of this app: every tool with its description, known workflows, runtime telemetry (per-tool calls/errors/latency), quarantined tools, and the immune memory of past diagnosed failures. Lets any AI session resume exactly where the previous one stopped.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'sparda_prove',
        description:
          'Prove this app is safe to deploy — NOW, before you commit. Compiles the current source to its behavior graph and discharges the static proof obligations (unguarded mutation, non-atomic aggregate write, unvalidated constrained write). If a baseline was saved (`sparda apocalypse --save-baseline`), it ALSO diffs against it: any finding flagged `regression:true` means your edit removed a guard, dropped a route, or grew the blast radius vs the last proven state — the check an LLM cannot do to itself by re-reading code. Returns a deterministic verdict (PROVEN / PARTIAL / SURFACE / NO_PROOF / RISKY / NOT_PROVEN), the coverage % it resolved, and every finding with its route. The verdict is the exact word `sparda apocalypse` and the badge emit; it never over-claims (a low-coverage clean app reads SURFACE/PARTIAL, never a bare PROVEN). Pass `route` (e.g. "DELETE /orders") to focus the finding list on the route you just edited — the verdict still reflects the whole app.',
        inputSchema: {
          type: 'object',
          properties: {
            route: {
              type: 'string',
              description:
                'Optional. Substring of a route label (method + path, e.g. "POST /invoices") to filter the findings to the route you just edited. Omit to see the whole app.',
            },
          },
        },
      },
      {
        name: 'sparda_confirm',
        description:
          'Confirms a pending write or delete operation gated by human-in-the-loop policies using its confirmation token.',
        inputSchema: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description:
                'The confirmation token returned by the gated invoke response.',
            },
          },
          required: ['token'],
        },
      },
    ],
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: mergeWorkflows(manifest.semantic?.workflows).map((w) => ({
      name: w.name,
      description: w.description,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const w = mergeWorkflows(manifest.semantic?.workflows).find(
      (x) => x.name === req.params.name,
    );
    if (!w) throw new Error(`unknown prompt: ${req.params.name}`);
    return {
      description: w.description,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Goal: ${w.description}\n\nUse the available SPARDA tools in this order, adapting arguments from each result:\n${w.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;

    if (name === 'sparda_info') {
      return text(
        JSON.stringify(
          {
            project: path.basename(cwd),
            framework: manifest.framework,
            tools_enabled: enabled().length,
            tools_disabled_write_safety: disabled().length,
            workflows: (manifest.semantic?.workflows ?? []).length,
            immune_antibodies: Object.keys(manifest.immune?.antibodies ?? {}).length,
            labs_sequence_recording: recorder
              ? 'on'
              : 'off (opt-in: set labs.recordSequences=true in sparda.json)',
            circuits_observed: Object.keys(manifest.labs?.circuits ?? {}).length,
            composite_tools: composites.size,
            generated_by:
              'SPARDA by Residual Labs (residual-labs.fr) — npx sparda-mcp init — github.com/zyx77550/sparda',
          },
          null,
          2,
        ),
      );
    }
    if (name === 'sparda_prove') {
      return text(JSON.stringify(proveApp(cwd, { route: args.route }), null, 2));
    }
    if (name === 'sparda_get_context') {
      const headers = hostHeaders(key, ctx);
      const [stats, events] = await Promise.all([
        fetch(`${base}/mcp/stats`, { headers, signal: AbortSignal.timeout(2000) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`${base}/mcp/events?since=0`, {
          headers,
          signal: AbortSignal.timeout(2000),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      // lifetime savings are derived from antibody hits — no extra state to maintain:
      // the first hit paid the diagnosis, every later one was served from memory
      const antibodyHits = Object.values(manifest.immune?.antibodies ?? {}).reduce(
        (n, a) => n + Math.max(0, (a.hits ?? 1) - 1),
        0,
      );
      const behavior = engine.snapshot();
      const fly = behavior.flywheel.stats;
      return text(
        JSON.stringify(
          {
            project: path.basename(cwd),
            framework: manifest.framework,
            port,
            tools: Object.fromEntries(
              Object.entries(toolSpecs).map(([n, t]) => [
                n,
                {
                  method: t.method,
                  path: t.path,
                  enabled: t.enabled,
                  description: descFor(n, t),
                },
              ]),
            ),
            workflows: manifest.semantic?.workflows ?? [],
            runtime: stats,
            recentEvents: (events?.events ?? []).slice(-20),
            immuneMemory: manifest.immune?.antibodies ?? {},
            recycling: {
              compute: stats?.recycle ?? null,
              // R4.3: host calls the flywheel answered from its own RAM — a category the
              // router cannot count, because the request never reached it. armed = reads
              // proven stable enough to serve right now.
              flywheel: { servedFromMemory: fly.served, armed: fly.ready },
              intelligence: {
                session: {
                  samplingAvoided: intel.samplingAvoided,
                  tokensAvoidedEst: intel.tokensAvoidedEst,
                },
                lifetime: {
                  antibodyHits,
                  tokensAvoidedEst: antibodyHits * DIAGNOSIS_TOKENS,
                },
              },
            },
            sparding: manifest.sparding ?? {},
            behavior,
            labs: {
              recordSequences: Boolean(recorder),
              compositeTools: [...composites.keys()],
              circuits: manifest.labs?.circuits ?? {},
            },
            hint: "runtime.quarantine lists tools temporarily blocked by the immune system (503 until cooldown). immuneMemory maps failure signatures (source|tool|status) to cached diagnoses — same failure later costs zero tokens. recycling measures how much compute/intelligence was served from SPARDA's own memory instead of being paid again. runtime.purity classifies each route by observation: pure = same args keep returning the same response (recyclable), volatile = it changed, erasing = writes. labs.circuits are observed call sequences where one tool's output fed the next one's input. behavior.stability is the engine's passive read of each tool across this session: stable lists response fields that never changed (predictable — future recycling candidates), volatile lists fields that moved; calls is how many responses were observed. behavior.rhythm flags tools called on a steady cadence (periodMs = the beat, confidence 0-1, nextEstimate = when the next call is expected) — a regular rhythm plus a stable result is the textbook pre-fetch candidate. behavior.myelin learns habitual tool succession: an edge \"A-->B\" means B tends to be called right after A; strength (0-10) grows with every traversal and myelinated edges (strength>=3) are entrenched habits — succession candidates the condenser misses because no data flows between the two tools. behavior.dependencies is the engine's map of what the other observers cannot see: invariants are response fields that stayed conserved (>=85% over >=5 reads) even while writes hit the app — true constants, the safest thing to cache hard; ghosts are hidden couplings where a write tool reliably MOVES some unrelated read (writeTool affects a different read tool, correlation 0-1), discovered purely by observation — no data flows between them and they need not be adjacent, yet the write keeps perturbing that read. behavior.flywheel is Bloc B acting on all of the above: once a read has returned the identical response >=3 times for the same arguments it is served straight from memory and the host call is skipped entirely (R4.3), with ready = how many reads are armed to serve right now; recycling.flywheel.servedFromMemory counts how many host calls were already answered from RAM this session — the one recycling category the router cannot see, because the request never reached it (SPARDA_FLYWHEEL=off stops serving while every organ keeps learning).",
          },
          null,
          2,
        ),
      );
    }
    if (name === 'sparda_list_disabled_tools') {
      return text(
        disabled().length
          ? `Disabled (write-safety):\n${disabled()
              .map(([n, t]) => `- ${n} (${t.method} ${t.path})`)
              .join(
                '\n',
              )}\n\nTo enable: set "enabled": true in sparda.json, then re-run \`npx sparda-mcp init\` and restart this bridge.`
          : 'No disabled tools.',
      );
    }
    if (name === 'sparda_confirm') {
      const token = args.token;
      if (typeof token !== 'string' || !token) {
        return {
          content: [
            { type: 'text', text: 'Error: missing or invalid confirmation token.' },
          ],
          isError: true,
        };
      }
      // SIGNAL 2 (Brief #1): the AI holds the token (Signal 1, reachable over stdio) but the
      // write proceeds only if a human approved out-of-band — an OS-dialog click, or a prior
      // native-elicitation accept. Neither channel is reachable by the AI, so a self-issued
      // confirm can no longer pass. Necessary-but-not-sufficient by construction.
      const gate = confirmWrite(token);
      if (!gate.ok) {
        return {
          content: [{ type: 'text', text: signal2Denial(gate.reason) }],
          isError: true,
        };
      }
      const payload = await confirmInvoke(base, key, token, ctx);
      if (payload === null) {
        return {
          content: [
            {
              type: 'text',
              text: `Host app error. Check that your server is still running on :${port}.`,
            },
          ],
          isError: true,
        };
      }
      const pretty = JSON.stringify(payload, null, 2);
      const isError =
        payload.upstreamStatus !== undefined
          ? payload.upstreamStatus >= 400
          : Boolean(payload.error);
      return { content: [{ type: 'text', text: pretty }], isError };
    }

    // composite tools run their whole chain (GET-only by construction — no
    // write confirmation to bypass), auto-feeding linked args between steps
    const comp = composites.get(name);
    if (comp) {
      const result = await runComposite({
        circuit: comp.circuit,
        args,
        toolSpecs,
        invokeFn: (tool, a) => invoke(base, key, tool, a, ctx),
      });
      const pretty = JSON.stringify(result, null, 2);
      return {
        content: [
          {
            type: 'text',
            text:
              pretty.length > 8000
                ? `${pretty.slice(0, 8000)}\n[truncated — ${pretty.length} chars total]`
                : pretty,
          },
        ],
        isError: !result.ok,
      };
    }

    const spec = toolSpecs[name];
    const isWrite = spec && spec.method !== 'GET';

    // human-in-the-loop, channel 1: confirm writes natively in the client UI when supported.
    // A native accept is a real out-of-band human yes — it pre-approves Signal 2 below, so the
    // host's confirm round-trip never prompts the operator a second time.
    let elicitationApproved = false;
    if (isWrite && server.getClientCapabilities()?.elicitation) {
      const answer = await server
        .elicitInput({
          message: `SPARDA: allow ${spec.method} ${spec.path}? This is a write operation on your live app.`,
          requestedSchema: {
            type: 'object',
            properties: {
              confirm: { type: 'boolean', title: `Allow ${spec.method} ${spec.path}` },
            },
            required: ['confirm'],
          },
        })
        .catch(() => null);
      if (!answer || answer.action !== 'accept' || answer.content?.confirm !== true) {
        const mockProof = {
          version: 'sparding-proof/v0.1',
          risk: 'blocked',
          decision: 'block',
          reasons: ['Write declined by user'],
        };
        recordSparding(manifestPath, manifest, name, mockProof);
        return {
          content: [
            {
              type: 'text',
              text: `Write declined by user: ${spec.method} ${spec.path} was NOT executed.`,
            },
          ],
          isError: true,
        };
      }
      elicitationApproved = true;
    }

    // Bloc B flywheel (R4.3): the first organ that ACTS. For a read proven stable —
    // the same response >=3x for these exact args, within TTL — serve straight from the
    // engine's RAM and never make the host call. Writes always fall through to the host
    // (and still pass write-confirmation above), so hard rule #3 is untouched. The served
    // `data` is byte-identical to what the host returned; servedByFlywheel marks the
    // envelope so a hit is observable. Not re-observed (that would feed the cache itself).
    if (spec && !isWrite && flywheelServes) {
      const cached = engine.preCall(name, args);
      if (cached.hit) {
        const body = { data: cached.value, upstreamStatus: 200, servedByFlywheel: true };
        const pretty = JSON.stringify(body, null, 2);
        const truncated =
          pretty.length > 8000
            ? `${pretty.slice(0, 8000)}\n[truncated — ${pretty.length} chars total]`
            : pretty;
        return { content: [{ type: 'text', text: truncated }], isError: false };
      }
    }

    const payload = await invoke(base, key, name, args, ctx);
    if (payload === null) {
      const mockProof = {
        version: 'sparding-proof/v0.1',
        risk: 'blocked',
        decision: 'block',
        reasons: ['Host app error or unreachable'],
      };
      recordSparding(manifestPath, manifest, name, mockProof);
      return {
        content: [
          {
            type: 'text',
            text: `Host app error. Check that your server is still running on :${port}.`,
          },
        ],
        isError: true,
      };
    }

    // human-in-the-loop, channel 2 (Brief #1): the host gated this write and minted a single-use
    // confirm token. Arm Signal 2 NOW, keyed by that token. Elicitation clients already have a
    // human yes → pre-approve (no second prompt). Everyone else gets an OS dialog (fires async,
    // R1) that `sparda_confirm` will require before the write can run. This is what closes the
    // forgeable-confirmation hole on clients without elicitation.
    if (
      isWrite &&
      payload.status === 'awaiting_confirmation' &&
      typeof payload.confirm === 'string'
    ) {
      if (elicitationApproved) preapproveWrite(payload.confirm);
      else
        initiateWrite({ token: payload.confirm, label: `${spec.method} ${spec.path}` });
    }

    const proofForRecord = payload.spardingProof
      ? { ...payload.spardingProof }
      : { version: 'sparding-proof/v0.1', decision: 'allow', risk: 'low', reasons: [] };
    if (payload.upstreamStatus !== undefined && payload.upstreamStatus >= 400) {
      proofForRecord.isExecutionError = true;
      proofForRecord.reasons = [
        ...(proofForRecord.reasons || []),
        `upstream error status ${payload.upstreamStatus}`,
      ];
    } else if (payload.error) {
      proofForRecord.isExecutionError = true;
      proofForRecord.reasons = [
        ...(proofForRecord.reasons || []),
        `invocation error: ${payload.error}`,
      ];
    }
    recordSparding(manifestPath, manifest, name, proofForRecord);

    // successful AI-driven reads feed SPARDA's passive observers, both off the hot
    // path (idle harvester). Internal read-backs and failures are not workflow steps.
    if (payload.upstreamStatus !== undefined && payload.upstreamStatus < 400) {
      // engine: stability + rhythm + myelin (Blocs A/B) and the dependency map
      // (Bloc D — invariants conserved across writes, ghost write->read couplings).
      // isWrite lets Bloc D tell a state read from a mutation. Capture the call time
      // here on the hot path; classify in idle. (The proof-after-write read-back below
      // is internal, not an AI workflow step, so it is deliberately not observed.)
      const observedAt = Date.now();
      harvester.enqueue(() =>
        engine.observe(name, payload.data, observedAt, isWrite, args),
      );
      // condenser tap (Labs, opt-in): detect circuits where one output feeds the next
      if (recorder) recorder.record(name, args, payload.data);
    }

    // proof-after-write: re-read the same path so the AI sees the effect of its write
    let proof = null;
    if (isWrite && payload.upstreamStatus < 400) {
      // flywheel coherence (5b): this write just moved whatever a GET on the same path
      // returns, so drop that GET's cached answer NOW — synchronous, before the next read
      // can be served stale. The engine purges by learned ghost couplings in idle; this
      // covers the structural same-path case it can't see (no path info in the engine).
      for (const [n, t] of Object.entries(toolSpecs)) {
        if (t.method === 'GET' && t.path === spec.path) engine.invalidateCache(n);
      }
      const getter = Object.entries(toolSpecs).find(
        ([, t]) => t.enabled && t.method === 'GET' && t.path === spec.path,
      );
      if (getter) {
        const after = await invoke(base, key, getter[0], pickPathArgs(spec, args), ctx);
        if (after && after.upstreamStatus < 400)
          proof = { readBack: getter[0], state: after.data };
      }
    }

    const body = proof ? { ...payload, proof } : payload;
    const pretty = JSON.stringify(body, null, 2);
    const truncated =
      pretty.length > 8000
        ? `${pretty.slice(0, 8000)}\n[truncated — ${pretty.length} chars total]`
        : pretty;
    // router-level rejections (quarantine, disabled tool, bad params) carry `error` and no upstreamStatus
    const isError =
      payload.upstreamStatus !== undefined
        ? payload.upstreamStatus >= 400
        : Boolean(payload.error);
    return { content: [{ type: 'text', text: truncated }], isError };
  });

  let pollTimer = null;
  server.oninitialized = () => {
    // a session resumed on a cached semantic pass skipped the enrichment sampling call
    if (manifest.semantic) {
      intel.samplingAvoided += 1;
      intel.tokensAvoidedEst += SEMANTIC_TOKENS;
    }
    pollTimer = startEventPolling(server, base, key, manifest, manifestPath, intel, ctx);
    runSemanticEnrichment({ server, manifest, manifestPath, toolSpecs }).catch((e) =>
      console.error(`[sparda] semantic pass skipped: ${e.message}`),
    );
  };
  server.onclose = () => {
    if (pollTimer) clearInterval(pollTimer);
    harvester.flush(); // pending knowledge must reach disk before the lights go out
    harvester.stop();
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[sparda] MCP bridge running. ${enabled().length} tools enabled, ${disabled().length} disabled (write-safety).${recorder ? ' Labs: sequence recording ON.' : ''} Host: ${base}`,
  );
}

// One place to build the outbound header set for any bridge→host call. The
// operator-pinned tenant context (Brief #4) is copied on LAST so it is always
// present and can never be shadowed by a per-call header — the AI cannot forge
// the scope. When context is off, injectContext is a no-op and the headers are
// byte-identical to before.
function hostHeaders(key, ctx, extra) {
  const h = { 'x-sparda-key': key, ...(extra ?? {}) };
  injectContext(h, ctx);
  return h;
}

async function invoke(base, key, tool, args, ctx) {
  try {
    const res = await fetch(`${base}/mcp/invoke`, {
      method: 'POST',
      headers: hostHeaders(key, ctx, { 'content-type': 'application/json' }),
      body: JSON.stringify({ tool, args }),
      signal: AbortSignal.timeout(30_000),
    });
    return await res.json().catch(() => ({
      upstreamStatus: res.status,
      error: 'non-JSON response from host',
    }));
  } catch {
    return null;
  }
}

async function confirmInvoke(base, key, token, ctx) {
  try {
    const res = await fetch(`${base}/mcp/invoke/confirm`, {
      method: 'POST',
      headers: hostHeaders(key, ctx, { 'content-type': 'application/json' }),
      body: JSON.stringify({ confirm: token }),
      signal: AbortSignal.timeout(30_000),
    });
    return await res.json().catch(() => ({
      upstreamStatus: res.status,
      error: 'non-JSON response from host',
    }));
  } catch {
    return null;
  }
}

// keep only the path params of the original call so the read-back targets the same resource
function pickPathArgs(spec, args) {
  const out = {};
  for (const p of spec.pathParams ?? []) if (args[p] !== undefined) out[p] = args[p];
  return out;
}

// live error feed: host app errors reach the AI as MCP logging notifications.
// immune memory: known failure signatures carry their cached diagnosis (zero tokens);
// new signatures wake the client's LLM once, and the antibody is stored in sparda.json.
function startEventPolling(server, base, key, manifest, manifestPath, intel, ctx) {
  let lastSeq = null; // first poll sets the baseline; only NEW errors are reported
  const timer = setInterval(async () => {
    try {
      const r = await fetch(`${base}/mcp/events?since=${lastSeq ?? 0}`, {
        headers: hostHeaders(key, ctx),
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) return;
      const { seq, events } = await r.json();
      if (lastSeq === null) {
        lastSeq = seq;
        return;
      }
      lastSeq = Math.max(lastSeq, seq);
      for (const ev of events) {
        const sig = `${ev.source}|${ev.tool ?? ''}|${ev.status ?? ''}`;
        const antibody = manifest.immune?.antibodies?.[sig];
        if (antibody) {
          antibody.hits = (antibody.hits ?? 0) + 1;
          antibody.lastSeen = ev.ts;
          intel.samplingAvoided += 1; // this diagnosis would have been a sampling call
          intel.tokensAvoidedEst += DIAGNOSIS_TOKENS;
          persistImmune(manifestPath, manifest);
          await server
            .sendLoggingMessage({
              level: 'error',
              logger: 'sparda',
              data: { ...ev, diagnosis: antibody.diagnosis },
            })
            .catch(() => {});
        } else {
          await server
            .sendLoggingMessage({ level: 'error', logger: 'sparda', data: ev })
            .catch(() => {});
          diagnoseAndRemember({ server, manifest, manifestPath, ev, sig }).catch(
            () => {},
          );
        }
      }
    } catch {
      /* host briefly unreachable — next tick */
    }
  }, EVENT_POLL_MS);
  timer.unref?.();
  return timer;
}

// adaptive immunity: costly intelligence is summoned only when the body has a fever,
// and the diagnosis is remembered so the same fever never costs tokens again.
const diagnosing = new Set();
async function diagnoseAndRemember({ server, manifest, manifestPath, ev, sig }) {
  if (!server.getClientCapabilities()?.sampling) return;
  if (diagnosing.has(sig)) return;
  manifest.immune ??= {};
  manifest.immune.antibodies ??= {};
  const antibodies = manifest.immune.antibodies;
  if (antibodies[sig] || Object.keys(antibodies).length >= 50) return; // bounded memory
  diagnosing.add(sig);
  try {
    const res = await server.createMessage({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `A tool of a live ${manifest.framework} app just failed.\nTool: ${ev.tool ?? 'n/a'}\nSource: ${ev.source}\nStatus: ${ev.status ?? 'n/a'}\nError message: ${ev.message}\n\nReply with ONE short sentence (max 140 chars): most likely root cause and fix direction. No preamble.`,
          },
        },
      ],
      maxTokens: DIAGNOSIS_TOKENS,
    });
    const raw = res?.content?.type === 'text' ? res.content.text.trim() : '';
    const { text: clean, flagged } = sanitizeDescription(raw, '');
    if (!clean || flagged) return;
    antibodies[sig] = { diagnosis: clean, firstSeen: ev.ts, lastSeen: ev.ts, hits: 1 };
    persistImmune(manifestPath, manifest);
    await server
      .sendLoggingMessage({
        level: 'info',
        logger: 'sparda',
        data: {
          source: 'immune',
          signature: sig,
          diagnosis: clean,
          note: 'antibody stored in sparda.json — the same failure will be diagnosed instantly, zero tokens',
        },
      })
      .catch(() => {});
    console.error(`[sparda] immune: antibody stored for ${sig}`);
  } finally {
    diagnosing.delete(sig);
  }
}

function persistImmune(manifestPath, manifest) {
  // merge-write (atomic + fsync): re-read so we never clobber sparding/labs/
  // semantic written by another path; on a brief disk hiccup the antibody
  // stays in memory and the next write retries.
  mergeManifestKeySync(manifestPath, 'immune', manifest.immune);
}

function recordSparding(manifestPath, manifest, tool, proof) {
  try {
    manifest.sparding ??= {
      version: 1,
      policies: {},
      events: [],
      failures: {},
      toolFingerprints: {},
    };
    manifest.sparding.events ??= [];
    manifest.sparding.failures ??= {};

    const event = {
      ts: new Date().toISOString(),
      tool,
      decision: proof.decision,
      risk: proof.risk,
      reasons: proof.reasons || [],
    };
    manifest.sparding.events.push(event);
    if (manifest.sparding.events.length > 100) {
      manifest.sparding.events.shift();
    }

    const isBlock = proof.decision === 'block';
    const isError = proof.isExecutionError;
    if (isBlock || isError) {
      const reasonCode =
        proof.reasons && proof.reasons[0]
          ? proof.reasons[0].replace(/\s+/g, '_').toLowerCase()
          : 'unknown_error';
      const sig = `${tool}|${reasonCode}`;
      const prevFail = manifest.sparding.failures[sig] || { count: 0, lesson: '' };

      let lesson = `Execution failed for tool: ${tool}.`;
      if (reasonCode.includes('quarantined')) {
        lesson = `Tool ${tool} was quarantined due to repeated failures.`;
      } else if (reasonCode.includes('disabled')) {
        lesson = `Tool ${tool} is disabled by write-safety policies.`;
      } else if (
        reasonCode.includes('missing_path_param') ||
        reasonCode.includes('missing_path')
      ) {
        lesson = `Client omitted a required path parameter on route ${tool}.`;
      } else if (reasonCode.includes('declined')) {
        lesson = `Human user declined confirmation for write tool ${tool}.`;
      } else if (reasonCode.includes('policy_blocks')) {
        lesson = `Security policies blocked the execution of ${tool}.`;
      } else if (reasonCode.includes('upstream')) {
        lesson = `Host application returned an error status code on route ${tool}.`;
      }

      manifest.sparding.failures[sig] = {
        count: prevFail.count + 1,
        lastSeen: new Date().toISOString(),
        lesson,
      };
    }
    persistSparding(manifestPath, manifest);
  } catch (err) {
    console.error(`[sparda] failed to record sparding proof: ${err.message}`);
  }
}

function persistSparding(manifestPath, manifest) {
  mergeManifestKeySync(manifestPath, 'sparding', manifest.sparding);
}

function persistLabs(manifestPath, manifest) {
  // value depends on the re-read (merge into labs, keep other labs fields), so
  // this can't use mergeManifestKeySync — but the write is still atomic+fsync.
  try {
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    onDisk.labs = { ...onDisk.labs, circuits: manifest.labs.circuits };
    writeManifestSync(manifestPath, onDisk);
  } catch {
    /* disk briefly unavailable — the circuit stays in memory */
  }
}

// semantic pass: uses the CLIENT's own model via MCP sampling — zero key, zero cost.
// Runs once, result cached in sparda.json (and preserved across re-init).
async function runSemanticEnrichment({ server, manifest, manifestPath, toolSpecs }) {
  if (manifest.semantic || !server.getClientCapabilities()?.sampling) return;

  const inventory = Object.entries(toolSpecs)
    .map(
      ([n, t]) =>
        `- ${n}: ${t.method} ${t.path}${t.description ? ` — ${t.description}` : ''}`,
    )
    .join('\n');
  const res = await server.createMessage({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `These are API tools extracted from a ${manifest.framework} codebase:\n${inventory}\n\nReply with ONLY a JSON object, no prose, shaped as {"descriptions": {"<tool>": "<one clear sentence of what it does in business terms>"}, "workflows": [{"name": "<snake_case>", "description": "<goal>", "steps": ["<tool>", ...]}]}. Include 1-3 workflows that chain tools toward a realistic business goal. Use only the tool names listed above.`,
        },
      },
    ],
    maxTokens: SEMANTIC_TOKENS,
  });

  const raw = res?.content?.type === 'text' ? res.content.text : '';
  const parsed = JSON.parse(raw.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, ''));

  const descriptions = {};
  for (const [n, d] of Object.entries(parsed.descriptions ?? {})) {
    if (!toolSpecs[n] || typeof d !== 'string') continue;
    const { text: clean, flagged } = sanitizeDescription(d, '');
    if (clean && !flagged) descriptions[n] = clean;
  }
  const workflows = (Array.isArray(parsed.workflows) ? parsed.workflows : [])
    .filter(
      (w) =>
        w &&
        typeof w.name === 'string' &&
        typeof w.description === 'string' &&
        Array.isArray(w.steps),
    )
    .slice(0, 5)
    .map((w) => ({
      name: w.name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 60),
      description: sanitizeDescription(w.description, 'workflow').text,
      steps: w.steps.filter((s) => typeof s === 'string' && toolSpecs[s]),
    }))
    .filter((w) => w.steps.length > 0);

  manifest.semantic = {
    enrichedAt: new Date().toISOString(),
    source: 'mcp-sampling',
    descriptions,
    workflows,
  };
  mergeManifestKeySync(manifestPath, 'semantic', manifest.semantic);

  await server.sendToolListChanged().catch(() => {});
  await server.sendPromptListChanged().catch(() => {});
  console.error(
    `[sparda] semantic pass done: ${Object.keys(descriptions).length} descriptions, ${workflows.length} workflows (cached in sparda.json)`,
  );
}

// MCP annotations: without them clients assume the scariest defaults and show
// destructive-looking hints on plain reads (E2E P2 finding). HTTP maps 1:1.
function annotationsFor(method) {
  return {
    readOnlyHint: method === 'GET',
    destructiveHint: method === 'DELETE',
    idempotentHint: method === 'GET' || method === 'PUT' || method === 'DELETE',
    openWorldHint: false, // a local API behind the router, not the open internet
  };
}

function schemaFor(t) {
  const properties = {};
  const required = [];
  for (const p of t.params ?? []) {
    properties[p.name] = {
      type: p.type === 'unknown' ? 'string' : p.type,
      description: p.description ?? p.in,
    };
    if (p.required) required.push(p.name);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function text(t) {
  return { content: [{ type: 'text', text: t }] };
}

// The proof layer, served live over MCP — same compile + obligations as `sparda apocalypse`,
// so an AI can prove its own edit structurally the moment it writes it, not a CI run later.
// Reuses `verdictState` verbatim: this tool physically cannot show a word the CLI/badge won't
// (the no-false-PROVEN invariant is one function, shared). Read-only (write:false); an
// AI-initiated call, never on the host's request path, so Law 1 holds.
//   opts.route  — substring; keep only findings on routes whose label matches (focus the
//                 answer on the route the AI just edited, e.g. "DELETE /orders").
export function proveApp(cwd, { route } = {}) {
  let canonical, report;
  try {
    const compiled = compileUBG(cwd, { write: false });
    canonical = canonicalizeGraph(compiled.graph);
    report = compiled.report;
  } catch (err) {
    // A parser gap is NOT a pass — say so honestly, never a silent green.
    return {
      verdict: 'NO_PROOF',
      provable: false,
      note: `SPARDA could not compile this app's surface (${err.message}). An uncompiled app proves nothing — this is NOT a pass.`,
    };
  }
  const { findings: staticFindings, obligations } = checkGraph(canonical);

  // Baseline diff — the regression check that IS apocalypse's edge over a plain linter: did
  // this edit REMOVE a guard, drop a route, or grow the blast radius vs the last saved proof?
  // Only if a baseline was recorded (`sparda apocalypse --save-baseline`); absent → static only.
  let diffFindings = [];
  let baselined = false;
  const baselinePath = path.join(cwd, '.sparda', 'ubg.baseline.json');
  if (fs.existsSync(baselinePath)) {
    try {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      diffFindings = diffGraphs(baseline, canonical).findings;
      baselined = true;
    } catch {
      // unreadable baseline → degrade to static-only, never crash the AI's call
    }
  }

  const all = [...staticFindings, ...diffFindings];
  const label = (id) => canonical.nodes.find((n) => n.id === id)?.label ?? id;
  let findings = all.map((f) => ({
    severity: f.severity,
    rule: f.rule,
    route: label(f.entrypoint),
    regression: diffFindings.includes(f),
    message: f.message,
  }));
  if (route) {
    const needle = route.toLowerCase();
    findings = findings.filter((f) => f.route.toLowerCase().includes(needle));
  }

  const blind = surveyBlindspots(canonical, report);
  // The verdict word always reflects the WHOLE app (a route filter narrows the finding list,
  // never the safety claim — an AI must never read "PROVEN" because it hid the rest).
  const verdict = verdictOf(all, canonical, {
    coverage: blind.coverage.ratio,
    blindHigh: blind.byRisk.critical + blind.byRisk.high,
  });
  return {
    verdict: verdictState(verdict),
    provable: verdict.provable,
    coverage: Math.round(blind.coverage.ratio * 100) / 100,
    baselined,
    obligations,
    counts: verdict.counts,
    findings,
    blindspots: { surface: blind.surface, coverage: blind.coverage.ratio },
    ...(route ? { scopedTo: route } : {}),
  };
}

// AI-facing message when the Signal-2 gate (Brief #1) refuses a `sparda_confirm`. Each reason
// tells the model what to do next without implying it can approve the write itself.
function signal2Denial(reason) {
  switch (reason) {
    case 'awaiting_human':
      return 'Awaiting human approval. A confirmation dialog is open on the host machine — the operator must click Allow. You cannot approve this yourself. Call sparda_confirm again with the same token once the operator has approved.';
    case 'human_denied':
      return 'The operator DENIED this write at the host confirmation dialog. It was NOT executed. Do not retry this token.';
    case 'unknown_token':
      return 'Unknown or already-used confirmation token. Re-issue the write to mint a fresh token (which opens a new human approval dialog).';
    case 'expired':
      return 'The confirmation expired before a human approved it. Re-issue the write to try again.';
    default:
      return 'Confirmation could not be validated. Re-issue the write to mint a fresh token.';
  }
}

async function waitForHost(port, key, framework, ctx) {
  const hosts = ['127.0.0.1', 'localhost'];
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const h of hosts) {
      try {
        const r = await fetch(`http://${h}:${port}/mcp/tools`, {
          headers: hostHeaders(key, ctx),
          signal: AbortSignal.timeout(1500),
        });
        if (r.ok) return `http://${h}:${port}`;
        if (r.status === 401)
          throw Object.assign(
            new Error(
              'Host app reachable but key mismatch — re-run `npx sparda-mcp init`.',
            ),
            { code: 'USER' },
          );
      } catch (e) {
        if (e.code === 'USER') throw e;
      }
    }
    if (attempt === 0) {
      const startCmd = framework === 'fastapi' ? 'fastapi dev' : 'npm run dev';
      console.error(
        `[sparda] Waiting for host app on :${port} ... (start it with ${startCmd} — Ctrl+C to abort)`,
      );
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw Object.assign(new Error(`Host app unreachable on :${port} after 2 minutes.`), {
    code: 'USER',
    hint: 'Start your server first, then run `npx sparda-mcp dev`.',
  });
}
