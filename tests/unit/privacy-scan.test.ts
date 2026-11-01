// LANE-K6e: bounded-stack, linear privacy scanning of huge opaque tokens (Q13). Synthetic data only.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../support/headless';
// @ts-expect-error shared ESM report tool
import { findSensitive, redact } from '../../tools/report/redact.mjs';
// @ts-expect-error shared ESM report tool
import { leakcheck } from '../../tools/report/leakcheck.mjs';

const rules = (text: string): string[] => findSensitive(text).map((h: { rule: string }) => h.rule);
const secrets: Record<string, string> = {
  'private key': ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' '),
  'AWS access key': 'AK' + 'IA' + 'A'.repeat(16),
  'GitHub token': ['ghp', 'a'.repeat(30)].join('_'),
  'Anthropic key': ['sk', 'ant', 'a'.repeat(30)].join('-'),
  'OpenAI-style key': ['sk', 'a'.repeat(40)].join('-'),
  'Slack token': ['xoxb', 'a'.repeat(30)].join('-'),
  'generic secret assignment': 'token=' + JSON.stringify('a'.repeat(30)),
};
const LIMIT_MS = 5000; // measured ~0.15-0.5 s for 12M-character inputs; the old regexes threw RangeError

// --- reference: the former regex implementation, for differential testing ---------------------------------------------
const refSecrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/, /\bsk-ant-[A-Za-z0-9_-]{20,}\b/, /\bsk-[A-Za-z0-9]{32,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, /\b(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*["'][^"'\s]{12,}["']/i,
];
function refRedact(text: string): string {
  let out = text;
  const home = homedir(), user = userInfo().username;
  out = out.split(home).join('~');
  out = out.replace(/(?:\/Users|\/home)\/[A-Za-z0-9._-]+\//g, '~/').replace(/[A-Za-z]:\\Users\\[^\\\s]+\\/g, '~\\');
  out = out.replace(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '<user>');
  out = out.replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (m) => (/(example\.com|noreply)/.test(m) ? m : '<email>'));
  for (const re of refSecrets) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), '<redacted-secret>');
  return out.replace(/[A-Za-z0-9+/]{2048,}={0,2}/g, (m) => `<redacted base64 blob, ${m.length} chars>`);
}
function refRules(text: string): string[] {
  const out: string[] = [];
  const home = homedir();
  if (text.includes(home)) out.push('home path');
  const user = [...text.matchAll(/(?:\/Users|\/home)\/[A-Za-z0-9._-]+\//g)].length + [...text.matchAll(/[A-Za-z]:\\Users\\[^\\\s]+\\/g)].length;
  out.push(...Array(user).fill('absolute user path'));
  for (const m of text.matchAll(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
    if (!/@(?:example\.com|anthropic\.com|users\.noreply\.github\.com)$/.test(m[0]) && !/noreply@/.test(m[0])) out.push('email address');
  }
  return out;
}

describe('linear scanner equals the former regexes', () => {
  it('matches redaction and key rules on 10k seeded adversarial strings plus 2048-boundary blobs', () => {
    let seed = 20260101;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const frags = ['sk-', 'sk-ant-', 'ghp_', 'github_pat_', 'xoxb-', 'AKIA', secrets['private key'], 'token', 'Password', 'api_key', ' ', '  ', '\t', '\n', '=', ':', '"', "'",
      'a', 'Z', '0', '_', '-', '.', '+', '/', '%', '@', '/Users/', '/home/', 'C:\\Users\\', '\\', '\u00a0', 'com', '.com', 'x'.repeat(20), 'a'.repeat(32), 'k'.repeat(12),
      'example.com', 'noreply@', '0000: ', '00 ', 'A'.repeat(300), '==', 'é', userInfo().username, homedir()];
    let checked = 0, flagged = 0;
    for (let i = 0; i < 10_000; i++) {
      let text = '';
      for (let n = 1 + Math.floor(rnd() * 12); n--;) text += frags[Math.floor(rnd() * frags.length)];
      if (rnd() < 0.1) text = text.repeat(1 + Math.floor(rnd() * 3));
      expect(redact(text), JSON.stringify(text).slice(0, 200)).toBe(refRedact(text));
      const got = rules(text);
      for (const re of refSecrets) {
        const name = Object.keys(secrets)[refSecrets.indexOf(re)];
        expect(got.includes(name), `${name}: ${JSON.stringify(text).slice(0, 200)}`).toBe(re.test(text));
      }
      expect(got.filter((r) => ['home path', 'absolute user path', 'email address'].includes(r)), JSON.stringify(text).slice(0, 200)).toEqual(refRules(text));
      expect(got.includes('large base64 blob')).toBe(/[A-Za-z0-9+/]{2048,}/.test(text));
      checked++;
      if (got.length) flagged++;
    }
    expect(checked).toBe(10_000);
    expect(flagged).toBeGreaterThan(2_000);
    // the 2048-character blob threshold, with and without padding '=' (reference regexes are slow on long runs: few cases)
    for (const n of [2046, 2047, 2048, 2049]) for (const pad of ['', '=', '==', '===']) {
      const text = 'x' + 'A'.repeat(n - 1) + pad + ' tail';
      expect(redact(text), `${n}${pad}`).toBe(refRedact(text));
      expect(rules(text).includes('large base64 blob')).toBe(n >= 2048);
    }
  });

  it('keeps the hex-dump rule (more than 16 lines) and its boundaries', () => {
    const line = '0000: ' + '00 '.repeat(14);
    expect(rules(Array(17).fill(line).join('\n'))).toContain('hex dump of binary content (>16 lines)');
    expect(rules(Array(16).fill(line).join('\n'))).not.toContain('hex dump of binary content (>16 lines)');
    expect(rules(Array(17).fill('0000: ' + '00 '.repeat(11)).join('\n'))).not.toContain('hex dump of binary content (>16 lines)');
    expect(rules(Array(17).fill('  DEADBEEF  ' + 'Ff '.repeat(12)).join('\r\n'))).toContain('hex dump of binary content (>16 lines)');
    expect(rules(Array(17).fill('123456789 ' + '00 '.repeat(14)).join('\n'))).not.toContain('hex dump of binary content (>16 lines)');
  });
});

describe('bounded-stack processing of huge tokens', () => {
  const huge = (n: number, ch = 'A') => ch.repeat(n);
  const timed = <T>(f: () => T): [T, number] => { const t = performance.now(); const r = f(); return [r, performance.now() - t]; };

  for (const length of [8_000_000, 12_000_000]) {
    it(`scans and redacts a ${length}-character token in bounded time and memory`, () => {
      const text = huge(length);
      const before = process.memoryUsage();
      const [found, scanMs] = timed(() => findSensitive(text));
      expect(found).toEqual([{ rule: 'large base64 blob', sample: `${length} chars` }]);
      const [out, redactMs] = timed(() => redact(text));
      expect(out).toBe(`<redacted base64 blob, ${length} chars>`);
      expect(scanMs).toBeLessThan(LIMIT_MS);
      expect(redactMs).toBeLessThan(LIMIT_MS);
      const after = process.memoryUsage();
      expect(after.heapUsed + after.external - before.heapUsed - before.external).toBeLessThan(256 * 1024 * 1024);
    });
  }

  it('survives every rule\'s adversarial long run (no RangeError, linear time) at 8M characters', () => {
    const N = 8_000_000;
    const user = userInfo().username;
    const shapes: Record<string, string> = {
      spaces: ' '.repeat(N), dots: '.'.repeat(N), dashes: '-'.repeat(N), underscores: '_'.repeat(N),
      atRun: 'a@' + 'a'.repeat(N), atDots: 'a@' + 'a.'.repeat(N / 2), atDashes: 'a@' + 'a-'.repeat(N / 2), localThenAt: 'a'.repeat(N) + '@',
      windowsPath: 'C:\\Users\\' + 'a'.repeat(N), unixPath: '/Users/' + 'a'.repeat(N), unixDots: '/Users/' + '.'.repeat(N),
      hexSpaces: '0000:' + ' '.repeat(N) + '\n', hexPairs: '0000 ' + '00 '.repeat(N / 3) + '\n', leadingSpaces: ' '.repeat(N) + 'x',
      keywordSpaces: 'token' + ' '.repeat(N) + 'x', keywordOpenQuote: 'token="' + 'a'.repeat(N), keywordSingle: "token='" + 'a'.repeat(N) + ' ',
      keywordSpaceQuote: 'token= \'' + 'a'.repeat(N), github: 'ghp_' + 'a'.repeat(N), anthropic: 'sk-ant-' + 'a'.repeat(N), anthropicDashes: 'sk-ant-' + '-'.repeat(N),
      slackDashes: 'xoxb-' + '-'.repeat(N), openaiUnderscore: 'sk-' + 'a'.repeat(N) + '_', trailingEquals: 'a'.repeat(N) + '==', userThenBlob: user + 'a'.repeat(N),
      repeatedAnchors: 'sk-'.repeat(N / 3), repeatedKeys: 'token="short" '.repeat(N / 14), repeatedAt: 'a@'.repeat(N / 2),
    };
    for (const [name, text] of Object.entries(shapes)) {
      const [, scanMs] = timed(() => findSensitive(text));
      const [, redactMs] = timed(() => redact(text));
      expect(scanMs, `${name} scan`).toBeLessThan(LIMIT_MS);
      expect(redactMs, `${name} redact`).toBeLessThan(LIMIT_MS);
    }
  });

  it('throws nothing in a fresh process with the default stack for 8M and 12M tokens (the reported repro)', () => {
    const script = `
      import { findSensitive, redact } from ${JSON.stringify(join(ROOT, 'tools/report/redact.mjs'))};
      for (const n of [8_000_000, 12_000_000]) {
        const t = 'A'.repeat(n);
        if (findSensitive(t).length !== 1 || redact(t) !== '<redacted base64 blob, ' + n + ' chars>') throw new Error('bad ' + n);
      }
      console.log('ok');`;
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim()).toBe('ok');
  });
});

describe('sensitive strings inside, around and across chunk boundaries of large tokens', () => {
  const sep = '/';
  it('detects and redacts every secret kind embedded between 6M-character tokens', () => {
    for (const [rule, secret] of Object.entries(secrets)) {
      const text = 'A'.repeat(6_000_000) + sep + secret + sep + 'B'.repeat(6_000_000);
      expect(rules(text), rule).toEqual(expect.arrayContaining([rule, 'large base64 blob']));
      const out = redact(text);
      expect(out, rule).not.toContain(secret);
      expect(out).toContain('<redacted-secret>');
      expect(rules(out), rule).toEqual([]);
    }
  });

  it('detects secrets, emails and paths at every offset around typical chunk sizes (64 KiB, 1 MiB, 16 MiB)', () => {
    const mail = 'bob@corp.io', path = '/Users/alice/x', win = 'C:\\Users\\carol\\x';
    const items: [string, string][] = [...Object.entries(secrets), ['email address', mail], ['absolute user path', path], ['absolute user path', win]];
    for (const chunk of [1 << 16, 1 << 20]) {
      for (const [rule, item] of items) {
        // place the item so it ends exactly on / straddles the chunk boundary at several offsets
        for (const back of [0, 1, Math.floor(item.length / 2), item.length - 1, item.length, item.length + 1]) {
          const start = chunk - back;
          const text = 'A'.repeat(start) + sep + item + sep + 'B'.repeat(chunk);
          const out = redact(text);
          expect(rules(text), `${rule}@${chunk}-${back}`).toContain(rule);
          expect(out.includes(item), `${rule}@${chunk}-${back}`).toBe(false);
        }
      }
    }
  });

  it('counts blobs split by a secret separately and keeps all redaction notices', () => {
    const secret = secrets['GitHub token'];
    const text = 'A'.repeat(3000) + sep + secret + sep + 'B'.repeat(3000);
    // '/' is a base64 character, so each separator belongs to its adjoining blob (secrets are redacted first)
    expect(redact(text)).toBe('<redacted base64 blob, 3001 chars><redacted-secret><redacted base64 blob, 3001 chars>');
  });

  it('detects a streamed token whose pieces arrive in arbitrary chunks and are joined', () => {
    const pieces = ['A'.repeat(70_000) + '/', ['gh', 'p_'].join(''), 'a'.repeat(15), 'a'.repeat(15), sep + 'B'.repeat(70_000)];
    const text = pieces.join('');
    expect(rules(text)).toContain('GitHub token');
    expect(rules('/' + pieces.slice(1, 4).join('') + '/')).toContain('GitHub token');
  });
});

describe('19 MB Playwright-style reports', () => {
  const reportWith = (blobs: number[]) => JSON.stringify({
    config: { rootDir: '/Users/alice/proj' },
    suites: [{ specs: [{ tests: [{ results: [{
      status: 'passed',
      attachments: blobs.map((n, i) => ({ name: `coverage-${i}.json`, contentType: 'application/json', body: 'TWFu'.repeat(n / 4) })),
      stdout: [{ text: "mail bob@corp.io token='" + 'x'.repeat(24) + "'" }],
    }] }] }] }],
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  });

  it('scans, redacts and reparses an unmodified ~19.4 MB report with the outcomes intact', () => {
    const report = reportWith([9_750_000, 9_600_000]);
    expect(report.length).toBeGreaterThan(19_000_000);
    const start = performance.now();
    const found = findSensitive(report);
    expect(found.filter((h: { rule: string }) => h.rule === 'large base64 blob').map((h: { sample: string }) => h.sample)).toEqual(['9750000 chars', '9600000 chars']);
    expect(found.map((h: { rule: string }) => h.rule)).toEqual(expect.arrayContaining(['absolute user path', 'email address', 'generic secret assignment']));
    const redacted = redact(report);
    const out = JSON.parse(redacted);
    expect(performance.now() - start).toBeLessThan(LIMIT_MS);
    expect(out.stats).toEqual({ expected: 1, unexpected: 0, flaky: 0, skipped: 0 });
    expect(out.suites[0].specs[0].tests[0].results[0].status).toBe('passed');
    expect(out.suites[0].specs[0].tests[0].results[0].attachments[0].body).toBe('<redacted base64 blob, 9750000 chars>');
    expect(redacted.length).toBeLessThan(1000);
    expect(rules(redacted)).toEqual([]);
  });

  it('leakcheck finds a secret hidden in a 12M-character text file without overflowing', () => {
    const root = mkdtempSync(join(tmpdir(), 'privacy-scan-'));
    try {
      writeFileSync(join(root, 'dump.txt'), 'A'.repeat(6_000_000) + '/' + secrets['Anthropic key'] + '/' + 'A'.repeat(6_000_000));
      writeFileSync(join(root, 'clean.txt'), 'A'.repeat(12_000_000));
      const start = performance.now();
      const { problems } = leakcheck({ root });
      expect(problems).toEqual([expect.objectContaining({ path: 'dump.txt', why: 'possible Anthropic key' })]);
      expect(performance.now() - start).toBeLessThan(LIMIT_MS);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
