import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM module without types
import { detect } from '../../tools/inspect/detect.mjs';
// @ts-expect-error -- plain ESM module without types
import { inventory } from '../../tools/inspect/inspect.mjs';
// @ts-expect-error -- plain ESM module without types
import { leakcheck } from '../../tools/report/leakcheck.mjs';
// @ts-expect-error -- plain ESM module without types
import { findSensitive, redact } from '../../tools/report/redact.mjs';
// @ts-expect-error -- plain ESM module without types
import { validateSubsystemMap } from '../../tools/report/schema.mjs';
// @ts-expect-error -- plain ESM module without types
import { bgti, decodeBmp } from '../../tools/assets/convert.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'bgt-tools-'));

function fakePE(): Buffer {
  const b = Buffer.alloc(1024);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x80, 0x3c);
  b.write('PE\0\0', 0x80, 'latin1');
  b.writeUInt16LE(0x14c, 0x84);
  b.writeUInt16LE(0, 0x86);
  b.writeUInt16LE(224, 0x94);
  b.writeUInt16LE(0x10b, 0x98);
  b.writeUInt16LE(2, 0x98 + 68);
  return b;
}

describe('inspect (synthetic fixtures only)', () => {
  it('detects formats', () => {
    expect(detect(fakePE(), 'GAME.EXE')).toMatchObject({ format: 'pe', platform: 'windows', details: { machine: 'i386', subsystem: 'windows-gui' } });
    const mz = Buffer.alloc(600);
    mz.write('MZ', 0, 'latin1');
    mz.writeUInt16LE(2, 4);
    mz.writeUInt16LE(2, 8);
    mz.set([0xb4, 0x4c, 0xcd, 0x21], 32);
    expect(detect(mz, 'OLD.EXE')).toMatchObject({ format: 'mz', platform: 'dos' });
    const com = Buffer.from([0xe9, 0, 0, 0xb4, 0x09, 0xcd, 0x21, 0xcd, 0x10, 0xcd, 0x16]);
    const c = detect(com, 'X.COM');
    expect(c).toMatchObject({ format: 'dos-com', platform: 'dos', confidence: 'medium' });
    expect(c.hints.join(' ')).toMatch(/int_21h/);
    expect(detect(Buffer.from('\x7fELF\x02\x01\x01' + '\0'.repeat(20), 'latin1'), 'a.out').format).toBe('elf');
    expect(detect(Buffer.from('PK\x03\x04rest', 'latin1'), 'a.zip').format).toBe('zip');
    expect(detect(Buffer.from('NES\x1a\x02\x01\x00\x00', 'latin1'), 'g.nes').platform).toBe('nes');
    const gba = Buffer.alloc(0xc0);
    gba.set([0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21], 4);
    gba.write('TESTROM', 0xa0, 'latin1');
    expect(detect(gba, 't.gba')).toMatchObject({ format: 'gba-rom', details: { title: 'TESTROM' } });
    expect(detect(Buffer.from('hello world\n'), 'readme.txt').format).toBe('text');
    expect(detect(Buffer.alloc(0), 'empty').format).toBe('empty');
  });

  it('tolerates a missing or empty directory and never writes into it', () => {
    const d = tmp();
    expect(inventory(join(d, 'nope')).notes[0]).toMatch(/does not exist/);
    const e = join(d, 'empty');
    mkdirSync(e);
    const inv = inventory(e);
    expect(inv.files).toEqual([]);
    expect(inv.notes[0]).toMatch(/empty/);
    expect(inv.tools.rea).toHaveProperty('available');
    expect(() => execFileSync(process.execPath, ['tools/inspect/inspect.mjs', e, '--out', join(e, 'inv.json')], { stdio: 'pipe' })).toThrow(/refusing to write output inside/);
  });
});

