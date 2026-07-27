# SPARDA launch video — written in code

The launch video (FR + EN, 9:16 vertical for TikTok/Reels/LinkedIn) as a Remotion
project: every frame is React, every color comes from `src/theme.ts` (the brand
palette extracted from `assets/logo-presentation.png` + the verdict palette from
`apocalypse.js`), and the sound design is synthesized into `public/*.wav`.
Deterministic renders — very SPARDA.

```bash
npm install
npm run studio     # live-edit at localhost:3000
npm run render:fr  # -> out/sparda-launch-fr.mp4
npm run render:en  # -> out/sparda-launch-en.mp4
```

Timeline lives in `src/Video.tsx` (`T` constant). Copy in `src/copy.ts`.
On a headless machine, point `remotion.config.ts` at a chrome-headless-shell.
