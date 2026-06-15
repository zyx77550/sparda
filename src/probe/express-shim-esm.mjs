/**
 * SPARDA — Express GFP Shim (ESM wrapper, loaded via --import)
 *
 * Node ≥ 18.19: `--import <file>` preloads an ESM module before the entry file.
 * This wrapper bootstraps the CJS shim (which uses Module._load patching)
 * via createRequire, making it effective for ESM apps too.
 *
 * Why CJS shim via createRequire rather than a pure ESM shim?
 * Module._load interception (the GFP mechanism) only works in CJS land.
 * ESM imports bypass Module._load entirely. However, most Express apps —
 * even those using ES module syntax — still resolve 'express' through the
 * CJS loader (express itself is CJS). So patching Module._load in a
 * createRequire context correctly intercepts all express requires regardless
 * of whether the user's entry file is .mjs or .js with "type":"module".
 *
 * ESM, Node ≥ 18. Zero deps beyond node:module, node:url, node:path.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve }  from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// Load the CJS shim — patches Module._load globally in the CJS loader
require(resolve(__dirname, 'express-shim.cjs'));
