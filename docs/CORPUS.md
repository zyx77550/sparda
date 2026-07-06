# SPARDA Corpus Run

> Real open-source backends, compiled as-is (shallow clone, **no npm install**).
> Failures are listed, not hidden — they are the parser backlog ranked by reality.

Compiled **3/3** repos.

| repo | status | framework | routes | tables | nodes | edges | compile | skipped | apocalypse findings |
|---|---|---|---|---|---|---|---|---|---|
| gothinkster/node-express-realworld-example-app | ✓ | express | 1 | 8 | 12 | 5 | 184ms | 0 | 0 (0 critical) |
| hagopj13/node-express-boilerplate | ✓ | express | 8 | 0 | 30 | 73 | 141ms | 0 | 0 (0 critical) |
| tiangolo/full-stack-fastapi-template | ✓ | fastapi | 22 | 0 | 48 | 48 | 439ms | 6 | 0 (0 critical) |

## Top skip reasons (what static eyes could not see)

- **tiangolo/full-stack-fastapi-template**: dependency 'get_current_active_superuser' not resolved on POST /password-recovery-html-content/{email} · dependency 'get_current_active_superuser' not resolved on GET /users/ · dependency 'get_current_active_superuser' not resolved on POST /users/
