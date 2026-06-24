// ui/style.js — zero-dep ANSI styling for the HUMAN commands (init, remove,
// doctor). Never import this from the bridge path: there, stdout is the MCP
// protocol (hard rule #2) and stderr must stay grep-able plain text.

// SPARDA identity: violet → cyan, same stops as the brand gradient
const VIOLET = [192, 132, 252]; // #c084fc
const CYAN = [103, 232, 249]; // #67e8f9
const RESET = '\x1b[0m';

// evaluated per call so tests (and runtime env changes) see the truth;
// honors https://no-color.org and the FORCE_COLOR convention
function enabled() {
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  if (process.env.NO_COLOR !== undefined) return false;
  return Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb';
}

function truecolor() {
  return (
    /truecolor|24bit/i.test(process.env.COLORTERM ?? '') ||
    ['iTerm.app', 'vscode', 'WezTerm', 'ghostty'].includes(
      process.env.TERM_PROGRAM ?? '',
    ) ||
    Boolean(process.env.WT_SESSION)
  );
}

const sgr = (open) => (s) => (enabled() ? `\x1b[${open}m${s}${RESET}` : String(s));

export const c = {
  dim: sgr('2'),
  bold: sgr('1'),
  green: sgr('32'),
  yellow: sgr('33'),
  red: sgr('31'),
  cyan: sgr('38;5;117'),
  violet: sgr('38;5;177'),
};

// the brand banner: per-character violet→cyan interpolation in truecolor,
// a stepped 256-color ramp elsewhere, plain text when colors are off
export function gradient(text) {
  if (!enabled()) return text;
  const chars = [...text];
  if (truecolor()) {
    const body = chars
      .map((ch, i) => {
        const t = chars.length === 1 ? 0 : i / (chars.length - 1);
        const [r, g, b] = VIOLET.map((v, k) => Math.round(v + (CYAN[k] - v) * t));
        return `\x1b[1m\x1b[38;2;${r};${g};${b}m${ch}`;
      })
      .join('');
    return body + RESET;
  }
  const ramp = [177, 141, 147, 153, 117];
  const body = chars
    .map((ch, i) => {
      const step =
        ramp[Math.min(ramp.length - 1, Math.floor((i / chars.length) * ramp.length))];
      return `\x1b[1m\x1b[38;5;${step}m${ch}`;
    })
    .join('');
  return body + RESET;
}

// single-pass JSON highlighter (keys violet, strings cyan, punctuation dim) —
// one pass on purpose: a second regex pass would chew the ANSI escapes of the first
export function colorizeJson(json) {
  if (!enabled()) return json;
  return json.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)?|([{}[\],])/g,
    (m, str, colon, punct) => {
      if (punct) return c.dim(punct);
      if (colon !== undefined) return c.violet(str) + c.dim(colon);
      return c.cyan(str);
    },
  );
}
