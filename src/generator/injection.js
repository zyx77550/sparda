// generator/injection.js — the marked-block contract, shared by every generator that
// injects a router into a user's entry file. ONE definition of the markers and ONE pair
// of strip operations, so an inject and its inverse can never drift apart (hard rule #4:
// `sparda remove` must leave a byte-for-byte clean diff).
//
// Two strips, deliberately different — this asymmetry is the whole point:
//
//   stripForReinit — removes an existing block AND the newlines hugging it, leaving a
//     single '\n'. Used on re-init, just before the fresh block is spliced back in.
//
//   stripForRemoval — the exact byte inverse of a line-spliced insert. The block is
//     inserted as whole lines *before* an existing line, so relative to the original it
//     adds the block text plus ONE trailing newline; the newline that precedes the block
//     already belonged to the file. So removal consumes the block + its trailing newline
//     only, never the leading one. (The previous regex consumed the LEADING newline
//     instead — byte-perfect for a mid-file block, but it left a stray blank line when the
//     block sat at the very top of the entry file, i.e. `insertAt === 0`.)

export function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function makeInjectionMarkers(commentPrefix) {
  const MARK_START = `${commentPrefix} >>> sparda-injection (do not edit this block) >>>`;
  const MARK_END = `${commentPrefix} <<< sparda-injection <<<`;
  const core = `${escapeRx(MARK_START)}[\\s\\S]*?${escapeRx(MARK_END)}`;
  return {
    MARK_START,
    MARK_END,
    // re-init: drop the old block and the newlines around it, keep one separator.
    stripForReinit: (src) =>
      src.replace(new RegExp(`\\r?\\n?${core}\\r?\\n?`, 'g'), '\n'),
    // remove: block + its own trailing newline only — the leading newline is the file's.
    stripForRemoval: (src) => src.replace(new RegExp(`${core}\\r?\\n?`, 'g'), ''),
  };
}
