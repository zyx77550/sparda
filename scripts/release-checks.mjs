// scripts/release-checks.mjs — the DECISIONS a release gate makes, with no I/O.
//
// Split out of `release-gate.mjs` so they can be tested against fabricated state. A gate
// that only exists as a script can only be tested by grepping its source, and a grep
// cannot tell a check from a comment mentioning one: the header of the gate says the word
// "--force" in order to REFUSE it. Text is not behavior.
//
// Every function here is pure: state in, failures out. A failure is `{ what, detail }` —
// `what` is the property that does not hold, phrased as the thing we wanted to be true.

const fail = (what, detail) => ({ what, detail });

// The 0.69.0 failure in one function. That release was cut at a commit that was not the
// head of what was being merged, so the package on npm was a state no one had reviewed.
export function treeChecks({ dirty, branch, head, remote, fetched = true }) {
  const out = [];
  if (dirty)
    out.push(fail('working tree is clean', dirty.split('\n').slice(0, 5).join('; ')));
  // `git rev-parse --abbrev-ref HEAD` reports the literal string 'HEAD' for a DETACHED
  // checkout, which is the shape every tag build has: `actions/checkout` on a `push: tags:`
  // event checks out the tag, not a branch. The gate refused every one of them — the release
  // workflow could never publish anything, and its first run would have failed on this line.
  //
  // A detached HEAD is accepted ONLY when it is byte-identical to origin/main. That is not an
  // exemption: it is the property the branch NAME was ever a proxy for. Being "on main" was
  // never the point — publishing exactly the bytes that were merged is. This branch cannot
  // admit anything `head !== remote` below would not already refuse, so the gate is no weaker
  // for it, and a detached checkout of any OTHER commit still fails here (mutant-covered).
  const atMainTip = head === remote;
  if (branch !== 'main' && !(branch === 'HEAD' && atMainTip))
    out.push(fail('on main', `on '${branch}'`));
  if (!fetched)
    out.push(
      fail('could reach origin', 'git fetch failed — cannot prove main is current'),
    );
  if (head !== remote)
    out.push(
      fail(
        'main is identical to origin/main',
        `HEAD ${short(head)} vs origin/main ${short(remote)} — publishing a commit that is not what was merged is exactly how 0.69.0 shipped a half-state`,
      ),
    );
  return out;
}

// A partial bump is a real shape: `package.json` moves, `server.json` carries the version
// TWICE and `glama.json` once, and a release-time grep of one of them says everything is
// fine. Fields are addressed by path so a manifest gaining a second copy is one string.
export const MANIFEST_FIELDS = [
  ['server.json', ['version', 'packages.0.version']],
  ['glama.json', ['version']],
  ['extensions/vscode/package.json', ['version']],
];

export function manifestChecks(version, docs) {
  const out = [];
  for (const [file, fields] of MANIFEST_FIELDS) {
    const doc = docs[file];
    if (doc == null) {
      out.push(fail(`${file} is readable`, 'missing or invalid JSON'));
      continue;
    }
    for (const f of fields) {
      const got = f.split('.').reduce((o, k) => o?.[k], doc);
      if (got !== version) out.push(fail(`${file} ${f} === ${version}`, `found ${got}`));
    }
  }
  return out;
}

// 0.69.0 shipped with no entry at all. A release nobody wrote down is a release nobody can
// audit later — and the entry is where "what changed for the user" gets decided.
export function changelogChecks(text, version) {
  return headingFor(version).test(text)
    ? []
    : [fail('CHANGELOG has an entry for this version', `no "## [${version}]" heading`)];
}

export const headingFor = (version) => new RegExp(`^## \\[${escapeRe(version)}\\]`, 'm');

// A tag that points somewhere else is worse than no tag: it names the wrong bytes. And a tag
// that exists only on the releaser's disk names nothing at all to anyone else — v0.71.0 was cut
// with the tag never pushed, and the gate said "exists and points at HEAD" because it only ever
// looked locally (E-107).
//
// `remoteReachable` is the rule-13 half. `ls-remote` failing and `ls-remote` returning nothing
// are different states: the first is "we could not ask", the second is "we asked, it is not
// there". Collapsing them made an unreachable network read as an un-pushed tag — the honest
// direction, but the wrong sentence, and the operator would go looking for a tag that is
// already there. Both still BLOCK, because a release gate that cannot verify must not certify
// (the same call `fetched:false` makes above); only the stated reason differs.
export function tagChecks(tag, { at, head, remoteAt, remoteReachable = true }) {
  if (!at) return [fail(`${tag} exists`, `create it: git tag -a ${tag} -m "${tag}"`)];
  if (at !== head)
    return [fail(`${tag} points at HEAD`, `${tag} → ${short(at)}, HEAD ${short(head)}`)];
  if (!remoteReachable)
    return [
      fail(
        `${tag} is pushed to origin`,
        'UNVERIFIED — could not reach origin to ask. Not a pass, and not proof the tag is missing',
      ),
    ];
  if (remoteAt !== at)
    return [
      fail(
        `${tag} is pushed to origin`,
        `local ${tag} is not on origin — push it: git push origin ${tag}`,
      ),
    ];
  return [];
}

// "Is this version on the registry?" is an HTTP question, and asking it over HTTP is what
// removed the last child process from the gate. The `npm view` version of this check needed a
// shell on Windows (npm is `npm.cmd`), and Node then warns — correctly — that arguments passed
// with `shell: true` are concatenated, not escaped. Since `pkg.name` and `pkg.version` come
// from a file in the tree, the gate was putting the repo's own JSON on a command line to ask a
// question two lines of `fetch` answer. `registryUrlFor` is exported so a test can pin the
// escaping that replaces it.
export const REGISTRY = 'https://registry.npmjs.org';
export const registryUrlFor = (name, version) =>
  // A scoped name (`@scope/pkg`) must have its slash encoded, or the path splits into an extra
  // segment and the registry answers about something else entirely.
  `${REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;

// Three answers, and the third is the one that matters: 200 = published (refuse), 404 = absent
// (the state we want), anything else — a 500, a proxy, no network — is UNMEASURED. Reporting
// "we could not reach the registry" as "the version is not there" is the mistake this whole
// codebase is about, so it is named rather than counted either way.
//
// `live`/`error` remain accepted so a caller can hand in a result it obtained some other way.
export function publishedCheck({ live, error, status }) {
  if (status != null) {
    if (status === 200) return { state: 'fail', detail: `already on npm — bump first` };
    if (status === 404) return { state: 'ok' };
    return { state: 'unverified' };
  }
  if (error) {
    if (/E404|is not in this registry|No match(ing version)? found/i.test(error))
      return { state: 'ok' };
    return { state: 'unverified' };
  }
  return live
    ? { state: 'fail', detail: `already on npm — bump first` }
    : { state: 'ok' };
}

const short = (sha) => String(sha ?? '').slice(0, 8);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
