# Marketing assets

Self-contained, brand-owned motion assets for SPARDA. Each is one HTML file, zero
dependencies, no external requests — it plays in any browser and can be recorded to a
video. Source lives here so it is versioned and re-recordable at will (per the
[Evolution Protocol](../EVOLUTION-PROTOCOL.md)).

## The assets

| File | What it is | Use it for |
|---|---|---|
| `sparda-explainer-fr.html` | **The explainer (FR, ~35s), 3 acts:** what SPARDA is, the real proof in a terminal, and why only SPARDA does it (compiles behavior not text, deterministic + re-derivable). | The reference asset — a link or a video for anyone who needs to *understand* SPARDA. |
| `sparda-terminal.html` | **The real proof (~13s):** an agent drops an auth guard, `sparda review` prints the actual `NOT PROVEN` / `GUARD_REMOVED`. | The credibility asset for a technical audience — substance, reproducible. |

## Brand rules (non-negotiable)

- **SPARDA / Residual Labs branding only.** Never imply endorsement by, or affiliation
  with, any other organization. "Anthropic-grade" means the aesthetic bar, not a claim.
- **Every number and every output shown must be real** — the terminal text is the actual
  output of `sparda review`. No invented metrics.
- Violet to cyan is the accent; semantic green = PROVEN, red = a removed guard / NOT PROVEN.

## Preview or re-record

Open the HTML directly in a browser to preview (each auto-plays once; the explainer and
the animated variants expose a replay control, and respect `prefers-reduced-motion`).

To record a video, drive the page headlessly with the pre-installed Chromium and record
with Playwright (the repo does NOT depend on Playwright — install it ad hoc in a scratch
dir). Sketch:

```js
// npm i playwright   (browsers are already on the machine via PLAYWRIGHT_BROWSERS_PATH)
import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: '.', size: { width: 1280, height: 720 } },
});
const p = await ctx.newPage();
await p.goto('file://' + process.cwd() + '/sparda-explainer-fr.html');
await p.waitForTimeout(37500); // explainer runs ~35s
await ctx.close(); // finalizes the .webm
await b.close();
```

The output is a `.webm` (VP8). Convert to `.mp4` with any ffmpeg
(`ffmpeg -i in.webm out.mp4`) if a platform needs H.264.
