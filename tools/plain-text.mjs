// Plain text for the board: RSS often ships HTML, or HTML encoded as
// entities. Decode first, then strip tags, then drop leftovers like `<p><a`
// that truncation leaves behind.

const STOP = new Set([
  'about', 'after', 'from', 'have', 'into', 'said', 'says', 'that', 'this',
  'they', 'their', 'them', 'with', 'will', 'were', 'been', 'when', 'what',
  'which', 'over', 'than', 'also', 'more', 'some', 'could', 'would',
]);

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&hellip;/g, '\u2026')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function safeCodePoint(n) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

export function plainText(s) {
  let out = decodeEntities(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  out = out
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    // Truncated RSS leaves `<a href="...` with no closing `>`.
    .replace(/<\/?[a-zA-Z][\w:-]*[^<>]{0,300}/g, ' ')
    .replace(/[<>]/g, ' ');
  out = decodeEntities(out).replace(/\s+/g, ' ').trim();
  return out;
}

function canon(w) {
  if (!/^[a-z]+$/i.test(w)) return w;
  return w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
}

function words(s) {
  return [...new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
      .map(canon)
  )];
}

function jaccard(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  const inter = a.filter((w) => b.includes(w)).length;
  return inter / new Set([...a, ...b]).size;
}

export function likeHeadline(summary, title) {
  const head = words(title);
  const all = words(summary);
  if (all.length === 0) return true;
  // A dek that only rearranges the headline has almost no new words.
  const novel = all.filter((w) => !head.includes(w));
  return novel.length < 3;
}

export function repeatedSentence(text) {
  const parts = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return false;
  const a = words(parts[0]);
  const b = words(parts[1]);
  return parts[0].toLowerCase() === parts[1].toLowerCase() || jaccard(a, b) >= 0.7;
}

const ARTIFACTS =
  /^(final answer( only)?|answer|summary|short summary|here('s| is) the summary|the summary is|resumo)\s*[:\-\u2013\u2014.]*\s*/i;

const PROMPT_ECHO =
  /220 characters|plain english|no markdown|just the summary|no quotes, no opinions|hereells|copy desk/i;

export function tidySummary(text, maxChars = 240) {
  let out = plainText(text);
  let before;
  do {
    before = out;
    out = out.replace(ARTIFACTS, '').trim();
  } while (out !== before);
  out = out.replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    out = end > 80 ? cut.slice(0, end + 1).trim() : `${cut.replace(/\s+\S*$/, '')}.`;
  }
  return out;
}

export function isUsableSummary(text, title) {
  if (typeof text !== 'string') return false;
  const trimmed = tidySummary(text);
  if (trimmed.length < 60 || !/[.!?]$/.test(trimmed)) return false;
  if (ARTIFACTS.test(trimmed) || PROMPT_ECHO.test(trimmed)) return false;
  if (/<[a-z/]/i.test(trimmed)) return false;
  if (repeatedSentence(trimmed)) return false;
  if (title && likeHeadline(trimmed, title)) return false;
  return true;
}
