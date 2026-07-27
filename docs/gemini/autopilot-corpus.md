# To Gemini — the corpus autopilot (the smart version of "run on every repo, always")

**From:** Claude · **Date:** 2026-07-11 · Status: **design + standing rules**. Do not
start until Zak says go. Read this whole file first.

## The reframe (why the naive version would kill us)

Zak's instinct — "point SPARDA at every public repo, all the time, and open issues like
the Prisma one to get known" — is right about the *scanning* and wrong about the *output*.

**Opening an issue on every repo you scan is spam.** It gets the GitHub account
rate-limited then banned, and — far worse — it destroys the one thing SPARDA sells:
*trust*. A bot that mass-files "I found a problem" on thousands of repos is the exact
opposite of a trust layer. One tone-deaf wave and the brand is "that spam bot" forever.
No.

**The scan is not the product. The corpus is.** Running SPARDA on thousands of repos is
enormously valuable — but its product is **knowledge** (the world genome, ADR-035 /
`docs/COLLECTIVE-IMMUNITY.md`), plus a *small* number of genuinely helpful, hand-worthy
disclosures. Scanning is read-only and local; it touches nobody's repo. Only the
*outbound* (issues) is throttled, curated, and human-approved.

## What the autopilot actually does — three outputs, in priority order

**1. Build the genome corpus (unlimited, safe, the real prize).**
Loop, at a steady polite cadence:
- Pull a repo from a curated queue (popular Express/FastAPI/Next apps; start from
  awesome-lists, `topic:express` sorted by stars, framework example repos).
- `git clone --depth 1` → `sparda apocalypse --json` + `sparda fingerprint --json`.
- Record, in `zyx77550/sparda-genome` (or a staging file first): the **behaviorHashes**
  present, and for each finding its `{ behaviorHash, rule, severity }`. **Structure only —
  never source, never secrets** (this is `seed`'s law and hard rule #7). This is pure
  read-only analysis on your own machine; scale it freely (respect GitHub clone rate
  limits, cache, don't re-clone).
- Dedup by `behaviorHash`: once a shape is in the corpus, you don't need it again — you
  need *coverage of shapes*, not volume of repos.

**2. A public proof gallery (social proof WITHOUT spamming anyone).**
Aggregate the anonymized, honest findings into a page on `residual-labs.fr` —
"SPARDA scanned N public repos; here's the distribution of behavioral risks, and M
verified critical patterns." Repos stay unnamed unless the finding was disclosed and
acknowledged. This is how the scan gets us known — proof at scale, published on our own
turf, harming no one.

**3. Selective, hand-worthy responsible disclosure (rare, human-approved).**
Only for a finding that is ALL of: genuinely serious (real auth/data risk, not an
intentional teaching example), on a repo that is **maintained** and **welcomes it**, and
**not already known**. For each candidate you DRAFT an issue and **queue it for Zak's
approval** — you never auto-fire outbound. One thoughtful issue at a time, like #8560.

## Hard rules for outbound (issues) — non-negotiable
1. **Never auto-open issues in bulk.** Draft → queue → Zak approves each one. Ceiling:
   a *handful* per week, not per hour. Quality over volume, always.
2. **Respect each repo's norms.** Read `SECURITY.md`/`CONTRIBUTING.md` first. If it says
   report privately, do that (draft for Zak). If issues are disabled or it's archived/a
   template/example, **skip** — no disclosure.
3. **Skip intentional teaching examples** (like the Prisma one was) unless the framing is
   explicitly "heads-up for copiers," and even then sparingly.
4. **Dedup hard** by `behaviorHash` + repo — never file the same shape twice, never file
   on a repo we've already touched.
5. **GitHub ToS + rate limits.** No behavior that reads as automated bulk posting. If a
   platform signal says slow down, stop.
6. **No CAPTCHA bypass, no fake accounts, no astroturfing** (the standing ground rules).

## Hard rules for scanning (read-only) — still be a good citizen
- `--depth 1` clones, cache, don't hammer one org, honor GitHub's clone/API limits.
- Purely local analysis. Nothing you compute touches the scanned repo.
- Store structure only. If you ever find a secret in a scanned repo, **do not record it**;
  if it's a live exposed credential, that's a private security report to that repo, drafted
  for Zak — never public, never in the corpus.

## The loop, once per run (pseudocode)
```
for repo in queue (polite cadence):
  clone --depth 1
  fp   = sparda fingerprint --json
  ap   = sparda apocalypse --json
  corpus.upsert(repo, fp.behaviorHashes, ap.findings-by-hash)   # structure only
  for f in ap.findings where severity in {critical,high}:
    if novel(f.behaviorHash) and disclosable(repo) and serious(f):
      draft = issue_text(f);  queue_for_Zak(draft)              # never auto-fire
publish/refresh the residual-labs.fr proof gallery from the corpus
```

## Report back
Keep a running `docs/sessions/` log: repos scanned, shapes added to the corpus, drafts
queued, issues Zak approved + their URLs and outcomes. Update `docs/HANDOFF.md` with corpus
size and coverage. This log is how the genome's growth stays legible.

**Bottom line:** yes, run SPARDA on the whole public world, constantly — but the yield is
the genome and a proof gallery, with disclosure as a rare, respectful, human-approved act.
That is how a *trust* layer gets known: by being trustworthy at scale, not loud.
