// Linear, bounded-stack privacy matchers (LANE-K6e).
//
// The report/leak scanners must survive multi-megabyte opaque tokens (inline base64 attachments in a 19 MB
// Playwright report, synthetic 8M/12M-character tokens). V8's backtracking regex engine keeps one backtrack entry
// per iteration of a greedy `{n,}` loop and throws RangeError once that stack (~64 MB) is exhausted, so no rule
// may put a regex quantifier over an unbounded run.
//
// Every rule here is therefore an explicit scanner: a regex finds a short, bounded *anchor* (a prefix such as
// `sk-ant-`, `/Users/`, `token`), then the unbounded run after it is consumed by a char-code loop (a two-state
// machine: in-run / out-of-run) and the regex's tail semantics (word boundary, closing quote, ...) are applied
// directly. Each matcher is a generator of non-overlapping, leftmost `{index, end}` spans with the same results
// as the regexes it replaced (tests keep the old regexes as a differential reference). All state is local to the
// text position, so a token is detected wherever it lies; there are no chunk boundaries to straddle because the
// whole string is processed in one pass, and cost is O(n) with O(1) stack and no per-token allocation.

const table = (...ranges) => {
  const t = new Uint8Array(128);
  for (const [a, b] of ranges) for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) t[c] = 1;
  return t;
};
const AZ = ['A', 'Z'], az = ['a', 'z'], D = ['0', '9'];
const ALNUM = table(AZ, az, D);
const WORD = table(AZ, az, D, ['_', '_']); // ASCII \w (JS non-unicode \b)
const B64 = table(AZ, az, D, ['+', '+'], ['/', '/']);
const LOCAL = table(AZ, az, D, ['.', '.'], ['_', '_'], ['%', '%'], ['+', '+'], ['-', '-']);
const DOMAIN = table(AZ, az, D, ['.', '.'], ['-', '-']);
const LETTER = table(AZ, az);
const HEX = table(D, ['a', 'f'], ['A', 'F']);
const USERNAME = table(AZ, az, D, ['.', '.'], ['_', '_'], ['-', '-']);
const ANT = table(AZ, az, D, ['_', '_'], ['-', '-']);
const SLACK = table(AZ, az, D, ['-', '-']);

const inClass = (t, c) => c < 128 && t[c] === 1;
/** JS `\s` for one UTF-16 code unit. */
const isWs = (c) =>
  c === 32 || (c >= 9 && c <= 13) || (c >= 0xa0 && (c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff));
const isQuote = (c) => c === 34 || c === 39;

function runEnd(text, i, t) {
  const n = text.length;
  while (i < n && inClass(t, text.charCodeAt(i))) i++;
  return i;
}
function skipWs(text, i) {
  const n = text.length;
  while (i < n && isWs(text.charCodeAt(i))) i++;
  return i;
}
/** Regex `\b` at position p. */
function boundary(text, p) {
  const a = p > 0 && inClass(WORD, text.charCodeAt(p - 1));
  const b = p < text.length && inClass(WORD, text.charCodeAt(p));
  return a !== b;
}
/** Greedy `[class]{min,}\b` after a prefix: the longest end in [start+min, runEnd] on a word boundary, else -1. */
function boundedTail(text, start, t, min) {
  for (let e = runEnd(text, start, t); e >= start + min; e--) if (boundary(text, e)) return e;
  return -1;
}

/** Leftmost non-overlapping matches: `anchor` finds a bounded prefix, `finish(text, m)` returns the match end or -1. */
function* anchored(text, anchor, finish) {
  const re = new RegExp(anchor.source, anchor.flags.includes('g') ? anchor.flags : anchor.flags + 'g');
  let m;
  while ((m = re.exec(text))) {
    const end = finish(text, m);
    if (end >= 0) {
      yield { index: m.index, end };
      re.lastIndex = end;
    } else re.lastIndex = m.index + 1; // exactly what a failed regex attempt does
  }
}
/** Bounded (fixed-length) patterns are safe as plain regexes. */
function* bounded(text, re) {
  for (const m of text.matchAll(re)) yield { index: m.index, end: m.index + m[0].length };
}

const tailAfterPrefix = (t, min) => (text, m) => {
  const e = boundedTail(text, m.index + m[0].length, t, min);
  return e;
};

// --- secrets (names and detection semantics unchanged) -------------------------------------------------------------
const ASSIGN_KEYWORD = /\b(?:api[_-]?key|secret|passwd|password|token)/i;
export const SECRET_RULES = [
  { name: 'private key', find: (text) => bounded(text, /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g) },
  { name: 'AWS access key', find: (text) => bounded(text, /\bAKIA[0-9A-Z]{16}\b/g) },
  { name: 'GitHub token', find: (text) => anchored(text, /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_/g, tailAfterPrefix(WORD, 20)) },
  { name: 'Anthropic key', find: (text) => anchored(text, /\bsk-ant-/g, tailAfterPrefix(ANT, 20)) },
  { name: 'OpenAI-style key', find: (text) => anchored(text, /\bsk-/g, tailAfterPrefix(ALNUM, 32)) },
  { name: 'Slack token', find: (text) => anchored(text, /\bxox[abprs]-/g, tailAfterPrefix(SLACK, 10)) },
  {
    // \b(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*["'][^"'\s]{12,}["']  (case-insensitive)
    name: 'generic secret assignment',
    find: (text) =>
      anchored(text, new RegExp(ASSIGN_KEYWORD.source, 'gi'), (t, m) => {
        let i = skipWs(t, m.index + m[0].length);
        const c = t.charCodeAt(i);
        if (c !== 58 && c !== 61) return -1; // : =
        i = skipWs(t, i + 1);
        if (!isQuote(t.charCodeAt(i))) return -1;
        let j = i + 1;
        while (j < t.length) {
          const d = t.charCodeAt(j);
          if (isQuote(d) || isWs(d)) break;
          j++;
        }
        return j - (i + 1) >= 12 && j < t.length && isQuote(t.charCodeAt(j)) ? j + 1 : -1;
      }),
  },
];

