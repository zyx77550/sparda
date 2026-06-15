// security/sanitize.js — docstring poisoning defense (spec: blueprint 06-SECURITY §2)
const DANGEROUS = [
  /(^|\s)(ignore|forget|disregard|override)\s+(all\s+)?(previous|prior|above|earlier)/i,
  /(you\s+are\s+(now|a)\b|act\s+as\b|pretend\s+(you\s+are|to\s+be)|from\s+now\s+on)/i,
  /(system\s+prompt|env(ironment)?\s+var|api[\s_-]?key|credential|secret|exfiltrat|\.env\b)/i,
  /(<\/?(system|assistant|human|tool|instructions?)\b|```)/i,
  /(new\s+(role|instructions?)|your\s+(real|true)\s+(task|goal))/i,
];

export function sanitizeDescription(raw, fallback) {
  let text = String(raw ?? '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 300);
  const flagged = DANGEROUS.some((rx) => rx.test(text));
  if (flagged) text = '';
  text = text.replace(/[<>{}]/g, '');
  return { text: text || fallback, flagged };
}
