// Original CC0-1.0. Real profile object lifecycle, not the unbounded calloc-only language driver.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../support/headless';

let dir: string, exe: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bgt-gl-memory-')); exe = join(dir, 'driver');
  execFileSync(process.env.CC ?? 'cc', ['-std=c11', '-O1', '-Wall', '-Wextra', '-Werror',
    '-ffunction-sections', '-fdata-sections', process.platform === 'darwin' ? '-Wl,-dead_strip' : '-Wl,--gc-sections',
    '-I', join(ROOT, 'bgt/include'), '-I', join(ROOT, 'platforms/x86'), '-I', join(ROOT, 'platforms/win32'),
    join(ROOT, 'tests/native/gl_frontend_driver.c'), '-o', exe], { stdio: 'pipe' });
}, 30_000);
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
for (const [mode, marker] of [
  ['stress', 'stress cycles=768 retained=96'],
  ['lifecycle', 'lifecycle snapshot/relink/rollback/deferred/shared/detach OK'],
  ['exhaustion', 'exhaustion truthful compile/link logs, GL_OUT_OF_MEMORY, recovery OK'],
  ['allocator', 'allocator split/coalesce/zero/overflow OK'],
  ['backend-failure', 'backend rejected compile and command submission failures remain visible OK'],
  ['buffers', 'buffer reupload/delete cycles=600 reusable host memory OK'],
  ['consumers', 'consumers bidirectional GL/CRT/FILE reuse random=30000'],
  ['vao', 'buffer VAO0 persistence targets=9 strict attributes/draws OK'],
  ['mapping', 'buffer mapping snapshot/flush/ranges/errors/OOM/rejection/delete OK'],
  ['capacity-names', 'capacity names namespaces=9 slots=1023 high/shared/deferred/atomic/recovery OK'],
  ['capacity-storage', 'capacity storage textures=1001 shared/private/byte-budget/rejected/recovery OK'],
  ['capacity-shaders', 'capacity shader handles=1023 shared/deferred/exhaustion/recovery OK'],
  ['capacity-failures', 'capacity failure attribution/sampler draw/retirement recovery/IsBuffer OK'],
]) it('GL frontend bounded host memory: ' + mode, () => {
  const result = execFileSync(exe, [mode], { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  expect(result).toContain(marker);
  if (mode === 'stress') {
    const peak = Number(result.match(/peak=(\d+)/)?.[1]);
    expect(peak).toBeGreaterThan(0); expect(peak).toBeLessThan(32 * 1024 ** 2);
    expect(result).toContain('live=0 oom=0');
  }
}, 60_000);
