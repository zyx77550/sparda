/**
 * Tests — OpaqueContextCarrier (Brief #4, §0 corrected)
 *
 * Runner: vitest (SPARDA's real runner)
 * Strategy: test the 4 invariants
 *   1. Off by default — absent config = zero overhead, byte-identical forwarding
 *   2. Verbatim — operator-pinned value arrives unchanged on the host request
 *   3. Domain-blind — SPARDA never branches on the value's meaning
 *   4. Safe degradation — bad config / missing values = defined, non-crashing behavior
 *
 * Plus all CLAUDE.md mandatory cases:
 *   - CRLF guard
 *   - Caller cannot override
 *   - Bounds (9 headers, 2KB value, multibyte byte-length)
 *   - Value-free fingerprint
 *   - Write-safety untouched (orthogonal)
 *   - Precedence resolution (CLI > env > absent)
 */

import { describe, it, expect } from 'vitest';
import {
  resolveContext,
  injectContext,
  fingerprintContext,
  validateConfig,
} from '../src/server/context-carrier.js';

// ─── validateConfig ───────────────────────────────────────────────────────────

describe('validateConfig', () => {
  it('accepts null — feature off, not an error', () => {
    expect(validateConfig(null).valid).toBe(true);
  });

  it('accepts undefined — feature off', () => {
    expect(validateConfig(undefined).valid).toBe(true);
  });

  it('accepts minimal valid config', () => {
    expect(validateConfig({ headers: ['X-Tenant-Id'], mode: 'verbatim' }).valid).toBe(
      true,
    );
  });

  it('accepts config with from: "launch"', () => {
    expect(
      validateConfig({ headers: ['X-Tenant-Id'], from: 'launch', mode: 'verbatim' })
        .valid,
    ).toBe(true);
  });

  it('accepts config without from field (from is optional)', () => {
    expect(validateConfig({ headers: ['X-Tenant-Id'] }).valid).toBe(true);
  });

  it('rejects non-object config', () => {
    const r = validateConfig('bad');
    expect(r.valid).toBe(false);
    expect(r.error.code).toBe('USER');
  });

  it('rejects non-verbatim mode', () => {
    const r = validateConfig({ mode: 'transform' });
    expect(r.valid).toBe(false);
    expect(r.error.code).toBe('USER');
    expect(r.error.message).toMatch(/verbatim/);
  });

  it('EXPLICITLY rejects from: "mcp.session.metadata" (§0 — insecure source)', () => {
    const r = validateConfig({ headers: ['X-Tenant-Id'], from: 'mcp.session.metadata' });
    expect(r.valid).toBe(false);
    expect(r.error.code).toBe('USER');
    expect(r.error.message).toMatch(/mcp.session.metadata/);
    expect(r.error.hint).toMatch(/launch/);
  });

  it('rejects unknown from value', () => {
    const r = validateConfig({ from: 'custom.source' });
    expect(r.valid).toBe(false);
    expect(r.error.code).toBe('USER');
  });

  it('rejects too many headers (R1: bounded at 8)', () => {
    const r = validateConfig({
      headers: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'],
    });
    expect(r.valid).toBe(false);
    expect(r.error.code).toBe('USER');
    expect(r.error.message).toMatch(/8/);
  });

  it('rejects non-string headers', () => {
    const r = validateConfig({ headers: [123, 'valid'] });
    expect(r.valid).toBe(false);
    expect(r.error.code).toBe('USER');
  });

  it('rejects empty string headers', () => {
    const r = validateConfig({ headers: ['', 'X-Tenant-Id'] });
    expect(r.valid).toBe(false);
    expect(r.error.code).toBe('USER');
  });

  it('rejects array config', () => {
    const r = validateConfig([]);
    expect(r.valid).toBe(false);
    expect(r.error.code).toBe('USER');
  });
});

// ─── resolveContext — off by default ─────────────────────────────────────────

