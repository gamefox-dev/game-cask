// Original CC0-1.0. Real profile object lifecycle, not the unbounded calloc-only language driver.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../support/headless';

let dir: string, exe: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bgt-gl-memory-')); exe = join(dir, 'driver');
  execFileSync(process.env.CC ?? 'cc', ['-std=c11', '-O1', '-Wall', '-Wextra', '-Werror', '-DW32_GL_TEST_NAME_LIMIT=1023', '-DW32_GL_TEST_WORK',
    '-ffunction-sections', '-fdata-sections', process.platform === 'darwin' ? '-Wl,-dead_strip' : '-Wl,--gc-sections',
    '-I', join(ROOT, 'bgt/include'), '-I', join(ROOT, 'platforms/x86'), '-I', join(ROOT, 'platforms/win32'),
    join(ROOT, 'tests/native/gl_frontend_driver.c'), '-o', exe], { stdio: 'pipe' });
}, 30_000);
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
for (const [mode, marker] of [
  ['error-order', 'guest first-error ordering and immediate framebuffer completeness OK'],
  ['hotpaths', 'hot paths: cached namespaces, direct/hash lookup, collision churn, dormant retirement and final detach OK'],
  ['object-identity', 'object identity namespaces=9 reserved/instantiated/unbind/delete/regen OK'],
  ['sampler-churn', 'sampler churn sampler+texture states draws=2176 bounded/reclaimed OK'],
  ['batch-valid', 'batch framing valid multi-command OK'],
  ['stress', 'stress cycles=768 retained=96'],
  ['lifecycle', 'lifecycle snapshot/relink/rollback/deferred/shared/detach OK'],
  ['exhaustion', 'exhaustion truthful compile/link logs, GL_OUT_OF_MEMORY, recovery OK'],
  ['allocator', 'allocator split/coalesce/zero/overflow OK'],
  ['backend-failure', 'backend rejected compile and command submission failures remain visible OK'],
  ['buffers', 'buffer reupload/delete cycles=600 reusable host memory OK'],
  ['respec', 'buffer re-specification contents/size/map/TF/errors counters OK'],
  ['respec-failures', 'buffer rejected reuse reproduces original delete/create stages and first-error latch OK'],
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
for (const mode of ['count-high', 'count-low', 'prefix', 'payload', 'overflow', 'alignment', 'single-prefix', 'single-payload', 'magic', 'version']) {
  it('GL recording adapter rejects malformed batch: ' + mode, () => {
    const result = spawnSync(exe, ['batch-' + mode], { encoding: 'utf8', timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBe('SIGABRT');
    expect(result.stdout).not.toContain('malformed batch was accepted');
  });
}
