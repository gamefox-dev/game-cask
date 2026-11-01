// Original CC0 probes: CRT metadata/directory functions and KERNEL32 share one process-local VFS (Q24).
import { it, expect } from 'vitest';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadHeadless } from '../support/headless';
import { oracle } from '../oracle/oracle';
// @ts-expect-error plain ESM
import { importStatus } from '../../tools/x86/imports-coverage.mjs';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';

for (const [machine, target] of [['i386', 'x86-windows-gnu'], ['x86-64', 'x86_64-windows-gnu']]) {
  it(`${machine}: CRT stat/dir/find/path functions and registry deletion agree with the kernel VFS`, async () => {
    const root = join(ROOT, 'node_modules/.cache/bgt/crt-fs');
    mkdirSync(root, { recursive: true });
    const dir = mkdtempSync(join(root, 'case-'));
    try {
      writeFileSync(join(dir, 'probe.c'), readFileSync(join(ROOT, 'tests/fixtures/c/crt_fs.c'), 'utf8'));
      mkdirSync(join(dir, 'assets/nested'), { recursive: true });
      mkdirSync(join(dir, 'assets/Data'), { recursive: true });
      writeFileSync(join(dir, 'assets/nested/seed.txt'), 'original fixture\n');
      writeFileSync(join(dir, 'assets/Data/Alpha.TXT'), 'alpha');
      const id = `crt-fs-${machine}`;
      writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 CRT filesystem contracts', assets: 'assets',
        pipeline: { platform: 'win32', fixture: { target, crt: true, sources: ['probe.c'], out: 'probe.exe', libs: ['kernel32', 'advapi32'] },
          modules: [{ from: './build/probe.exe', main: true }] } }));
      for (const interpretOnly of [false, true]) {
        const outRoot = join(dir, interpretOnly ? 'interpreted' : 'lifted');
        buildGame(dir, { quiet: true, interpretOnly, outRoot });
        const storage = new Map<string, Uint8Array>();
        const h = await loadHeadless(id, { dir: join(outRoot, id + (interpretOnly ? '-interp' : '')), storage });
        // Includes 6.7 virtual seconds of Sleep for independent timestamp checks (600 frames = 9.6 s).
        for (let i = 0; i < 600 && !(h.host.metrics() as any).exited; i++) await h.stepAsync();
        expect(h.logs.filter((s) => s.includes('FAIL')), h.logs.join('\n')).toEqual([]);
        const done = h.logs.find((s) => s.includes('crtfs PASS'));
        expect(done, h.logs.join('\n')).toBeDefined();
        const checks = Number(done!.split('checks=')[1]);
        expect(checks).toBeGreaterThan(machine === 'i386' ? 210 : 270);
        const m = h.host.metrics() as any;
        expect(m.exited).toBe(1);
        /* The only counted stub is the pre-existing i386 startup notification _set_app_type (no profile effect). */
        expect(m.stubs).toEqual(machine === 'i386' ? ['_set_app_type'] : []);
        if (!interpretOnly) expect(m.interp_insns).toBe(0);
        // Registry deletion is a zero-length record (ABI v0.2 has no storage delete).
        const tombstones = [...storage].filter(([k, v]) => k.startsWith('reg.') && v.length === 0);
        expect(tombstones.length).toBe(2); // Name and default value (Score was deleted, then re-set)
        expect([...storage].filter(([k, v]) => k.startsWith('reg.') && v.length > 0).length).toBe(2);
        console.log(`${machine} ${interpretOnly ? 'interpreted' : 'lifted'} checks=${checks}`);
      }
      buildGame(dir, { quiet: true });
      buildGame(dir, { quiet: true, interpretOnly: true });
      const diff = await oracle(id, 600); // reach exit, including the delayed tmpfile and registry checks
      expect(diff.identical, JSON.stringify(diff)).toBe(true);
      expect(diff.frames).toBe(600);
      expect(diff.errors).toEqual({ lifted: null, interpreted: null });
      expect(diff.metrics.lifted).toMatchObject({ exited: 1, interp_insns: 0 });
      expect(diff.metrics.interpreted).toMatchObject({ exited: 1 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 1_800_000);
}

it('census: every CRT metadata/directory name resolves for both widths through one registration', () => {
  const stat = ['_stat', '_stati64', '_stat32', '_stat32i64', '_stat64i32', '_stat64', '_wstat', '_wstati64', '_wstat32', '_wstat32i64', '_wstat64i32', '_wstat64',
    '_fstat', '_fstati64', '_fstat32', '_fstat32i64', '_fstat64i32', '_fstat64'];
  const find = ['', 'i64', '32', '32i64', '64i32', '64'].flatMap((v) => ['_findfirst', '_findnext', '_wfindfirst', '_wfindnext'].map((n) => n + v));
  const rest = ['_findclose', '_access', '_waccess', '_access_s', '_waccess_s', '_mkdir', '_wmkdir', '_rmdir', '_wrmdir', '_chdir', '_wchdir', 'remove', '_wremove',
    '_unlink', '_wunlink', 'rename', '_wrename', '_getcwd', '_wgetcwd', '_getdcwd', '_wgetdcwd', '_fullpath', '_wfullpath', '_getdrive', '_chdrive', '_errno', '_get_errno', '_set_errno'];
  for (const machine of ['i386', 'x86-64']) {
    for (const name of [...stat, ...find, ...rest]) {
      expect(importStatus(name, 'api-ms-win-crt-filesystem-l1-1-0.dll', machine).status, `${machine} ${name}`).toBe('implemented');
      expect(importStatus(name, 'msvcrt.dll', machine).status, `${machine} ${name} msvcrt`).toBe('implemented');
    }
    for (const name of ['RegDeleteValueA', 'RegDeleteValueW', 'RemoveDirectoryW', 'MoveFileW', 'GetFullPathNameW', 'GetFileAttributesExW', 'CreateDirectoryA'])
      expect(importStatus(name, name.startsWith('Reg') ? 'advapi32.dll' : 'kernel32.dll', machine).status, `${machine} ${name}`).toBe('implemented');
  }
});