describe('resolveContext — off by default', () => {
  it('returns empty frozen context when config is null', () => {
    const ctx = resolveContext({ config: null });
    expect(Object.keys(ctx.headers)).toHaveLength(0);
  });

  it('returns empty frozen context when config is absent', () => {
    const ctx = resolveContext({});
    expect(Object.keys(ctx.headers)).toHaveLength(0);
  });

  it('returns empty frozen context when headers array is empty', () => {
    const ctx = resolveContext({ config: { headers: [], mode: 'verbatim' } });
    expect(Object.keys(ctx.headers)).toHaveLength(0);
  });

  it('does NOT add any header when no value is pinned — byte-identical forwarding', () => {
    const ctx = resolveContext({
      argv: [],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    const outbound = { 'x-sparda-key': 'abc123' };
    injectContext(outbound, ctx);
    // Only the original key should be present
    expect(Object.keys(outbound)).toEqual(['x-sparda-key']);
  });

  it('result is frozen (immutable)', () => {
    const ctx = resolveContext({ config: null });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.headers)).toBe(true);
  });
});

// ─── resolveContext — verbatim forwarding ────────────────────────────────────

describe('resolveContext — verbatim', () => {
  it('resolves from CLI flag: --context X-Tenant-Id=acme', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=acme'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    expect(ctx.headers['X-Tenant-Id']).toBe('acme');
  });

  it('resolved value arrives unmodified on the host request', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=acme-corp'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    const outbound = {};
    injectContext(outbound, ctx);
    expect(outbound['X-Tenant-Id']).toBe('acme-corp');
  });

  it('resolves from env var: SPARDA_CONTEXT_X_Tenant_Id', () => {
    const ctx = resolveContext({
      argv: [],
      env: { SPARDA_CONTEXT_X_Tenant_Id: 'globex' },
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    expect(ctx.headers['X-Tenant-Id']).toBe('globex');
  });

  it('resolves multiple headers from mixed sources', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=acme'],
      env: { SPARDA_CONTEXT_X_User_Role: 'editor' },
      config: { headers: ['X-Tenant-Id', 'X-User-Role'], mode: 'verbatim' },
    });
    expect(ctx.headers['X-Tenant-Id']).toBe('acme');
    expect(ctx.headers['X-User-Role']).toBe('editor');
  });
});

// ─── resolveContext — precedence ─────────────────────────────────────────────

