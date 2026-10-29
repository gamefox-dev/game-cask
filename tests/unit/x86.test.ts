// v0.2 x86 pipeline: decoder, deterministic lifting, the Win32 example running headless fully lifted, and the
// differential oracle (lifted vs interpreted) agreeing frame by frame.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, loadHeadless } from '../support/headless';
import { oracle } from '../oracle/oracle';
// @ts-expect-error -- plain ESM module
import { x86tool } from '../../tools/build/pipeline.mjs';

const decode = (hex: string) => execFileSync(x86tool(), ['decode', hex], { encoding: 'utf8' }).trim().split('\n');

describe('x86 decoder', () => {
  it('decodes the common integer encodings (lengths, operands, branch targets)', () => {
    expect(decode('5589e583ec188b450c8d4c24f0')).toEqual([
      '1000: 1 push ebp',
      '1001: 2 mov ebp, esp',
      '1003: 3 sub esp, 0x18',
      '1006: 3 mov eax, dword [ebp+0xc]',
      '1009: 4 lea ecx, dword [esp-0x10]',
    ]);
    expect(decode('e8fb0f0000')).toEqual(['1000: 5 call 0x2000']);
    expect(decode('7405')).toEqual(['1000: 2 je 0x1007']);
    expect(decode('0f8500100000')).toEqual(['1000: 6 jne 0x2006']);
    expect(decode('c20800c3')).toEqual(['1000: 3 ret 0x8', '1003: 1 ret 0x0']);
    expect(decode('ff1504204000ff2485')).toEqual(['1000: 6 call dword [0x402004]', '1006: (invalid)']);
    expect(decode('ff248508304000')).toEqual(['1000: 7 jmp dword [eax*4+0x403008]']);
    expect(decode('f3a5f2ae')).toEqual(['1000: 2 rep movsd', '1002: 2 repne scasb']);
    expect(decode('0fb6c06bc00a69c0e8030000')).toEqual(['1000: 3 movzx eax, al', '1003: 3 imul eax, eax, 0xa', '1006: 6 imul eax, eax, 0x3e8']);
    expect(decode('6689c8648b1d18000000')).toEqual(['1000: 3 mov ax, cx', '1003: 7 mov ebx, dword [fs:0x18]']);
    expect(decode('d945f8')).toEqual(['1000: 3 fpu']); /* x87: length known, flagged */
  });
});

describe('Win32 pipeline example', () => {
  it('lifts deterministically', () => {
    const tool = x86tool();
    const exe = join(ROOT, 'node_modules/.cache/bgt/pipeline/win32-hello/fixture/hello.exe');
    const a = execFileSync(tool, ['analyze', exe, '--name', 'hello'], { encoding: 'utf8' });
    const b = execFileSync(tool, ['analyze', exe, '--name', 'hello'], { encoding: 'utf8' });
    expect(a).toBe(b);
    const an = JSON.parse(a);
    expect(an.totals.unresolvedIndirectJumps).toBe(0);
    expect(an.totals.fpu).toBe(0);
    const man = JSON.parse(readFileSync(join(ROOT, 'web/public/games/win32-hello/manifest.json'), 'utf8'));
    expect(man.pipeline.loc.handwritten).toBe(0);
    expect(man.pipeline.exceptions.overrides).toEqual([]);
  });

  it('boots fully lifted: window, menu, painting through GDI on BGT, parked in GetMessage', async () => {
    const h = await loadHeadless('win32-hello');
    h.step(40);
    const m = h.host.metrics() as Record<string, unknown>;
    expect(h.host.logicalWidth).toBe(300);
    expect(h.host.logicalHeight).toBe(245);
    expect(h.host.suspended).toBe(true);
    expect(h.host.commandErrorCount).toBe(0);
    expect(m.interp_insns).toBe(0);
    expect(m.stubs).toEqual([]);
    expect(m.gdi_ops as number).toBeGreaterThan(30);
    expect(m.apis_hit).toEqual(expect.arrayContaining(['CreateWindowExA', 'GetMessageA', 'BitBlt', 'LoadBitmapA', 'TextOutA']));
    // BGT coverage: the profile draws through render targets, sprites and blends
    expect(Object.keys(h.host.opCounts).map(Number)).toEqual(expect.arrayContaining([0x07, 0x10, 0x11, 0x20]));
  });

  it('differential oracle: lifted and interpreted builds agree frame by frame', async () => {
    execFileSync(process.execPath, [join(ROOT, 'tools/build/build.mjs'), 'examples/win32-hello', '--interpret-only'], { stdio: 'ignore' });
    const r = await oracle('win32-hello', 400);
    expect(r.errors).toEqual({ lifted: null, interpreted: null });
    expect(r.firstDivergence).toBeNull();
    const lifted = r.metrics.lifted as Record<string, number>, interp = r.metrics.interpreted as Record<string, number>;
    expect(lifted.interp_insns).toBe(0);
    expect(interp.interp_insns).toBeGreaterThan(10000);
    expect(lifted.api_calls).toBe(interp.api_calls);
  }, 300_000);
});

describe('extract', () => {
  it('unpacks a zip statically and names PE payloads from their metadata', () => {
    const tmp = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
    const exe = join(ROOT, 'node_modules/.cache/bgt/pipeline/win32-hello/fixture/hello.exe');
    execFileSync('python3', ['-I', '-c', `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.write(sys.argv[2],'../../evil/hello.exe'); z.writestr('readme.txt','hi'); z.close()`, join(tmp, 'in.zip'), exe]);
    execFileSync('python3', ['-I', join(ROOT, 'tools/extract/extract.py'), join(tmp, 'in.zip'), join(tmp, 'out')]);
    const m = JSON.parse(readFileSync(join(tmp, 'out', 'extract.json'), 'utf8'));
    expect(m.files.map((f: { name: string }) => f.name).sort()).toEqual(['file000.bin', 'file001.bin']); // no metadata names; never the zip's path
    expect(m.files.every((f: { name: string }) => !f.name.includes('/'))).toBe(true);
  });
});
