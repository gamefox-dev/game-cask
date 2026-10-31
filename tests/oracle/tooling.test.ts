// LANE-K4b: report/privacy contracts, including large Playwright-style inline attachments.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { ROOT } from '../support/headless';
// @ts-expect-error shared ESM report tool
import { findSensitive, redact } from '../../tools/report/redact.mjs';
// @ts-expect-error shared ESM report tool
import { validateProgress, validateQueue } from '../../tools/report/schema.mjs';
// @ts-expect-error shared ESM report tool
import { leakcheck } from '../../tools/report/leakcheck.mjs';

const rules = (text: string): string[] => findSensitive(text).map((h: { rule: string }) => h.rule);
for (const length of [100_000, 500_000]) it(`scans and redacts a ${length}-character opaque token well under a second`, () => {
  const text = 'a'.repeat(length);
  const start = performance.now();
  expect(rules(text)).toContain('large base64 blob');
  expect(redact(text)).toBe(`<redacted base64 blob, ${length} chars>`);
  expect(performance.now() - start).toBeLessThan(750);
});

it('preserves embedded secret, email and path detection inside large opaque data', () => {
  const secrets: [string, string][] = [
    ['private key', ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ')],
    ['AWS access key', 'AK' + 'IA' + 'A'.repeat(16)],
    ['GitHub token', ['ghp', 'a'.repeat(30)].join('_')],
    ['Anthropic key', ['sk', 'ant', 'a'.repeat(30)].join('-')],
    ['OpenAI-style key', ['sk', 'a'.repeat(40)].join('-')],
    ['Slack token', ['xoxb', 'a'.repeat(30)].join('-')],
    ['generic secret assignment', 'token=' + JSON.stringify('a'.repeat(30))],
  ];
  for (const [rule, secret] of secrets) {
    const text = 'A'.repeat(100_000) + '/' + secret + '/' + 'B'.repeat(100_000);
    expect(rules(text), rule).toContain(rule);
    expect(redact(text), rule).not.toContain(secret);
  }
  const text = 'A'.repeat(100_000) + '/Users/alice/files/mail bob@corp.io /home/bob/files C:\\Users\\bob\\files ' + 'B'.repeat(100_000);
  expect(rules(text)).toEqual(expect.arrayContaining(['absolute user path', 'email address', 'large base64 blob']));
  expect(redact(text)).not.toMatch(/alice|bob|corp/);
});

it('retains email matching and allowlist behavior, including overlapping domain/local characters', () => {
  const examples = [
    ['a@b.c@d.io', 'a@<email>'], // first @ has no valid TLD, so resume at b.c
    ['a@b.com@c.io', '<email>@c.io'],
    ['a@b.com+next@corp.io', '<email><email>'],
    ['a.b+tag%yes@dept.corp.io', '<email>'],
    ['a@example.com noreply@corp.io', 'a@example.com noreply@corp.io'],
  ];
  for (const [text, expected] of examples) expect(redact(text)).toBe(expected);
  expect(rules('a@example.com a@anthropic.com a@users.noreply.github.com noreply@corp.io')).not.toContain('email address');
  expect(rules('a@corp.io')).toContain('email address');
  const start = performance.now();
  expect(rules('x'.repeat(500_000) + '@' + 'x'.repeat(500_000))).not.toContain('email address');
  expect(redact('x'.repeat(500_000) + '@' + '.'.repeat(500_000))).not.toContain('<email>');
  expect(performance.now() - start).toBeLessThan(750);
});

it('scans canonical Playwright JSON attachments without dropping non-blob privacy checks', () => {
  const report = JSON.stringify({ config: {}, suites: [{ specs: [{ tests: [{ results: [{
    status: 'passed', attachments: Array.from({ length: 81 }, (_, i) => ({
      name: 'screenshot', contentType: 'image/png', body: 'a'.repeat(i === 80 ? 500_000 : 4096),
    })), stdout: [{ text: 'contact bob@corp.io /Users/alice/files' }],
  }] }] }] }], stats: { expected: 1, unexpected: 0 } });
  const start = performance.now();
  expect(rules(report).filter((r) => r === 'large base64 blob')).toHaveLength(81);
  expect(rules(report)).toEqual(expect.arrayContaining(['email address', 'absolute user path']));
  const out = JSON.parse(redact(report));
  expect(out.stats).toEqual({ expected: 1, unexpected: 0 });
  expect(rules(JSON.stringify(out))).toEqual([]);
  expect(performance.now() - start).toBeLessThan(750);
});

it('leakcheck still finds secrets embedded in large text files', () => {
  const root = mkdtempSync(join(tmpdir(), 'privacy-test-'));
  try {
    writeFileSync(join(root, 'report.txt'), 'A'.repeat(500_000) + '/' + ['ghp', 'b'.repeat(30)].join('_') + '/');
    const start = performance.now();
    expect(leakcheck({ root }).problems).toEqual(expect.arrayContaining([expect.objectContaining({ why: 'possible GitHub token' })]));
    expect(performance.now() - start).toBeLessThan(750);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('accepts an evidenced test-tooling iteration queue without relocalizing it', () => {
  // Original synthetic queue, not copied from any private port or trial measurements.
  const queue = [
    { id: 'T1', symptom: 'Oracle drops preflight error report', next: 'Catch preflight errors and write zero compared frames; test first-update abort' },
    { id: 'T2', symptom: 'Privacy scan scales quadratically on attachments', next: 'Use bounded email matching and test large inline attachments' },
    { id: 'T3', symptom: 'Schema rejects kit test gaps', next: 'Allow test-layer iteration requests and reject game-layer requests' },
  ].map((q) => ({ ...q, evidence: ['synthetic regression log'], layer: 'test', status: 'iteration-request' }));
  expect(validateProgress({ game: 'synthetic', achieved_level: 'L0', target_level: 'L3', steps: [], next: 'Kit fixes', queue })).toEqual([]);
  expect(validateQueue([{ ...queue[0], layer: 'game' }]).join('\n')).toMatch(/needs a kit layer/);
  expect(validateQueue([{ ...queue[0], evidence: [] }]).join('\n')).toMatch(/invalid "evidence"/);
  expect(validateQueue([{ ...queue[0], evidence: [' '] }]).join('\n')).toMatch(/invalid "evidence"/);
  expect(validateQueue([{ ...queue[0], next: ' ' }]).join('\n')).toMatch(/invalid "next"/);
  expect(validateQueue([{ ...queue[0], status: 'authentic' }]).join('\n')).toMatch(/requires layer "game"/);
});

it('CLI setup and build failures replace stale successes and retain nonzero status', () => {
  const dir = mkdtempSync(join(ROOT, 'node_modules', 'oracle-invalid-'));
  const id = 'oracle-invalid-test';
  const file = join(ROOT, 'reports', `oracle-${id}.json`);
  try {
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, pipeline: { platform: 'win32', modules: [{ from: './absent.exe', main: true }] } }));
    for (const [frames, stage] of [['invalid', 'setup'], ['300', 'build-lifted']]) {
      writeFileSync(file, JSON.stringify({ identical: true, frames: 300 }));
      let status = 0;
      try { execFileSync(process.execPath, [join(ROOT, 'tools/build/oracle-cli.mjs'), dir, frames], { cwd: ROOT, stdio: 'pipe' }); }
      catch (e) { status = (e as { status: number }).status; }
      expect(status).toBe(1);
      expect(JSON.parse(readFileSync(file, 'utf8')), readFileSync(file, 'utf8')).toMatchObject({ identical: false, frames: 0, comparedFrames: 0, failureStage: stage, exitStatus: 1 });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true }); rmSync(file, { force: true });
    rmSync(join(ROOT, 'node_modules/.cache/bgt/pipeline', id), { recursive: true, force: true });
  }
});