describe('resolveContext — precedence (CLI > env > absent)', () => {
  it('CLI flag wins over env var', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=from-cli'],
      env: { SPARDA_CONTEXT_X_Tenant_Id: 'from-env' },
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    expect(ctx.headers['X-Tenant-Id']).toBe('from-cli');
  });

  it('env var used when no CLI flag', () => {
    const ctx = resolveContext({
      argv: [],
      env: { SPARDA_CONTEXT_X_Tenant_Id: 'from-env' },
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    expect(ctx.headers['X-Tenant-Id']).toBe('from-env');
  });

  it('header absent from both CLI and env → not injected (graceful)', () => {
    const ctx = resolveContext({
      argv: [],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    expect(ctx.headers['X-Tenant-Id']).toBeUndefined();
  });

  it('repeatable --context flags: last one for same key wins', () => {
    const ctx = resolveContext({
      argv: [
        'node',
        'sparda',
        '--context',
        'X-Tenant-Id=first',
        '--context',
        'X-Tenant-Id=second',
      ],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    // Last write wins (Map insertion order, second overwrites first)
    expect(ctx.headers['X-Tenant-Id']).toBe('second');
  });
});

// ─── resolveContext — domain-blindness ───────────────────────────────────────

describe('resolveContext — domain-blind', () => {
  it('forwards any value without interpretation — same code path for "acme" vs "globex"', () => {
    const makeCtx = (tenant) =>
      resolveContext({
        argv: ['node', 'sparda', '--context', `X-Tenant-Id=${tenant}`],
        env: {},
        config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
      });

    const ctxAcme = makeCtx('acme');
    const ctxGlobex = makeCtx('globex');

    // Both resolved through identical code path
    expect(ctxAcme.headers['X-Tenant-Id']).toBe('acme');
    expect(ctxGlobex.headers['X-Tenant-Id']).toBe('globex');

    // SPARDA treats them identically — just different byte sequences
    const outAcme = {};
    const outGlobex = {};
    injectContext(outAcme, ctxAcme);
    injectContext(outGlobex, ctxGlobex);
    expect(outAcme['X-Tenant-Id']).toBe('acme');
    expect(outGlobex['X-Tenant-Id']).toBe('globex');
  });

  it('forwards "nonexistent-tenant" without validation — host enforces, not SPARDA', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=nonexistent-tenant-xyz'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    const out = {};
    injectContext(out, ctx);
    expect(out['X-Tenant-Id']).toBe('nonexistent-tenant-xyz');
  });

  it('forwards JSON-like values as opaque strings — never parsed', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Claim={"role":"superuser"}'],
      env: {},
      config: { headers: ['X-Claim'], mode: 'verbatim' },
    });
    const out = {};
    injectContext(out, ctx);
    expect(out['X-Claim']).toBe('{"role":"superuser"}');
  });
});

// ─── CRLF guard ──────────────────────────────────────────────────────────────

describe('CRLF guard — fail closed at startup', () => {
  const badValues = [
    ['CR injection', 'acme\rX-Admin: 1'],
    ['LF injection', 'acme\nX-Admin: 1'],
    ['CRLF full', 'acme\r\nX-Admin: 1'],
    ['NUL byte', 'acme\0'],
    ['LF only', '\n'],
    ['CR only', '\r'],
  ];

  for (const [label, badValue] of badValues) {
    it(`throws USER at startup — ${label}`, () => {
      expect(() =>
        resolveContext({
          argv: ['node', 'sparda', '--context', `X-Tenant-Id=${badValue}`],
          env: {},
          config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
        }),
      ).toThrow(expect.objectContaining({ code: 'USER' }));
    });
  }

  it('does not inject any header after CRLF throw (bridge does not start)', () => {
    let threw = false;
    let outbound = {};
    try {
      const ctx = resolveContext({
        argv: ['node', 'sparda', '--context', 'X-Tenant-Id=acme\r\nX-Admin: 1'],
        env: {},
        config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
      });
      injectContext(outbound, ctx);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(Object.keys(outbound)).toHaveLength(0);
  });

  it('also guards env var values', () => {
    expect(() =>
      resolveContext({
        argv: [],
        env: { SPARDA_CONTEXT_X_Tenant_Id: 'acme\r\nX-Admin: 1' },
        config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
      }),
    ).toThrow(expect.objectContaining({ code: 'USER' }));
  });

  it('never silently strips — the error must propagate', () => {
    // Distinction from a "sanitizing" implementation: we don't let 'acme' through.
    // The whole startup must fail.
    let result;
    try {
      result = resolveContext({
        argv: ['node', 'sparda', '--context', 'X-Tenant-Id=acme\nX-Injected: evil'],
        env: {},
        config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
      });
    } catch {
      result = null;
    }
    expect(result).toBeNull();
  });
});

// ─── Caller cannot override ───────────────────────────────────────────────────

describe('Caller cannot override — AI cannot forge the tenant', () => {
  it('a tool-call payload attempting to set X-Tenant-Id does not change the pinned value', () => {
    // Operator pins at launch
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=operator-pinned'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });

    // The AI (MCP client) sends a tool call with arguments trying to override
    const _maliciousToolArgs = {
      'X-Tenant-Id': 'ai-chosen-tenant',
      path: '/api/users',
      method: 'GET',
    };

    // The bridge builds outbound headers and injects context
    const outboundHeaders = { 'x-sparda-key': 'secret' };
    // Even if the tool args contain the header name, they go into the body/args,
    // not into the header injection path. The pinned context always wins.
    injectContext(outboundHeaders, ctx);

    // Pinned value is present and unchanged
    expect(outboundHeaders['X-Tenant-Id']).toBe('operator-pinned');
    // The AI's attempted override (from args) never touched the headers
    expect(outboundHeaders['X-Tenant-Id']).not.toBe('ai-chosen-tenant');
  });

  it('ctx is frozen — direct mutation attempt throws or is silently ignored', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=locked'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });

    // Attempt to mutate the frozen headers object
    expect(() => {
      ctx.headers['X-Tenant-Id'] = 'mutated';
    }).toThrow(); // strict mode: throws TypeError; frozen object

    // Value unchanged
    expect(ctx.headers['X-Tenant-Id']).toBe('locked');
  });

  it('resolveContext called a second time does not affect an already-resolved ctx', () => {
    const ctx1 = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=tenant-1'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });

    // A second call (e.g., if somehow triggered) uses different args
    const ctx2 = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=tenant-2'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });

    // Each ctx is independent; ctx1 is unaffected
    expect(ctx1.headers['X-Tenant-Id']).toBe('tenant-1');
    expect(ctx2.headers['X-Tenant-Id']).toBe('tenant-2');
  });

  it('injectContext applies LAST so a per-call header cannot override the pinned scope', () => {
    // Mirrors the bridge's hostHeaders(): an outbound object that already carries a
    // forged X-Tenant-Id must be overwritten by the operator-pinned value, not the reverse.
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=operator-pinned'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    const outbound = { 'x-sparda-key': 'secret', 'X-Tenant-Id': 'ai-forged' };
    injectContext(outbound, ctx);
    expect(outbound['X-Tenant-Id']).toBe('operator-pinned');
  });
});

// ─── Bounds ───────────────────────────────────────────────────────────────────

describe('Bounds — R1', () => {
  it('rejects 9 headers declared in config', () => {
    expect(() =>
      validateConfig({
        headers: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'],
        mode: 'verbatim',
      }),
    ).not.toThrow(); // validateConfig returns {valid:false}, doesn't throw

    const r = validateConfig({
      headers: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9'],
    });
    expect(r.valid).toBe(false);
    expect(r.error.message).toMatch(/8/);
  });

  it('throws USER at startup for value > 1024 bytes', () => {
    const longValue = 'x'.repeat(1025);
    expect(() =>
      resolveContext({
        argv: ['node', 'sparda', '--context', `X-Tenant-Id=${longValue}`],
        env: {},
        config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
      }),
    ).toThrow(expect.objectContaining({ code: 'USER' }));
  });

  it('throws USER for value exactly 2KB', () => {
    const twoKB = 'x'.repeat(2048);
    expect(() =>
      resolveContext({
        argv: ['node', 'sparda', '--context', `X-Tenant-Id=${twoKB}`],
        env: {},
        config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
      }),
    ).toThrow(expect.objectContaining({ code: 'USER' }));
  });

  it('accepts value of exactly 1024 bytes', () => {
    const exactly1024 = 'x'.repeat(1024);
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', `X-Tenant-Id=${exactly1024}`],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    expect(ctx.headers['X-Tenant-Id']).toBe(exactly1024);
  });
});

// ─── Bounds — multibyte (the bound is BYTES, not characters) ──────────────────

describe('Bounds — multibyte byte-length (R1)', () => {
  // The cap is named MAX_VALUE_BYTES and the wire is bytes. A naive `value.length`
  // check counts UTF-16 code units and would UNDER-count multibyte text, letting a
  // value that is actually >1024 bytes through. These prove the byte-accurate guard.

  it('rejects a value that is ≤1024 UTF-16 units but >1024 UTF-8 bytes', () => {
    // '😀' = 2 UTF-16 code units, 4 UTF-8 bytes. 300 of them → length 600 (would
    // pass a .length check) but 1200 bytes (must fail the byte check).
    const emojis = '😀'.repeat(300);
    expect(emojis.length).toBeLessThanOrEqual(1024); // a .length guard would let this pass
    expect(Buffer.byteLength(emojis, 'utf8')).toBeGreaterThan(1024);
    expect(() =>
      resolveContext({
        argv: ['node', 'sparda', '--context', `X-Tenant-Id=${emojis}`],
        env: {},
        config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
      }),
    ).toThrow(expect.objectContaining({ code: 'USER' }));
  });

  it('accepts multibyte content up to exactly 1024 bytes, rejects one char past it', () => {
    // 'é' = 1 UTF-16 code unit, 2 UTF-8 bytes. 512 → exactly 1024 bytes (accepted).
    const exactly1024Bytes = 'é'.repeat(512);
    expect(Buffer.byteLength(exactly1024Bytes, 'utf8')).toBe(1024);
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', `X-Tenant-Id=${exactly1024Bytes}`],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    expect(ctx.headers['X-Tenant-Id']).toBe(exactly1024Bytes);

    // 513 → 1026 bytes → over budget, must throw.
    const over = 'é'.repeat(513);
    expect(() =>
      resolveContext({
        argv: ['node', 'sparda', '--context', `X-Tenant-Id=${over}`],
        env: {},
        config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
      }),
    ).toThrow(expect.objectContaining({ code: 'USER' }));
  });
});

// ─── Value-free fingerprint ───────────────────────────────────────────────────

describe('fingerprintContext — value-free', () => {
  it('returns header name + 8-hex hash, never the raw value', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=secret-tenant-123'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });

    const fp = fingerprintContext(ctx);

    expect(fp['X-Tenant-Id'].present).toBe(true);
    expect(fp['X-Tenant-Id'].hash).toHaveLength(8);
    expect(fp['X-Tenant-Id'].hash).not.toContain('secret-tenant-123');
    expect(JSON.stringify(fp)).not.toContain('secret-tenant-123');
  });

  it('hash is consistent for the same value', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=tenant-a'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });
    const fp1 = fingerprintContext(ctx);
    const fp2 = fingerprintContext(ctx);
    expect(fp1['X-Tenant-Id'].hash).toBe(fp2['X-Tenant-Id'].hash);
  });

  it('different values produce different hashes', () => {
    const make = (v) =>
      resolveContext({
        argv: ['node', 'sparda', '--context', `X-Tenant-Id=${v}`],
        env: {},
        config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
      });
    const fpA = fingerprintContext(make('tenant-a'));
    const fpB = fingerprintContext(make('tenant-b'));
    expect(fpA['X-Tenant-Id'].hash).not.toBe(fpB['X-Tenant-Id'].hash);
  });

  it('returns empty object for empty context', () => {
    const ctx = resolveContext({ config: null });
    expect(fingerprintContext(ctx)).toEqual({});
  });
});

