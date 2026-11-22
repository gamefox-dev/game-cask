// @bgt-examples: none
// Original CC0 K65 regression for the cut-point guard (coordinator ruling): a suspension while a
// native step frame is live (simulated analysis miss: a test-only "step" entered through the real
// x86_run_native driver that waits for a frame) must FAULT in the Asyncify artifact, before unwinding
// uninstrumented frames, and must only be COUNTED under JSPI (which suspends any stack correctly),
// where the guest continues with the right result. Catches a guard that is missing, mode-blind, or
// that loses the metric; also checks the build-time artifact marker per artifact.
import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, loadHeadless } from '../support/headless';
import { jspiApi } from '../../bgt/runtime/jspi';
// @ts-expect-error ESM build tool
import { buildGame } from '../../tools/build/build.mjs';
// @ts-expect-error ESM analyzer
import { x86tool } from '../../tools/build/pipeline.mjs';

it('faults on Asyncify, counts on JSPI when bgt_yield is reached inside a native step', async () => {
  const cache = join(ROOT, 'node_modules/.cache/bgt'); mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, 'native-guard-')), id = basename(dir).toLowerCase();
  try {
    writeFileSync(join(dir, 'guest.c'), '/* Original CC0 */\n#include <windows.h>\nint _tls_index;\n__declspec(dllexport) __declspec(noinline) unsigned target(unsigned x){return x+7;}\nunsigned (*volatile target_ptr)(unsigned)=target;\nvoid entry(void){char s[80];unsigned x=target_ptr(5);wsprintfA(s,"guard result %u",x);OutputDebugStringA(s);for(;;)Sleep(5);}\n');
    const cfg = { id, name: 'CC0 native-step guard', pipeline: { platform: 'win32', suspensionBuild: 'dual', fixture: { target: 'x86_64-windows-gnu', sources: ['guest.c'], out: 'guest.exe', entry: 'entry', libs: ['kernel32', 'user32'] }, modules: [{ from: './build/guest.exe', main: true }] } };
    writeFileSync(join(dir, 'game.json'), JSON.stringify(cfg));
    const initial = buildGame(dir, { quiet: true });
    const pe = join(ROOT, 'node_modules/.cache/bgt/pipeline', id, 'fixture/guest.exe');
    const analysis = JSON.parse(execFileSync(x86tool(), ['analyze', pe, '--base', initial.pipeline.modules[0].base.toString(16)], { encoding: 'utf8' }));
    const address = analysis.exports.find((e: { name: string }) => e.name === 'target').addr.toString(16).padStart(8, '0');
    mkdirSync(join(dir, 'overrides'));
    writeFileSync(join(dir, 'overrides/target.c'), `/* CC0 test-only: a "native step" that suspends, i.e. a simulated cut-point analysis miss. */
#include "x86_lift.h"
extern void w32_wait_frame(void);
static void suspending_step(uint32_t pc){(void)pc;unsigned v=(unsigned)X.r[ECX];w32_wait_frame();X.r[EAX]=v+7;X.eip=x86_address(x86_pop());}
X86_OVERRIDE(${address}){x86_run_native(suspending_step);}
`);
    buildGame(dir, { quiet: true });
    // Asyncify artifact: the guard faults before any uninstrumented frame is unwound.
    const a = await loadHeadless(id, { suspension: 'asyncify' });
    let error = '';
    try { await a.stepAsync(10); } catch (e) { error = String((e as Error)?.message ?? e); }
    expect(error + '\n' + a.logs.join('\n')).toMatch(/suspension requested inside a generated native step/);
    expect(a.logs).not.toContain('guest: guard result 12');
    // JSPI artifact (same linked program): suspends correctly, the miss is only counted.
    // Unit runs have JSPI with BGT_TEST_JSPI=1 (vitest.config.ts); required then, skipped otherwise.
    if (process.env.BGT_TEST_JSPI === '1') expect(jspiApi()).not.toBeNull();
    if (jspiApi()) {
      const j = await loadHeadless(id, { suspension: 'jspi' });
      await j.stepAsync(10);
      expect(j.logs).toContain('guest: guard result 12');
      expect(j.host.metrics()).toMatchObject({ native_step_suspensions: 1, asyncify_artifact: 0, stubs: [] });
    }
    // A clean program on the Asyncify artifact reports the marker and no events.
    rmSync(join(dir, 'overrides'), { recursive: true, force: true }); buildGame(dir, { quiet: true });
    const clean = await loadHeadless(id, { suspension: 'asyncify' });
    await clean.stepAsync(10);
    expect(clean.logs).toContain('guest: guard result 12');
    expect(clean.host.metrics()).toMatchObject({ native_step_suspensions: 0, asyncify_artifact: 1 });
  } finally {
    for (const p of [dir, join(ROOT, 'web/public/games', id), join(ROOT, 'node_modules/.cache/bgt/pipeline', id)]) rmSync(p, { recursive: true, force: true });
  }
}, 300000);
