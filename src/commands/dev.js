// commands/dev.js
import { startStdioBridge } from '../server/stdio.js';
export async function runDev(opts) {
  await startStdioBridge({ cwd: opts.cwd, portOverride: opts.port });
}
