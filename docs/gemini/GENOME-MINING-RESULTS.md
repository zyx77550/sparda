# Genome Mining Results

This document summarizes the offline execution of the genome mining pipeline (`cve-replay.mjs`) over several major open-source TypeScript repositories. The goal of this process was to extract custom permission decorators and validate SPARDA's offline, deterministic analysis capabilities against real-world auth fixes.

## Mining Results Summary

The mining process scanned the git history of the following repositories, searching for commits that added authorization guards (e.g., `@UseGuards`, `requireAuth`, etc.) and re-running SPARDA's analysis (`compileUBG` + `apocalypse`) on both the vulnerable parent commit and the patched commit.

Here are the results per repository:

| Repository | Total Fixes Tested | Re-derived | Flagged (Weak Signal) | Missed/No Routes |
|------------|--------------------|------------|-----------------------|------------------|
| `novuhq/novu` | 15 | 0 | 15 | 0 |
| `calcom/cal.com` | 15 | 0 | 15 | 0 |
| `medusajs/medusa` | 14 | 0 | 7 | 7 |
| `twentyhq/twenty` | 15 | 0 | 0 | 15 |
| `directus/directus` | 6 | 0 | 0 | 6 |
| `strapi/strapi` | 13 | 0 | 0 | 13 |
| `nocodb/nocodb` | 13 | 0 | 0 | 13 |
| `immich-app/immich` | 5 | 0 | 5 | 0 |
| `dubinc/dub` | 4 | 0 | 4 | 0 |

**Definitions:**
- **Re-derived:** SPARDA specifically detected a structural guard or invariant addition in the patch.
- **Flagged (Weak Signal):** SPARDA flagged the vulnerable commit statically (e.g., `UNGUARDED_MUTATION`) but couldn't isolate the exact `GUARD_REMOVED` delta in the graph difference.
- **Missed/No Routes:** The commit didn't trigger a static violation, or the routing graph failed to extract correctly (e.g., custom framework lacking out-of-the-box routing adapters).

## Extracted Permission Decorators

By analyzing the raw `diff` outputs for the guard-adding commits, we successfully identified multiple custom decorators used in the wild for access control. 

These decorators generally follow custom implementation patterns but conceptually map to SPARDA's security model:

- `@AuthWorkspace`
- `@AuthUser`
- `@AuthUserWorkspaceId`
- `@UseFilters`
- `@InjectRepository`

### Observations
1. **Strong Framework Bias:** The repositories that performed best statically (Novu, Cal.com, Immich) rely heavily on frameworks like NestJS and Next.js, where SPARDA's entrypoint and decorator extraction is highly effective. 
2. **Custom Frameworks (Strapi, Directus):** The "no routes" errors observed in Strapi and Directus indicate that their custom abstraction layers for API generation obscure the entrypoints from our offline AST extraction, preventing SPARDA from building the initial canonical graph.
3. **No "Re-derived" Diffs:** The lack of `GUARD_REMOVED` diff hits suggests that while the static analyzer frequently caught the vulnerable code paths (`UNGUARDED_MUTATION`), the specific delta check for invariant removal is very strict and might require extending the AST matching for custom guard implementations to successfully trigger a diff derivation.

## Next Steps
- Add structural support for the newly discovered decorators (`@AuthWorkspace`, `@AuthUser`, etc.) to the offline compiler.
- Implement AST adapters for declarative framework routing (like Strapi and Directus) to resolve "no-routes" coverage gaps.
