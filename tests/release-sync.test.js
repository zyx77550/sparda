// release-sync.test.js — the version + identity of every registry manifest must agree with
// package.json. A release bumps package.json, server.json (twice: top-level + packages[0]), and
// glama.json; if any is forgotten the npm package and the MCP-registry manifest disagree, which is
// exactly how the official MCP entry once rotted to a stale version. This test makes that drift
// impossible to ship: it fails `npm test` (the release gate), so it never relies on remembering.
//
// NOT synced here on purpose: .claude-plugin/marketplace.json `metadata.version` is the plugin
// marketplace's own schema version, not the npm package version — it moves independently.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const pkg = read('package.json');
const server = read('server.json');
const glama = read('glama.json');

describe('release sync: all registry manifests agree with package.json', () => {
  it('every version-bearing field equals the package version', () => {
    const version = pkg.version;
    const fields = {
      'package.json version': pkg.version,
      'server.json version': server.version,
      'server.json packages[0].version': server.packages[0].version,
      'glama.json version': glama.version,
    };
    const drifted = Object.entries(fields).filter(([, v]) => v !== version);
    expect(
      drifted,
      `these version fields drifted from package.json (${version}) — bump them together ` +
        `before publish: ${drifted.map(([k, v]) => `${k}=${v}`).join(', ')}`,
    ).toEqual([]);
  });

  it('the MCP server identity matches the npm package identity', () => {
    expect(server.name, 'server.json name must equal package.json mcpName').toBe(
      pkg.mcpName,
    );
    expect(
      server.packages[0].identifier,
      'server.json packages[0].identifier must equal the npm package name',
    ).toBe(pkg.name);
    expect(server.packages[0].registryType).toBe('npm');
  });

  it('the version is a clean semver (no pre-release cruft slips into a manifest)', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
