// Kit v0.2.1 tools: analyzer data seeds (E3), static imports of unknown DLLs, inspect --strings with UTF-16 and PE
// resource text (E7), leakcheck reference metadata, the trial brief, the work-queue schema and probe mode.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../support/headless';
// @ts-expect-error -- plain ESM module
import { buildFixture, x86tool, peImportDlls, isProfileDll } from '../../tools/build/pipeline.mjs';
// @ts-expect-error -- plain ESM module
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error -- plain ESM module
import { leakcheck } from '../../tools/report/leakcheck.mjs';
// @ts-expect-error -- plain ESM module
import { fillBrief } from '../../tools/report/trial-brief.mjs';
// @ts-expect-error -- plain ESM module
import { validateProgress } from '../../tools/report/schema.mjs';
// @ts-expect-error -- plain ESM module
import { peResources } from '../../tools/inspect/pe-resources.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'bgt-kit-'));

/** VA of the first occurrence of `bytes` in a PE file (section mapping) */
function vaOf(file: string, bytes: Buffer): number {
  const b = readFileSync(file), off = b.indexOf(bytes);
  const nt = b.readUInt32LE(0x3c), opt = nt + 24, base = b.readUInt32LE(opt + 28), nsec = b.readUInt16LE(nt + 6), optsz = b.readUInt16LE(nt + 20);
  for (let i = 0; i < nsec; i++) {
    const o = opt + optsz + 40 * i, va = b.readUInt32LE(o + 12), raw = b.readUInt32LE(o + 20), rs = b.readUInt32LE(o + 16);
    if (off >= raw && off < raw + rs) return base + va + (off - raw);
  }
  throw new Error('not in a section');
}

describe('analyzer: data inside the code section is not lifted (E3)', () => {
  it('classifies strings, zero bytes and unsupported bytes reached by pointers as data seeds; keeps the real callback', () => {
    const dir = tmp();
    const exe = buildFixture(join(ROOT, 'tests/fixtures/win32'), { sources: ['data_in_text.c'], out: 'data_in_text.exe', entry: 'entry', libs: ['user32', 'kernel32'] }, dir);
    const a = JSON.parse(execFileSync(x86tool(), ['analyze', exe, '--name', 'dit'], { encoding: 'utf8' }));
    const ascii = vaOf(exe, Buffer.from('helper-control.ocx\0', 'latin1'));
    const wide = vaOf(exe, Buffer.from('Wide name\0', 'utf16le'));
    const bad = vaOf(exe, Buffer.from([0x90, 0xe4, 0x60, 0xc3]));
    const reasons = Object.fromEntries(a.dataSeeds.map((d: { addr: number; reason: string }) => [d.addr, d.reason]));
    expect(reasons[ascii]).toBe('string');
    expect(reasons[wide]).toBe('string');
    expect(reasons[bad]).toBe('undecodable-or-unsupported');
    expect(Object.values(reasons)).toContain('zero-bytes');
    expect(a.totals.dataSeeds).toBe(a.dataSeeds.length);
    expect(a.totals.unsupported).toBe(0); // nothing data-like is counted as code any more
    const fns = a.functions.map((f: { addr: number }) => f.addr);
    for (const d of a.dataSeeds) expect(fns).not.toContain(d.addr);
    expect(a.functions.some((f: { seed: string }) => f.seed === 'relocated-pointer' || f.seed === 'immediate-pointer')).toBe(true); // real_callback
    const out = join(dir, 'lifted.c');
    const lifted = JSON.parse(execFileSync(x86tool(), ['lift', exe, '--name', 'dit', '--out', out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    expect(lifted.totals.dataSeeds).toBe(a.totals.dataSeeds);
    const c = readFileSync(out, 'utf8');
    expect(c).not.toContain(`F_${ascii.toString(16).padStart(8, '0')}`);
    expect(JSON.parse(readFileSync(out + '.stats.json', 'utf8')).dataSeeds).toBe(a.totals.dataSeeds);
  });
});

describe('pipeline: static imports must resolve (E1)', () => {
  it('a static import of a DLL that is neither shipped nor implemented fails the build with its name', () => {
    expect(isProfileDll('KERNEL32.dll')).toBe(true);
    expect(isProfileDll('api-ms-win-crt-runtime-l1-1-0.dll')).toBe(true);
    expect(isProfileDll('version.dll')).toBe(false);
    const dir = tmp();
    writeFileSync(join(dir, 'u.c'), '#include <windows.h>\nint _tls_index = 0;\nvoid entry(void) { ExitProcess(GetFileVersionInfoSizeA("x", 0)); }\n');
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id: 'kit-test-unknown-dll', name: 't', private: true, pipeline: { platform: 'win32', fixture: { sources: ['u.c'], out: 'u.exe', entry: 'entry', libs: ['kernel32', 'version'] }, modules: [{ from: './build/u.exe', name: 'u.exe', main: true }] } }));
    expect(() => buildGame(dir, { check: true, quiet: true })).toThrow(/u\.exe imports VERSION\.dll, which is neither a module .* nor a DLL the win32 profile implements/i);
    const hello = join(ROOT, 'node_modules/.cache/bgt/pipeline/win32-hello/fixture/hello.exe');
    expect(peImportDlls(readFileSync(hello)).map((d: string) => d.toLowerCase()).sort()).toEqual(['advapi32.dll', 'gdi32.dll', 'kernel32.dll', 'user32.dll']);
  }, 120_000);
});