it('CLI writes fresh structured zero-frame failure for an original PE that aborts on first update', () => {
  const dir = mkdtempSync(join(ROOT, 'node_modules', 'oracle-abort-'));
  const id = 'oracle-startup-abort-test';
  const file = join(ROOT, 'reports', `oracle-${id}.json`);
  try {
    writeFileSync(join(dir, 'abort.c'), readFileSync(join(ROOT, 'tests/oracle/fixtures/startup-abort.c')));
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 startup abort regression', pipeline: {
      platform: 'win32', fixture: { target: 'x86_64-windows-gnu', sources: ['abort.c'], out: 'abort.exe', libs: ['kernel32'] },
      modules: [{ from: './build/abort.exe', main: true }], width: 320, height: 200,
    } }));
    writeFileSync(file, JSON.stringify({ identical: true, frames: 300 }));
    let status = 0, output = '';
    try { execFileSync(process.execPath, [join(ROOT, 'tools/build/oracle-cli.mjs'), dir, '300'], { cwd: ROOT, stdio: 'pipe' }); }
    catch (e) {
      const failure = e as { status: number; stdout?: Buffer; stderr?: Buffer };
      status = failure.status; output = String(failure.stdout) + String(failure.stderr);
    }
    expect(status).toBe(1);
    const report = JSON.parse(readFileSync(file, 'utf8'));
    expect(report, JSON.stringify(report) + '\n' + output).toMatchObject({ requestedFrames: 300, comparedFrames: 0, frames: 0, identical: false, failureStage: 'preflight-step', exitStatus: 1,
      hashes: { lifted: null, interpreted: null }, firstDivergence: null });
    expect(report.error).toContain('guest CRT abort');
  } finally {
    rmSync(dir, { recursive: true, force: true }); rmSync(file, { force: true });
    for (const name of [id, id + '-interp']) {
      rmSync(join(ROOT, 'web/public/games', name), { recursive: true, force: true });
      rmSync(join(ROOT, 'node_modules/.cache/bgt/pipeline', name), { recursive: true, force: true });
    }
  }
}, 120_000);
