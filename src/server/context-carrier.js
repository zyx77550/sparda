/**
 * OpaqueContextCarrier — SPARDA Bridge
 *
 * Pattern: Passive, operator-pinned transport of caller identity/context
 * from bridge launch into every forwarded host request.
 *
 * §0 correction (CLAUDE.md): context is resolved ONCE at bridge startup
 * from operator-supplied sources (CLI flag > env var > sparda.json).
 * It is NEVER caller-supplied per-call — the AI cannot choose the tenant.
 *
 * Domain transfer:
 *   Optical fiber       — passive transport, selectivity at the edges
 *   Blind signatures    — forward without seeing or interpreting
 *   Membrane transport  — channel without selectivity; host boundary enforces
 *
 * Invariants:
 *   1. Context resolved once at startup; frozen thereafter.
 *   2. Forwarded verbatim on every host call — never interpreted, never modified.
 *   3. Bounded memory: max 8 headers × 1024 bytes.
 *   4. CRLF guard: illegal control chars → startup throw, bridge does not start.
 *   5. Value-free observability: logs name + 8-hex SHA-256 only, never the value.
 *   6. Absent config → feature off, zero overhead, byte-identical forwarding.
 */

import { createHash } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_HEADERS = 8;
const MAX_VALUE_BYTES = 1024;

/**
 * Env var naming convention:
 *   Header name  →  env var
 *   X-Tenant-Id  →  SPARDA_CONTEXT_X_Tenant_Id
 *   Rule: prepend SPARDA_CONTEXT_, replace hyphens with underscores.
 *
 * Rationale: hyphens are invalid in POSIX env var names; underscores are safe
 * on all platforms (Linux case-sensitive, Windows case-insensitive — both fine).
 */
const ENV_PREFIX = 'SPARDA_CONTEXT_';

/** CLI flag: --context Header-Name=value (repeatable) */
const CLI_FLAG = '--context';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Convert a header name to its env var counterpart.
 * X-Tenant-Id → SPARDA_CONTEXT_X_Tenant_Id
 *
 * @param {string} headerName
 * @returns {string}
 */
function headerToEnvKey(headerName) {
  return ENV_PREFIX + headerName.replace(/-/g, '_');
}

/**
 * CRLF guard — fail closed at startup.
 * A value containing CR, LF, or NUL could split the HTTP request
 * and inject arbitrary headers. We refuse to start, never silently strip.
 *
 * @param {string} headerName
 * @param {string} value
 * @throws {Error} code:'USER' if illegal control chars present
 */
function assertNoCRLF(headerName, value) {
  if (/[\r\n\0]/.test(value)) {
    throw Object.assign(
      new Error(`context value for "${headerName}" has illegal control chars`),
      {
        code: 'USER',
        hint: `${headerName} must be a single header line — no CR, LF, or NUL`
      }
    );
  }
}

/**
 * Validate contextPropagation config from sparda.json.
 * Fail-closed: anything outside the schema is rejected.
 *
 * Note: `from` field is optional in the new model (values come from CLI/env).
 * If present it may be "launch" or omitted entirely — "mcp.session.metadata"
 * is rejected (that source is gone per §0).
 *
 * @param {unknown} config
 * @returns {{ valid: boolean, error?: Error }}
 */
