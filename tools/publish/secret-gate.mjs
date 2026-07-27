// tools/publish/secret-gate.mjs — the leak-proofing gate for the HQ→public valve.
//
// Default-deny philosophy: this runs on the exact set of files the allowlist would
// publish and BLOCKS if it finds either
//   (a) a high-confidence secret VALUE — keys, tokens, private keys, credentialed
//       URLs, the maintainer's local filesystem path or personal email, or
//   (b) a private-strategy MARKER — names of HQ-only artefacts (the sandbox/paid
//       Bloc C, internal process docs, the internal agent name, the vault path)
//       that must be reviewed by a human before anything goes public.
//
// It only reads bytes and returns a verdict — it never touches git or the network,
// and it never prints the matched value (printing a secret would itself leak it).
// Pure and import-safe, so it is unit-tested directly in tools/publish/publish-gate.test.js.

// HARD secrets — a match is almost never legitimate in open-core; always blocks.
export const HARD_PATTERNS = [
  {
    id: 'private-key-block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    note: 'PEM private key block',
  },
  { id: 'anthropic-key', re: /sk-ant-[A-Za-z0-9-]{20,}/, note: 'Anthropic API key' },
  { id: 'openai-key', re: /sk-[A-Za-z0-9]{32,}/, note: 'OpenAI-style API key' },
  { id: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/, note: 'AWS access key id' },
  {
    id: 'github-token',
    re: /gh[pousr]_[A-Za-z0-9]{36,}/,
    note: 'GitHub personal/OAuth token',
  },
  { id: 'slack-token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/, note: 'Slack token' },
  { id: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/, note: 'Google API key' },
  {
    id: 'jwt',
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/,
    note: 'JWT / signed token',
  },
  {
    id: 'credentialed-url',
    re: /\b(?:postgres(?:ql)?|redis|mongodb(?:\+srv)?|amqp|https?):\/\/[^\s/@:]+:[^\s/@]+@/,
    note: 'URL with embedded credentials',
  },
  {
    id: 'maintainer-path',
    re: /C:\\Users\\zakwi/i,
    note: "maintainer's local filesystem path",
  },
  {
    id: 'maintainer-email',
    re: /zakariagharzouli77@gmail\.com/i,
    note: "maintainer's personal email",
  },
];

// REVIEW markers — names of private / strategy artefacts that must never ride along
// into the open core. A hit blocks too (default-deny), but the report labels it
// "review" so the operator can scrub the text or add a documented exception.
export const REVIEW_MARKERS = [
  {
    id: 'sandbox',
    re: /sparda[-_]sandbox/i,
    note: 'private prototype (Bloc C / paid mesh)',
  },
  {
    id: 'hq-process',
    re: /\b(?:HANDOFF|ROADMAP|COMPETITION)\b/,
    note: 'HQ-only process / strategy doc reference',
  },
  { id: 'agent-name', re: /\bGemini\b/, note: 'internal agent name' },
  {
    id: 'vault-path',
    re: /Obsidian|\\Residual Labs\\/i,
    note: 'private Obsidian vault path',
  },
  {
    id: 'paid-tier',
    re: /\bShadow\b|myc[ée]lium|endosymbios/i,
    note: 'paid-tier / Bloc C concept',
  },
  {
    id: 'supa-service',
    re: /service_role/,
    note: 'Supabase service_role reference (verify it is a doc mention, not a key)',
  },
  {
    id: 'valve-ref',
    re: /publish-public\.mjs|tools[\\/]publish|publish:dry/,
    note: 'reference to the private publish valve — must never ship to public',
  },
];

/**
 * Scan file contents for secrets and private markers.
 * @param {Array<{path: string, text: string}>} fileContents
 * @param {Array<{allow: string, why?: string}>} exceptions  regexes whose matching
 *        LINES are skipped (for intentional, human-reviewed public strings).
 * @returns {{ blocked: boolean, hardHits: object[], reviewHits: object[] }}
 */
export function scanForSecrets(fileContents, exceptions = []) {
  const exRes = exceptions.map((e) => new RegExp(e.allow));
  const isExcepted = (line) => exRes.some((re) => re.test(line));
  const hardHits = [];
  const reviewHits = [];

  for (const { path: p, text } of fileContents) {
    const lines = String(text).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (isExcepted(line)) return;
      for (const pat of HARD_PATTERNS) {
        if (pat.re.test(line))
          hardHits.push({ path: p, line: i + 1, id: pat.id, note: pat.note });
      }
      for (const pat of REVIEW_MARKERS) {
        if (pat.re.test(line))
          reviewHits.push({ path: p, line: i + 1, id: pat.id, note: pat.note });
      }
    });
  }

  return { blocked: hardHits.length > 0 || reviewHits.length > 0, hardHits, reviewHits };
}