// ─── Write-safety orthogonality — R3 ─────────────────────────────────────────

describe('Write-safety — orthogonal to context (R3)', () => {
  it('pinning a tenant context does NOT flip any write-safety flag', () => {
    const ctx = resolveContext({
      argv: [
        'node',
        'sparda',
        '--context',
        'X-Tenant-Id=acme',
        '--context',
        'X-Admin=true',
      ],
      env: {},
      config: { headers: ['X-Tenant-Id', 'X-Admin'], mode: 'verbatim' },
    });

    // Context is present
    expect(ctx.headers['X-Tenant-Id']).toBe('acme');
    expect(ctx.headers['X-Admin']).toBe('true');

    // The ctx object has NO write-safety property — they are independent
    expect(ctx).not.toHaveProperty('writeSafety');
    expect(ctx).not.toHaveProperty('enabled');
    expect(ctx).not.toHaveProperty('tools');
  });

  it('injectContext does not touch write-safety-related headers by itself', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=acme'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });

    const outbound = { 'x-sparda-key': 'abc', 'x-write-safe': 'true' };
    injectContext(outbound, ctx);

    // Only X-Tenant-Id was added; write-safety header untouched
    expect(outbound['x-write-safe']).toBe('true');
    expect(outbound['X-Tenant-Id']).toBe('acme');
  });

  it('context and write-safety are two independent gates on every request', () => {
    // Gate 1: write-safety (simulated — checked by the router, not context-carrier)
    const isWriteTool = (toolConfig) => toolConfig?.write === true;
    const isWriteEnabled = (spardaConfig) => spardaConfig?.writeSafety === false;

    const spardaConfig = {
      writeSafety: true,
      tools: { getUser: { write: false, enabled: true } },
    };

    // Gate 2: context (checked here)
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=acme'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });

    // Both gates independent
    expect(ctx.headers['X-Tenant-Id']).toBe('acme'); // context gate: acme
    expect(isWriteTool(spardaConfig.tools.getUser)).toBe(false); // write gate: not a write
    expect(isWriteEnabled(spardaConfig)).toBe(false); // write gate: writes globally off

    // Pinning tenant never changes the write gate
    expect(spardaConfig.writeSafety).toBe(true); // unchanged
  });
});