describe('redaction and leak check', () => {
  it('finds and redacts sensitive strings', () => {
    // built at runtime so this file never contains a literal token (the leak check scans sources)
    const text = 'path /Users/alice/games/x and mail bob@corp.io key ' + ['ghp', 'abcdefghijklmnopqrstuvwxyz0123'].join('_');
    expect(findSensitive(text).map((h: { rule: string }) => h.rule)).toEqual(expect.arrayContaining(['absolute user path', 'email address', 'GitHub token']));
    const r = redact(text);
    expect(r).not.toMatch(/alice|bob@corp|ghp_/);
  });

  it('blocks original/, private ports/reports, binaries, copies and embedded bytes', () => {
    const root = tmp();
    const w = (p: string, c: string | Buffer) => {
      mkdirSync(join(root, p, '..'), { recursive: true });
      writeFileSync(join(root, p), c);
    };
    const secretGame = Buffer.alloc(4096, 0);
    for (let i = 0; i < secretGame.length; i++) secretGame[i] = (i * 31 + 7) & 255;
    w('original/GAME.DAT', secretGame);
    w('original/.gitkeep', '');
    w('port/src/main.c', 'int x;');
    w('port/README.md', 'ok');
    w('reports/final-report.md', 'private');
    w('reports/.gitkeep', '');
    w('docs/copy.bin', secretGame);
    w('docs/embed.txt', Buffer.concat([Buffer.from('hdr'), secretGame.subarray(1000, 1200)]));
    w('src/fine.ts', 'export const a = 1;');
    w('config/.env', 'TOKEN=x');
    w('src/key.txt', ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' '));
    const { problems } = leakcheck({ root });
    const byPath = (p: string) => problems.filter((x: { path: string }) => x.path === p).map((x: { why: string }) => x.why).join('; ');
    expect(byPath('original/GAME.DAT')).toMatch(/under original/);
    expect(byPath('original/.gitkeep')).toBe('');
    expect(byPath('port/src/main.c')).toMatch(/private by default/);
    expect(byPath('port/README.md')).toBe('');
    expect(byPath('reports/final-report.md')).toMatch(/private by default/);
    expect(byPath('docs/copy.bin')).toMatch(/identical to reference file/);
    expect(byPath('docs/embed.txt')).toMatch(/embeds bytes/);
    expect(byPath('src/fine.ts')).toBe('');
    expect(byPath('config/.env')).toMatch(/\.env/);
    expect(byPath('src/key.txt')).toMatch(/private key/);
  });
});

describe('report schema', () => {
  it('requires evidence fields and verification evidence for verified status', () => {
    expect(validateSubsystemMap({ subsystems: [{ name: 'gfx' }] }).length).toBeGreaterThan(3);
    const ok = { name: 'gfx', source_evidence: ['x'], confidence: 'high', implementation_strategy: 'replace', status: 'tested', known_deviations: [] };
    expect(validateSubsystemMap({ subsystems: [ok] })).toEqual([]);
    expect(validateSubsystemMap({ subsystems: [{ ...ok, status: 'verified' }] })[0]).toMatch(/verification_evidence/);
  });
});

describe('asset transforms', () => {
  it('decodes a 24-bit BMP to BGTI', () => {
    const w = 2, h = 2, stride = 8;
    const b = Buffer.alloc(54 + stride * h);
    b.write('BM', 0, 'latin1');
    b.writeUInt32LE(b.length, 2);
    b.writeUInt32LE(54, 10);
    b.writeUInt32LE(40, 14);
    b.writeInt32LE(w, 18);
    b.writeInt32LE(h, 22);
    b.writeUInt16LE(24, 28);
    b.set([255, 0, 0, 0, 255, 0], 54); // bottom row: blue, green (BGR)
    b.set([0, 0, 255, 255, 255, 255], 54 + stride); // top row: red, white
    const img = decodeBmp(b);
    expect([...img.rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...img.rgba.subarray(8, 12)]).toEqual([0, 0, 255, 255]);
    const out = bgti(img.width, img.height, img.rgba);
    expect(out.toString('latin1', 0, 4)).toBe('BGTI');
    expect(out.length).toBe(16 + 16);
  });
});

describe('input mapping', () => {
  it('game.json key overrides can add and unbind default keys', async () => {
    const { InputManager } = await import('../../bgt/input/input');
    const { emptyInput } = await import('../../bgt/runtime/host');
    const { BUTTONS } = await import('../../bgt/runtime/abi');
    const im = new InputManager({} as HTMLCanvasElement, { keys: { KeyW: null, KeyI: 'UP' } });
    const snap = emptyInput();
    im.injectTest([{ type: 'key', code: 'KeyW', down: true }]);
    expect(im.snapshot(snap, false).buttons & BUTTONS.UP).toBe(0);
    im.injectTest([{ type: 'key', code: 'KeyW', down: false }, { type: 'key', code: 'KeyI', down: true }]);
    expect(im.snapshot(snap, false).buttons & BUTTONS.UP).toBe(BUTTONS.UP);
    im.injectTest([{ type: 'key', code: 'ArrowUp', down: true }]);
    expect(im.snapshot(snap, false).pressed & BUTTONS.UP).toBe(0); // already held via KeyI
  });
});
