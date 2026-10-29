// v0.2 bgt_yield: a blocking legacy loop suspends and resumes across frames.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKEND_HEADLESS, CAP_YIELD, IO } from '../../bgt/runtime/abi';
import { GameHost } from '../../bgt/runtime/host';
import { Vfs } from '../../bgt/runtime/vfs';
import { compileC } from '../support/compile';
import { ROOT } from '../support/headless';

const cfg = { backend: BACKEND_HEADLESS, caps: 0, seed: 1, displayWidth: 100, displayHeight: 100, arg0: 0, arg1: 0 };
const services = (logs: string[] = []) => ({ log: (_l: number, m: string) => logs.push(m), vfs: new Vfs(), now: () => 0 });

async function asyncified(): Promise<Uint8Array<ArrayBuffer>> {
  const plain = await compileC('tests/fixtures/c/yield_game.c');
  const d = mkdtempSync(join(tmpdir(), 'bgt-yield-'));
  writeFileSync(join(d, 'in.wasm'), plain);
  execFileSync(process.execPath, [join(ROOT, 'node_modules/binaryen/bin/wasm-opt'), join(d, 'in.wasm'), '--enable-bulk-memory', '--enable-bulk-memory-opt', '--enable-nontrapping-float-to-int', '--enable-sign-ext', '--enable-mutable-globals', '-O2', '--asyncify', '--pass-arg=asyncify-imports@bgt.yield', '-o', join(d, 'out.wasm')]);
  return new Uint8Array(readFileSync(join(d, 'out.wasm')));
}

describe('bgt_yield (asyncify)', () => {
  it('suspends a never-returning loop each frame and resumes it with its stack intact', async () => {
    const h = await GameHost.create(await asyncified(), services(), cfg);
    h.init();
    expect(h.asyncCapable).toBe(true);
    const caps = new DataView(h.memory.buffer).getUint32(h['ioPtr' as never] as unknown as number + IO.caps, true);
    expect(caps & CAP_YIELD).toBe(CAP_YIELD);
    for (let f = 1; f <= 5; f++) {
      h.update();
      expect(h.suspended).toBe(true);
      // render while the update is parked: must not disturb the suspended stack
      h.render();
      h.consume();
      // ticks == f, and the value computed from the deep frames' locals survived the unwind/rewind
      expect(h.stateHash()).toBe((f * 1000 + (f > 1 ? 15 + 19 + 35 + 51 + 67 : 0)).toString(16).padStart(8, "0"));
    }
    expect(h.yields).toBe(5);
    expect(h.logicalWidth).toBe(128); // changed by the game at frame 2
    expect(h.sizeChanged).toBe(true);
  });

  it('a game that yields without an asyncify build gets a clear error', async () => {
    const h = await GameHost.create(await compileC('tests/fixtures/c/yield_game.c'), services(), cfg);
    h.init();
    expect(() => h.update()).toThrow(/not built with "asyncify": true/);
  });
});