export function validateConfig(config) {
  if (config === null || config === undefined) {
    return { valid: true }; // absent = feature off, not an error
  }

  if (typeof config !== 'object' || Array.isArray(config)) {
    return {
      valid: false,
      error: Object.assign(
        new Error('contextPropagation must be an object'),
        { code: 'USER', hint: 'Remove the key or provide a valid object' }
      )
    };
  }

  // mode must be "verbatim" if present
  if (config.mode !== undefined && config.mode !== 'verbatim') {
    return {
      valid: false,
      error: Object.assign(
        new Error('contextPropagation.mode must be "verbatim"'),
        { code: 'USER', hint: 'Only "verbatim" is supported — SPARDA never interprets context' }
      )
    };
  }

  // from: "mcp.session.metadata" is the old, insecure source — reject explicitly
  if (config.from === 'mcp.session.metadata') {
    return {
      valid: false,
      error: Object.assign(
        new Error('contextPropagation.from "mcp.session.metadata" is not supported (§0: caller-supplied context is insecure)'),
        { code: 'USER', hint: 'Remove "from" or set it to "launch". Values come from CLI flag or env vars.' }
      )
    };
  }

  // from: if present, must be "launch"
  if (config.from !== undefined && config.from !== 'launch') {
    return {
      valid: false,
      error: Object.assign(
        new Error('contextPropagation.from must be "launch" or absent'),
        { code: 'USER', hint: 'Only operator-pinned launch-time context is supported' }
      )
    };
  }

  // headers must be an array if present
  if (config.headers !== undefined) {
    if (!Array.isArray(config.headers)) {
      return {
        valid: false,
        error: Object.assign(
          new Error('contextPropagation.headers must be an array'),
          { code: 'USER', hint: 'Provide an array of header name strings' }
        )
      };
    }

    if (config.headers.length > MAX_HEADERS) {
      return {
        valid: false,
        error: Object.assign(
          new Error(`contextPropagation.headers exceeds max ${MAX_HEADERS} items`),
          { code: 'USER', hint: `Reduce to ${MAX_HEADERS} headers or fewer` }
        )
      };
    }

    for (const h of config.headers) {
      if (typeof h !== 'string' || h.length === 0) {
        return {
          valid: false,
          error: Object.assign(
            new Error('Each header must be a non-empty string'),
            { code: 'USER', hint: 'Check all items in contextPropagation.headers' }
          )
        };
      }
    }
  }

  return { valid: true };
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * resolveContext — called ONCE at bridge startup.
 *
 * Resolves the operator-pinned context in this precedence (first present wins):
 *   1. CLI flags:   --context X-Tenant-Id=acme  (repeatable, one per header)
 *   2. Env vars:    SPARDA_CONTEXT_X_Tenant_Id=acme
 *   3. sparda.json: contextPropagation.headers declares which headers to look for;
 *                   their values still come from CLI / env (never hardcoded in JSON).
 *
 * If contextPropagation is absent → returns a frozen empty object (feature off).
 *
 * Throws USER error at startup if:
 *   - config is invalid
 *   - any pinned value contains CR, LF, or NUL (CRLF guard)
 *   - more than MAX_HEADERS headers
 *   - any value exceeds MAX_VALUE_BYTES
 *
 * @param {{ argv?: string[], env?: Record<string,string>, config?: unknown }} opts
 * @returns {Readonly<{ headers: Readonly<Record<string,string>> }>}
 */
export function resolveContext({ argv = [], env = {}, config = null } = {}) {
  // Feature off when no config
  if (!config || !config.headers || config.headers.length === 0) {
    return Object.freeze({ headers: Object.freeze({}) });
  }

  const validation = validateConfig(config);
  if (!validation.valid) {
    throw validation.error;
  }

  const declaredHeaders = config.headers; // already validated: array of non-empty strings
  const resolved = {};

  // Parse CLI flags once: --context Key=value (repeatable)
  const cliValues = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === CLI_FLAG && i + 1 < argv.length) {
      const pair = argv[i + 1];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const k = pair.slice(0, eq);
        const v = pair.slice(eq + 1);
        cliValues[k] = v;
      }
      i++; // skip the value token
    } else if (argv[i].startsWith(CLI_FLAG + '=')) {
      // --context=Key=value form (less common but handle it)
      const rest = argv[i].slice(CLI_FLAG.length + 1);
      const eq = rest.indexOf('=');
      if (eq > 0) {
        cliValues[rest.slice(0, eq)] = rest.slice(eq + 1);
      }
    } else if (argv[i].startsWith(CLI_FLAG + ' ')) {
      // shouldn't happen after shell splitting, but be safe
    }
  }

  for (const headerName of declaredHeaders) {
    let value;

    // 1. CLI flag (highest precedence)
    if (Object.prototype.hasOwnProperty.call(cliValues, headerName)) {
      value = cliValues[headerName];
    }
    // 2. Env var
    else {
      const envKey = headerToEnvKey(headerName);
      if (Object.prototype.hasOwnProperty.call(env, envKey)) {
        value = env[envKey];
      }
    }
    // 3. Not found → skip (feature gracefully absent for this header)

    if (value !== undefined) {
      // CRLF guard — fail closed, never strip
      assertNoCRLF(headerName, value);

      // Bounds check — measure BYTES, not UTF-16 code units: a multibyte value
      // (é, 你, 😀) can be ≤ MAX_VALUE_BYTES in .length yet blow the byte budget.
      // The bound is named *_BYTES and the wire is bytes, so byteLength is correct.
      if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
        throw Object.assign(
          new Error(`context value for "${headerName}" exceeds ${MAX_VALUE_BYTES} bytes`),
          { code: 'USER', hint: 'Shorten the value or split across multiple headers' }
        );
      }

      resolved[headerName] = value;
    }
  }

  // Bounds: total header count (defensive — already bounded by declaredHeaders.length ≤ 8)
  if (Object.keys(resolved).length > MAX_HEADERS) {
    throw Object.assign(
      new Error(`context exceeds max ${MAX_HEADERS} headers`),
      { code: 'USER', hint: `Declare at most ${MAX_HEADERS} headers in contextPropagation` }
    );
  }

  return Object.freeze({ headers: Object.freeze(resolved) });
}

/**
 * injectContext — called on EVERY forwarded host call (hot path).
 *
 * Copies the operator-pinned headers verbatim onto the outbound header object.
 * O(1) in the number of declared headers (max 8). Zero allocation beyond the copy.
 *
 * The AI cannot influence this: ctx is frozen at startup.
 *
 * @param {Record<string,string>} outboundHeaders — mutated in place
 * @param {Readonly<{ headers: Readonly<Record<string,string>> }>} ctx — from resolveContext
 */
export function injectContext(outboundHeaders, ctx) {
  if (!ctx || !ctx.headers) return;
  // Verbatim copy — no transformation, no encoding, no interpretation
  for (const [name, value] of Object.entries(ctx.headers)) {
    outboundHeaders[name] = value;
  }
}

/**
 * fingerprintContext — value-free observability.
 *
 * Returns header names + 8-hex SHA-256 of each value.
 * Never the raw value. Safe for stderr logs (R2).
 *
 * @param {Readonly<{ headers: Readonly<Record<string,string>> }>} ctx
 * @returns {Record<string, { present: boolean, hash: string }>}
 */
export function fingerprintContext(ctx) {
  const fp = {};
  if (!ctx || !ctx.headers) return fp;
  for (const [name, value] of Object.entries(ctx.headers)) {
    fp[name] = {
      present: true,
      hash: createHash('sha256').update(value).digest('hex').slice(0, 8)
    };
  }
  return fp;
}

export default { resolveContext, injectContext, fingerprintContext, validateConfig };
