// security/sanitize.js — docstring poisoning defense (spec: blueprint 06-SECURITY §2)
//
// The denylist below is ASCII. Two well-known tricks defeat a naive ASCII match, so the probe
// text is normalized FIRST (E-045): (1) homoglyphs — a Cyrillic/Greek letter that renders like
// a Latin one ("Ignore", Cyrillic o = U+043E) spells a trigger word in a script the regex can't
// see; (2) invisible splitters — a zero-width char breaks the token so the whole word never
// appears. We fold homoglyphs to Latin and neutralize the splitters before testing, then blank
// the description if any rule fires.
const DANGEROUS = [
  /(^|\s)(ignore|forget|disregard|override)\s+(all\s+)?(previous|prior|above|earlier)/i,
  /(you\s+are\s+(now|a)\b|act\s+as\b|pretend\s+(you\s+are|to\s+be)|from\s+now\s+on)/i,
  /(system\s+prompt|env(ironment)?\s+var|api[\s_-]?key|credential|secret|exfiltrat|\.env\b)/i,
  /(<\/?(system|assistant|human|tool|instructions?)\b|```)/i,
  /(new\s+(role|instructions?)|your\s+(real|true)\s+(task|goal))/i,
];

// Zero-width / bidi / format characters an attacker inserts to split a trigger token:
// soft hyphen, Mongolian vowel sep, zero-width space/non-joiner/joiner, LTR/RTL marks,
// bidi embeds/overrides, word joiner + invisible operators, BOM.
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

// Confusable homoglyphs -> their Latin twin. Cyrillic and Greek letters that render identically
// to ASCII. Not the full Unicode confusables table (that would be a dependency) — the practical
// attack set. Folded only for the denylist probe; the stored text keeps its original letters.
const CONFUSABLES = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ѕ: 's',
  ј: 'j',
  м: 'm',
  н: 'h',
  т: 't',
  в: 'b',
  к: 'k',
  ԁ: 'd',
  ѡ: 'w',
  ո: 'n',
  А: 'A',
  Е: 'E',
  О: 'O',
  Р: 'P',
  С: 'C',
  У: 'Y',
  Х: 'X',
  І: 'I',
  Ѕ: 'S',
  Ј: 'J',
  М: 'M',
  Н: 'H',
  Т: 'T',
  В: 'B',
  К: 'K',
  ο: 'o',
  α: 'a',
  ε: 'e',
  ρ: 'p',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ς: 's',
  σ: 's',
  μ: 'u',
  γ: 'y',
  η: 'n',
  Ο: 'O',
  Α: 'A',
  Ε: 'E',
  Ρ: 'P',
  Ι: 'I',
  Κ: 'K',
  Ν: 'N',
  Τ: 'T',
  Χ: 'X',
  Β: 'B',
};
function fold(s) {
  let out = '';
  for (const ch of s) out += CONFUSABLES[ch] ?? ch;
  return out;
}

export function sanitizeDescription(raw, fallback) {
  const base = String(raw ?? '')
    .normalize('NFKC') // fold compatibility forms (fullwidth, ligatures) to canonical
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 300);
  // Probe the denylist against homoglyph-folded copies where invisible splitters are BOTH
  // removed (rejoins an intra-word split: "ig<zwsp>nore" -> "ignore") AND turned into a space
  // (restores an inter-word split: "ignore<zwsp>previous" -> "ignore previous"). Either hits.
  const removed = fold(base.replace(INVISIBLE, ''));
  const spaced = fold(base.replace(INVISIBLE, ' ').replace(/\s{2,}/g, ' '));
  const flagged = DANGEROUS.some((rx) => rx.test(removed) || rx.test(spaced));
  let text = base.replace(INVISIBLE, ''); // stored text: strip the invisibles regardless
  if (flagged) text = '';
  text = text.replace(/[<>{}]/g, '');
  return { text: text || fallback, flagged };
}
