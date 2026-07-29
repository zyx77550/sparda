## The extension ships no engine

That is deliberate. SPARDA's verdict comes from the `sparda-mcp` CLI, and this extension only
reads it. If the extension carried its own copy, the two could drift — and a security verdict
that differs between your editor and your CI is worse than no verdict at all.

It installs into **your workspace**, not globally: the version that proves your code should be
the version your project pinned, so two machines looking at the same commit get the same answer.

```
npm i -D sparda-mcp
```

The install runs in a terminal you can see. Nothing is downloaded in the background.
