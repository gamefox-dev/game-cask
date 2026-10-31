// Redaction rules shared by the report tool and the leak check.
import { homedir, userInfo } from 'node:os';

const user = (() => {
  try {
    return userInfo().username;
  } catch {
    return null;
  }
})();

export const SECRET_PATTERNS = [
  { name: 'private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'generic secret assignment', re: /\b(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i },
];

/** Match each maximal local-part run once, then anchor the domain at its @.
 * An unanchored local+@ regex retries every suffix of a large no-@ blob (quadratic).
 * Do not skip blobs: sensitive substrings inside them still need every privacy rule.
 */
function* emails(text) {
  const domain = /[A-Za-z0-9.-]+\.[A-Za-z]{2,}/y;
  const locals = /[A-Za-z0-9._%+-]+/g;
  let local;
  while ((local = locals.exec(text))) {
    const at = local.index + local[0].length;
    if (text[at] !== '@') continue;
    domain.lastIndex = at + 1;
    const host = domain.exec(text);
    if (host) {
      locals.lastIndex = at + 1 + host[0].length; // retain non-overlapping email semantics
      yield { index: local.index, text: local[0] + '@' + host[0] };
    }
  }
}

function redactEmails(text) {
  const parts = [];
  let end = 0;
  for (const m of emails(text)) {
    parts.push(text.slice(end, m.index), /(example\.com|noreply)/.test(m.text) ? m.text : '<email>');
    end = m.index + m.text.length;
  }
  parts.push(text.slice(end));
  return parts.join('');
}

/** Things that must not appear in reports: absolute home paths, emails, secrets, large blobs, hex dumps. */
export function findSensitive(text) {
  const hits = [];
  const home = homedir();
  if (home && home.length > 3 && text.includes(home)) hits.push({ rule: 'home path', sample: home });
  for (const m of text.matchAll(/(?:\/Users|\/home)\/[A-Za-z0-9._-]+\//g)) hits.push({ rule: 'absolute user path', sample: m[0] });
  for (const m of text.matchAll(/[A-Za-z]:\\Users\\[^\\\s]+\\/g)) hits.push({ rule: 'absolute user path', sample: m[0] });
  for (const m of emails(text)) {
    if (!/@(?:example\.com|anthropic\.com|users\.noreply\.github\.com)$/.test(m.text) && !/noreply@/.test(m.text)) hits.push({ rule: 'email address', sample: m.text });
  }
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) hits.push({ rule: p.name, sample: '<secret>' });
  for (const m of text.matchAll(/[A-Za-z0-9+/]{2048,}={0,2}/g)) hits.push({ rule: 'large base64 blob', sample: `${m[0].length} chars` });
  const hexLines = text.split('\n').filter((l) => /^\s*[0-9a-f]{4,8}[:\s]+(?:[0-9a-f]{2}\s+){12,}/i.test(l));
  if (hexLines.length > 16) hits.push({ rule: 'hex dump of binary content (>16 lines)', sample: `${hexLines.length} lines` });
  return hits;
}

export function redact(text) {
  let out = text;
  const home = homedir();
  if (home && home.length > 3) out = out.split(home).join('~');
  out = out.replace(/(?:\/Users|\/home)\/[A-Za-z0-9._-]+\//g, '~/');
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g, '~\\');
  if (user && user.length > 2) out = out.replace(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '<user>');
  out = redactEmails(out);
  for (const p of SECRET_PATTERNS) out = out.replace(new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g'), '<redacted-secret>');
  out = out.replace(/[A-Za-z0-9+/]{2048,}={0,2}/g, (m) => `<redacted base64 blob, ${m.length} chars>`);
  return out;
}
