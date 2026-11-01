// Redaction rules shared by the report tool and the leak check.
import { homedir, userInfo } from 'node:os';
import { SECRET_RULES, base64Blobs, countHexDumpLines, emails, hasSecret, replaceSpans, unixUserPaths, windowsUserPaths } from './scan.mjs';

const user = (() => {
  try {
    return userInfo().username;
  } catch {
    return null;
  }
})();

/** `re` documents each rule (and is the reference the tests diff against); detection uses the linear `find` matchers. */
const SECRET_REGEXES = [
  { name: 'private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'generic secret assignment', re: /\b(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];

export const SECRET_PATTERNS = SECRET_REGEXES.map((p) => ({ ...p, find: SECRET_RULES.find((r) => r.name === p.name).find }));

/** Things that must not appear in reports: absolute home paths, emails, secrets, large blobs, hex dumps.
 * LANE-K6e: every unbounded-run rule is a linear scanner (see scan.mjs); no regex quantifier ever spans a large token,
 * so 8M/12M-character tokens neither overflow the regex backtrack stack nor go quadratic. No blob is skipped before
 * the secret, email or path checks. */
export function findSensitive(text) {
  const hits = [];
  const home = homedir();
  if (home && home.length > 3 && text.includes(home)) hits.push({ rule: 'home path', sample: home });
  for (const s of [...unixUserPaths(text), ...windowsUserPaths(text)]) hits.push({ rule: 'absolute user path', sample: text.slice(s.index, s.end) });
  for (const m of emails(text)) {
    if (!/@(?:example\.com|anthropic\.com|users\.noreply\.github\.com)$/.test(m.text) && !/noreply@/.test(m.text)) hits.push({ rule: 'email address', sample: m.text });
  }
  for (const p of SECRET_PATTERNS) if (hasSecret(text, p)) hits.push({ rule: p.name, sample: '<secret>' });
  for (const s of base64Blobs(text)) hits.push({ rule: 'large base64 blob', sample: `${s.end - s.index} chars` });
  const hexLines = countHexDumpLines(text);
  if (hexLines > 16) hits.push({ rule: 'hex dump of binary content (>16 lines)', sample: `${hexLines} lines` });
  return hits;
}

export function redact(text) {
  let out = text;
  const home = homedir();
  if (home && home.length > 3) out = out.split(home).join('~');
  out = replaceSpans(out, unixUserPaths(out), () => '~/');
  out = replaceSpans(out, windowsUserPaths(out), () => '~\\');
  if (user && user.length > 2) out = out.replace(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '<user>');
  out = replaceSpans(out, emails(out), (m) => (/(example\.com|noreply)/.test(m.text) ? m.text : '<email>'));
  for (const p of SECRET_PATTERNS) out = replaceSpans(out, p.find(out), () => '<redacted-secret>');
  out = replaceSpans(out, base64Blobs(out), (s) => `<redacted base64 blob, ${s.end - s.index} chars>`);
  return out;
}