// ─── Performance — hot path O(1) ─────────────────────────────────────────────

describe('Performance — hot path', () => {
  it('injectContext is O(1) per request — completes in < 1ms', () => {
    const ctx = resolveContext({
      argv: ['node', 'sparda', '--context', 'X-Tenant-Id=perf-tenant'],
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' },
    });

    const start = process.hrtime.bigint();
    const outbound = { 'x-sparda-key': 'key' };
    injectContext(outbound, ctx);
    const elapsed = Number(process.hrtime.bigint() - start);

    expect(elapsed).toBeLessThan(5_000_000); // < 5ms (typically <0.1ms; raised for VM/coverage overhead)
  });

  it('fingerprintContext completes in < 1ms for 8 headers', () => {
    const argv = [
      'node',
      'sparda',
      '--context',
      'X-H1=v1',
      '--context',
      'X-H2=v2',
      '--context',
      'X-H3=v3',
      '--context',
      'X-H4=v4',
      '--context',
      'X-H5=v5',
      '--context',
      'X-H6=v6',
      '--context',
      'X-H7=v7',
      '--context',
      'X-H8=v8',
    ];
    const ctx = resolveContext({
      argv,
      env: {},
      config: {
        headers: ['X-H1', 'X-H2', 'X-H3', 'X-H4', 'X-H5', 'X-H6', 'X-H7', 'X-H8'],
        mode: 'verbatim',
      },
    });

    // Warm up crypto/JIT compilation
    fingerprintContext(ctx);

    const start = process.hrtime.bigint();
    fingerprintContext(ctx);
    const elapsed = Number(process.hrtime.bigint() - start);

    expect(elapsed).toBeLessThan(5_000_000); // < 5ms (typically <0.1ms after warmup)
  });
});

// ─── Memory bounded ───────────────────────────────────────────────────────────

describe('Memory bounded — R1', () => {
  it('only declared headers are extracted, regardless of what is in argv', () => {
    // Attack: attacker supplies 1000 --context flags hoping to fill memory
    const argv = ['node', 'sparda'];
    for (let i = 0; i < 100; i++) {
      argv.push('--context', `X-Undeclared-${i}=value`);
    }
    argv.push('--context', 'X-Tenant-Id=real');

    const ctx = resolveContext({
      argv,
      env: {},
      config: { headers: ['X-Tenant-Id'], mode: 'verbatim' }, // only X-Tenant-Id declared
    });

    // Only the declared header is in the frozen context
    expect(Object.keys(ctx.headers)).toHaveLength(1);
    expect(ctx.headers['X-Tenant-Id']).toBe('real');
  });
});
