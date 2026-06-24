// server/idle.js — the idle harvester: SPARDA's internal work
// (condensation, persistence, future organs) runs only when the event loop is
// quiet. One job per tick — a drip, never a burst: perceived saturation stays
// at zero even while the organism digests.
import { monitorEventLoopDelay } from 'node:perf_hooks';

export function createIdleHarvester({
  tickMs = 250,
  busyLagMs = 25,
  maxWaitMs = 5000,
  maxQueue = 200,
} = {}) {
  const resolutionMs = 10;
  const histogram = monitorEventLoopDelay({ resolution: resolutionMs });
  histogram.enable();
  const queue = [];

  const timer = setInterval(() => {
    if (!queue.length) return;
    // recorded delays hover around the sampling resolution on a quiet loop —
    // the lag is what exceeds it. NaN (no samples yet) counts as quiet.
    const lagMs = histogram.mean / 1e6 - resolutionMs;
    histogram.reset();
    const starving = Date.now() - queue[0].ts > maxWaitMs; // never wait forever on a loaded box
    if (Number.isFinite(lagMs) && lagMs > busyLagMs && !starving) return;
    const job = queue.shift();
    try {
      job.fn();
    } catch (e) {
      console.error(`[sparda] idle job failed (dropped): ${e.message}`);
    }
  }, tickMs);
  timer.unref?.();

  return {
    enqueue(fn) {
      if (queue.length >= maxQueue) return false; // bounded, like every SPARDA buffer
      queue.push({ fn, ts: Date.now() });
      return true;
    },
    // synchronous drain for shutdown: pending knowledge must reach disk
    flush() {
      while (queue.length) {
        const job = queue.shift();
        try {
          job.fn();
        } catch (e) {
          console.error(`[sparda] idle job failed (dropped): ${e.message}`);
        }
      }
    },
    stop() {
      clearInterval(timer);
      histogram.disable();
    },
    pending: () => queue.length,
  };
}