describe('inspect --strings (E7)', () => {
  it('prints UTF-16 strings and decodes STRINGTABLE, MENU and DIALOG text', () => {
    const hello = join(ROOT, 'node_modules/.cache/bgt/pipeline/win32-hello/fixture/hello.exe');
    const out = execFileSync(process.execPath, [join(ROOT, 'tools/inspect/inspect.mjs'), '--strings', hello], { encoding: 'utf8' });
    expect(out).toMatch(/u16 Changes apply to new boards\./);
    expect(out).toContain('STRING 3: "Game Cask pipeline example"');
    expect(out).toMatch(/MENU 102\n\s+"&Game"\n\s+"&New\\tF2" \(id 201\)\n\s+"&Options\.\.\." \(id 204\)\n\s+----/);
    expect(out).toContain('DIALOG 104: "Options" font 8pt "MS Shell Dlg"');
    expect(out).toMatch(/button id 301 "&Small tiles" style 0x50030009/);
    const res = peResources(readFileSync(hello));
    expect(res.dialogs[0].controls.map((c: { class: string }) => c.class)).toEqual(['button', 'button', 'button', 'button', 'static', 'button', 'button']);
  });
});

describe('leakcheck --against', () => {
  it('ignores the kit\'s own extraction metadata but still blocks payload copies', () => {
    const root = tmp(), against = tmp();
    const payload = Buffer.alloc(4096);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 17 + 3) & 255;
    const meta = JSON.stringify({ schema: 'game-cask/extract/1', input: 'setup.exe', inputSha256: 'ab'.repeat(32), files: [{ name: 'GAME.EXE', chain: ['setup.exe', 'inno:0'] }] }, null, 2);
    writeFileSync(join(against, 'GAME.EXE'), payload);
    writeFileSync(join(against, 'extract.json'), meta);
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'extract-example.json'), meta); // e.g. a doc quoting the kit's metadata format
    writeFileSync(join(root, 'docs', 'copy.bin'), payload);
    const { problems } = leakcheck({ root, against: [against] });
    const by = (p: string) => problems.filter((x: { path: string }) => x.path === p);
    expect(by('docs/extract-example.json')).toEqual([]);
    expect(by('docs/copy.bin').map((x: { why: string }) => x.why).join(' ')).toMatch(/identical to reference file/);
  });
});

describe('trial brief and work queue', () => {
  it('the brief carries the independence/policy/queue contract, never "aim for L3", and a resume section on request', () => {
    const tpl = readFileSync(join(ROOT, 'docs/trial-brief.md'), 'utf8');
    const args = { game: 'GAME.EXE', slug: 'game-003', sha256: 'f'.repeat(64), kit: 'abc1234', date: '2026-10-30', scratch: '/tmp/x' };
    const b = fillBrief(tpl, { ...args, resume: false });
    expect(b).not.toMatch(/\{\{/);
    expect(b).toContain('original/GAME.EXE');
    for (const must of ['archive/', 'game-cask-trials', '/tmp/x', 'Binary-only', 'Never execute', 'circumvention', 'No system installs', 'No git changes', ':5173', 'iteration-request', 'Iteration requests', 'metrics first']) expect(b, must).toContain(must);
    expect(b).not.toMatch(/aim for L3|highest level/i);
    expect(b).not.toContain('Resume mode');
    expect(fillBrief(tpl, { ...args, resume: true })).toMatch(/## Resume mode[\s\S]*npm run oracle -- port/);
  });

  it('validates queue items: layer, status, evidence; no "unverified"; authentic only for the game layer', () => {
    const base = { game: 'g', achieved_level: 'L3', target_level: 'L3', steps: [], next: 'x' };
    const ok = { id: 'Q1', symptom: 's', evidence: ['test x'], layer: 'platform-profile', status: 'iteration-request', next: 'n' };
    expect(validateProgress({ ...base, queue: [ok] })).toEqual([]);
    const errs = validateProgress({ ...base, queue: [ok, { ...ok, id: 'Q1' }, { ...ok, id: 'Q2', status: 'unverified' }, { ...ok, id: 'Q3', status: 'authentic' }, { ...ok, id: 'Q4', evidence: [] }, { ...ok, id: 'Q5', layer: 'test', status: 'iteration-request' }] });
    expect(errs.join('\n')).toMatch(/duplicate id/);
    expect(errs.join('\n')).toMatch(/Q2.*invalid "status"/);
    expect(errs.join('\n')).toMatch(/Q3.*requires layer "game"/);
    expect(errs.join('\n')).toMatch(/Q4.*invalid "evidence"/);
    expect(errs.join('\n')).toMatch(/Q5.*needs a kit layer/);
  });
});

describe('probe mode', () => {
  it('runs a script against the test API on its own server and writes artifacts', () => {
    const dir = tmp();
    writeFileSync(join(dir, 's.mjs'), `export default async function (p) {
      await p.step(5); await p.screenshot('shot'); await p.crop('crop', { x: 0, y: 0, w: 4, h: 4 }, 4);
      const st = await p.debugState(); p.log('mz', (await p.peek(st.modules[0].base, 2)).toString('latin1'), (await p.metrics()).interp_insns);
    }\n`);
    execFileSync(process.execPath, [join(ROOT, 'tools/probe/probe.mjs'), '--game', 'win32-hello', '--script', join(dir, 's.mjs'), '--out', join(dir, 'out')], { cwd: ROOT, stdio: 'pipe' });
    const j = JSON.parse(readFileSync(join(dir, 'out', 'probe.json'), 'utf8'));
    expect(j.errors).toEqual([]);
    expect(j.lines).toEqual(['mz MZ 0']);
    expect(existsSync(join(dir, 'out', 'shot.png')) && existsSync(join(dir, 'out', 'crop.png'))).toBe(true);
  }, 120_000);
});
