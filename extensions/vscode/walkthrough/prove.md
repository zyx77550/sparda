## What the verdict words mean

| word | what it says |
|---|---|
| `PROVEN` | every mutation is dominated by a guard SPARDA saw deny |
| `PARTIAL` | it proved what it could see, and says how much that was |
| `RISKY` / `NOT_PROVEN` | findings stand, and they are real |
| `PREMISE_GAP` | a route your framework serves was never compiled — what was analysed was not the whole app |
| `UNKNOWN` | **the analysis did not run.** Not a pass. |

The last row is the one that matters. "We could not measure" and "we measured nothing wrong"
are different states, and SPARDA never shows the first as the second.

Hover the status bar for coverage, guards proven, and blind spots. Run **SPARDA: Apocalypse**
to put every finding in the Problems panel at its own line.
