// @bgt-examples: none
// SPDX-License-Identifier: CC0-1.0
import { expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
it('Windows x64 heap/malloc, stack calls and linked sections preserve 16-byte guest alignment', async () => {
  const parent = join(ROOT, 'node_modules/.cache/bgt/native-align'); mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'case-')), id = 'native-alignment';
  try {
    for (const name of ['native_forms_alignment.c', 'native_forms_alignment.S']) cpSync(join(ROOT, 'tests/fixtures/c', name), join(dir, name));
    writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 Windows x64 alignment', pipeline: {
      platform: 'win32', fixture: { target: 'x86_64-windows-gnu', sources: ['native_forms_alignment.c', 'native_forms_alignment.S'], out: 'alignment.exe', entry: 'entry', libs: ['kernel32'] },
      modules: [{ from: './build/alignment.exe', main: true }],
    } }));
    buildGame(dir, { quiet: true }); buildGame(dir, { quiet: true, interpretOnly: true });
    const h = await loadHeadless(id); await h.stepAsync(300);
    const pe = readFileSync(join(ROOT, 'node_modules/.cache/bgt/pipeline', id, 'fixture/alignment.exe'));
    const nt = pe.readUInt32LE(0x3c), count = pe.readUInt16LE(nt + 6), opt = pe.readUInt16LE(nt + 20);
    const loadedHeaders = h.host.peek(0x01000000, nt + 24 + opt + count * 40);
    expect(loadedHeaders).not.toBeNull();
    let linkedText = false, linkedData = false;
    for (let i = 0; i < count; i++) {
      const section = nt + 24 + opt + i * 40, rva = pe.readUInt32LE(section + 12);
      expect(Buffer.from(loadedHeaders!).subarray(section, section + 40)).toEqual(pe.subarray(section, section + 40));
      const name = pe.subarray(section, section + 8).toString().replaceAll('\0', '');
      if (name === '.text') {
        const raw = pe.readUInt32LE(section + 20), size = pe.readUInt32LE(section + 8);
        expect(Buffer.from(h.host.peek(0x01000000 + rva, size)!)).toEqual(pe.subarray(raw, raw + size));
        linkedText = true;
      }
      if (name === '.k27a') {
        const data = h.host.peek(0x01000000 + rva, 16);
        expect(data).not.toBeNull(); expect(rva & 15).toBe(0);
        expect([...new Uint32Array(data!.buffer, data!.byteOffset, 4)]).toEqual([1, 2, 3, 4]);
        linkedData = true;
      }
    }
    expect(linkedText && linkedData).toBe(true);
    expect(h.logs).toContain('guest: native Windows x64 alignment PASS');
    expect(h.logs.some(s => s.includes('FAIL'))).toBe(false);
    expect(h.host.metrics()).toMatchObject({ exited: 1, interp_insns: 0, stubs: [] });
    const differential = await oracle(id, 300);
    expect(differential.identical, JSON.stringify(differential)).toBe(true);
    expect(differential.comparedFrames).toBe(300);
    expect(differential.errors).toEqual({ lifted: null, interpreted: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const name of [id, id + '-interp']) rmSync(join(ROOT, 'web/public/games', name), { recursive: true, force: true });
  }
}, 120000);
