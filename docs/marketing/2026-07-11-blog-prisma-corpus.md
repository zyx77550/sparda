# FLAGSHIP ARTICLE — for residual-labs.fr (staged by Claude, deployed by Gemini)

> **Gemini:** deploy this to `residual-labs.fr` in the site's real format (MDX/Astro/
> whatever `residual-labs-v1` uses). The front-matter below is source-agnostic — map
> its fields onto the site's schema. Keep the body verbatim; it's checked against the
> real corpus run (`docs/audit/2026-07-11-corpus-bughunt.md`). After deploy, put the
> live URL back in HANDOFF + ping Zak. This same article is the anchor link Zak will
> use for his own Reddit/HN/X posts, so the slug should be stable.

---

## SEO / meta

- **Title:** We ran a proof engine on Prisma's official Express example — it found two critical unguarded mutations
- **Slug:** `/blog/proving-a-62k-star-repo`
- **Description:** SPARDA compiles a backend to a behavior graph and proves the deploy. Pointed at the official Prisma Express example (~62k★), one command returned NOT PROVEN with two verified critical findings. Here's exactly what, and why it matters for AI-written code.
- **Tags:** static analysis, AI code, proof, MCP, Express, Prisma, code review
- **OG image:** the red→green "NOT PROVEN / PROVEN" proof card (reuse the artifact hero)
- **Canonical:** the residual-labs.fr URL (this is the original home; dev.to/Medium cross-posts point here)

---

# We ran a proof engine on a 62,000-star repo. Here's what it found.

AI made writing code almost free. It made *trusting* code the scarce thing. Every
team now merges more code, from more sources — humans, agents, copilots — than anyone
can actually read. The industry's answer so far is to have an LLM review the LLM,
which is a bit like having the fox audit the henhouse and file a report.

We build **SPARDA** on a different bet: **deterministic proof**. SPARDA is a behavior
compiler. It reads your backend — routes, handlers, SQL/Prisma schema — and lowers it
to a single **behavior graph**, then discharges proof obligations over that graph:
every guarded mutation is guarded, every declared invariant holds, every irreversible
effect has a compensation path. No LLM in the loop. Same input, same verdict, on any
machine. The tagline is the whole product: **AI writes. SPARDA proves.**

Claims are cheap, so here's one command against a repo we don't own.

## The target: the code everyone copies

We pointed SPARDA at [`prisma/prisma-examples`](https://github.com/prisma/prisma-examples),
specifically its `orm/express` sample — the canonical "how to build a REST API with
Prisma" reference, in a repo with ~62,000 stars. This is not some abandoned side
project; it's the code thousands of developers copy as their starting point.

```bash
git clone --depth 1 https://github.com/prisma/prisma-examples
cd prisma-examples/orm/express
npx sparda-mcp apocalypse
```

One command. No config, no annotations, no account. SPARDA detected Express, compiled
the app and its Prisma schema to a graph, and printed:

```
APOCALYPSE — deployment proof over 18 nodes, 23 edges
  ✗ [critical] UNGUARDED_MUTATION — PUT /post/:id/views mutates post with no guard on the path
  ✗ [critical] UNGUARDED_MUTATION — PUT /publish/:id     mutates post with no guard on the path
  ⚠ [medium]   UNVALIDATED_CONSTRAINED_WRITE — PUT /post/:id/views
  ⚠ [medium]   UNVALIDATED_CONSTRAINED_WRITE — PUT /publish/:id
✗ NOT PROVEN — 2 critical, 0 high, 2 medium, 2 info
```

## The finding, verified in the source

SPARDA doesn't do vibes — every finding is a path through the graph, so it's
falsifiable. Both criticals are real. Here are the two handlers, straight from
`src/index.ts`:

```ts
app.put('/post/:id/views', async (req, res) => {
  const { id } = req.params                 // straight from the URL
  const post = await prisma.post.update({   // a mutation
    where: { id: Number(id) },
    data: { viewCount: { increment: 1 } },
  })                                         // no auth, no ownership check
})

app.put('/publish/:id', async (req, res) => {
  const { id } = req.params
  // ...
  const post = await prisma.post.update({
    where: { id: Number(id) },
    data: { published: !postData?.published },
  })
})
```

Both take `:id` directly from the URL and call `prisma.post.update()` with **zero**
authorization. Anyone who can reach the API can inflate the view count of any post, or
publish and unpublish any post, by guessing an integer. SPARDA flags exactly that:
`UNGUARDED_MUTATION` — a state mutation with no guard node anywhere on the path from
entrypoint to write.

**Now the honest part, because it matters.** This is an *intentional* teaching
example. It ships without auth *by design* — the tutorial is about Prisma, not access
control. So this is not a "gotcha" against Prisma, and we filed it with them as a
friendly heads-up, not a vulnerability report.

The point is the opposite, and it's stronger: SPARDA mechanically surfaces the exact
class of risk a developer **inherits the moment they copy this reference into a real
app** — which is the single most common way this bug reaches production. A tutorial
omits auth for clarity; a deadline copies the tutorial; the auth never gets added. The
tool that catches that, in one command, at zero config, is doing real work.

## A proof you can't reproduce is just an opinion

The verdict is byte-identical across independent runs *and* across locales:

```
$ npx sparda-mcp apocalypse --json | sha256sum
04571373c2c11f11...805cbf81
$ LC_ALL=C            ... 04571373...   (identical)
$ LC_ALL=en_US.UTF-8 ... 04571373...   (identical)
```

Same commit, same verdict — on CI, on a laptop, in any locale. A red stays red until
the *code* changes. That determinism is the difference between a proof and a
probabilistic reviewer that says something slightly different every time you ask.

## It doesn't cry wolf

A tool that flags everything is noise, not signal. So we ran the identical command on
[`hagopj13/node-express-boilerplate`](https://github.com/hagopj13/node-express-boilerplate)
(~7k★), which validates every input and guards its routes:

```
✓ PROVEN — 40 obligation(s) discharged, zero violations.
```

That pair — **NOT PROVEN on the risky code, PROVEN on the good code, from the same
engine at zero config** — is the whole credibility argument. Green when it should be
green; red, with a named path, when it shouldn't.

## And when it can't see your code, it says so

One more thing, because a trust tool that bluffs is worse than useless. If SPARDA's
parser can't resolve a repo's routes, it now returns **`NO PROOF` and fails the build**
— never a hollow green checkmark over an empty graph. Coverage is finite and we keep
widening it; honesty about coverage is not negotiable. SPARDA will tell you when it
doesn't know.

## Try it on your own repo

```bash
# prove a deploy can't break your declared rules (exit 1 gates CI)
npx sparda-mcp apocalypse

# diff a PR's behavior against your base branch
npx sparda-mcp review --base main
```

Or drop the [GitHub Action](https://github.com/zyx77550/sparda) into your pipeline and
every pull request gets a behavior proof as a sticky comment — the risk named before
it merges, not discovered after.

SPARDA is open-core, four exact-pinned dependencies, MIT-friendly to try. AI is going
to keep writing more of your code. The question is whether anything proves it before
it ships.

**AI writes. SPARDA proves.** → [github.com/zyx77550/sparda](https://github.com/zyx77550/sparda)
