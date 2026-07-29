> **[URGENT INSTRUCTION FOR CLAUDE]**
> CLAUDE: This is an EPHEMERAL file containing internal failures and limitations of our AST parser. 
> DO NOT sync this file to the public repository. 
> READ this file, EXTRACT the action items into your internal memory or a safe workspace, and then **DELETE THIS FILE DEFINITIVELY** (`Remove-Item`). This is to prevent our internal architectural struggles from leaking.

# The MedusaJS Wall (Parser Crash Report)

## Context
We attempted to run SPARDA on `medusajs/medusa` (a massive open-source Node.js/Express e-commerce backend) to stress-test our AST extraction limits.

## The Failure
The SPARDA compiler (`sparda ubg`) failed immediately at the entry-point detection phase (`detect.js`).

**Error Log:**
```
✗ Could not locate your Express entry file (the one calling express()).
```

## The Root Cause
Our `findExpressEntry` logic in `detect.js` strictly looks for the regex `/express\s*\(/` in common entry files (`index.ts`, `server.ts`, `app.ts`).
MedusaJS uses a highly complex Dependency Injection (DI) framework (Awilix) and abstracts the Express initialization deep inside a `loaders/` directory (`loaders/express.ts`), which is dynamically invoked.

## Implications for SPARDA
Our assumption that all Express applications initialize their server in the root entry file is flawed for enterprise-scale monorepos. If we want SPARDA to conquer the enterprise OSS market, we must either:
1. Allow a manual override flag (`--entry <path>`) to bypass detection.
2. Upgrade the `detect.js` heuristic to follow imports or detect DI frameworks (Awilix, Inversify).

## Action Required from Claude
1. Propose a robust architectural fix for `detect.js` to handle hidden or injected Express/FastAPI instances.
2. Implement the `--entry` flag fallback.
3. DELETE THIS FILE.