export function hasSecret(text, rule) {
  return !rule.find(text).next().done;
}

// --- paths ---------------------------------------------------------------------------------------------------------
/** (?:\/Users|\/home)\/[A-Za-z0-9._-]+\/ */
export function* unixUserPaths(text) {
  yield* anchored(text, /(?:\/Users|\/home)\//g, (t, m) => {
    const s = m.index + m[0].length;
    const e = runEnd(t, s, USERNAME);
    return e > s && t.charCodeAt(e) === 47 ? e + 1 : -1;
  });
}
/** [A-Za-z]:\\Users\\[^\\\s]+\\ */
export function* windowsUserPaths(text) {
  yield* anchored(text, /[A-Za-z]:\\Users\\/g, (t, m) => {
    const s = m.index + m[0].length;
    let e = s;
    while (e < t.length) {
      const c = t.charCodeAt(e);
      if (c === 92 || isWs(c)) break;
      e++;
    }
    return e > s && t.charCodeAt(e) === 92 ? e + 1 : -1;
  });
}

// --- emails --------------------------------------------------------------------------------------------------------
/** Domain `[A-Za-z0-9.-]+\.[A-Za-z]{2,}` at `start`: end of the match with the last dot (not at the first character)
 * followed by 2+ letters, else -1. Segments between dots are scanned at most once. */
function domainEnd(text, start) {
  const runStop = runEnd(text, start, DOMAIN);
  for (let j = runStop - 1; j > start; j--) {
    if (text.charCodeAt(j) !== 46) continue;
    let k = j + 1;
    while (k < runStop && inClass(LETTER, text.charCodeAt(k))) k++;
    if (k - (j + 1) >= 2) return k;
  }
  return -1;
}
/** Maximal local-part run, then the domain anchored at its following `@`; non-overlapping like the former regexes. */
export function* emails(text) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    while (i < n && !inClass(LOCAL, text.charCodeAt(i))) i++;
    if (i >= n) return;
    const start = i;
    i = runEnd(text, i, LOCAL);
    if (text.charCodeAt(i) !== 64) continue;
    const end = domainEnd(text, i + 1);
    if (end >= 0) {
      yield { index: start, end, text: text.slice(start, end) };
      i = end;
    }
  }
}

// --- opaque blobs and hex dumps ------------------------------------------------------------------------------------
/** [A-Za-z0-9+/]{2048,}={0,2} */
export function* base64Blobs(text, min = 2048) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    while (i < n && !inClass(B64, text.charCodeAt(i))) i++;
    const start = i;
    i = runEnd(text, i, B64);
    if (i - start >= min) {
      let end = i;
      while (end < n && end - i < 2 && text.charCodeAt(end) === 61) end++;
      yield { index: start, end };
      i = end;
    }
  }
}

/** Number of lines matching /^\s*[0-9a-f]{4,8}[:\s]+(?:[0-9a-f]{2}\s+){12,}/i, without splitting the text. */
export function countHexDumpLines(text) {
  const n = text.length;
  let count = 0;
  let ls = 0;
  while (ls <= n) {
    let le = text.indexOf('\n', ls);
    if (le < 0) le = n;
    if (hexLine(text, ls, le)) count++;
    ls = le + 1;
  }
  return count;
}
function hexLine(text, i, end) {
  const ws = (j) => { while (j < end && isWs(text.charCodeAt(j))) j++; return j; };
  i = ws(i);
  let h = i;
  while (h < end && h - i < 9 && inClass(HEX, text.charCodeAt(h))) h++;
  if (h - i < 4 || h - i > 8) return false; // a 9th hex digit cannot be backtracked into [:\s]
  let j = h;
  while (j < end && (text.charCodeAt(j) === 58 || isWs(text.charCodeAt(j)))) j++;
  if (j === h) return false;
  let reps = 0;
  while (reps < 12 && j + 2 < end && inClass(HEX, text.charCodeAt(j)) && inClass(HEX, text.charCodeAt(j + 1)) && isWs(text.charCodeAt(j + 2))) {
    j = ws(j + 2);
    reps++;
  }
  return reps >= 12;
}

/** Replace spans (from a matcher generator over `text`) using `fn(span) -> string`. */
export function replaceSpans(text, spans, fn) {
  const parts = [];
  let end = 0;
  for (const s of spans) {
    parts.push(text.slice(end, s.index), fn(s));
    end = s.end;
  }
  if (!end && !parts.length) return text;
  parts.push(text.slice(end));
  return parts.join('');
}
