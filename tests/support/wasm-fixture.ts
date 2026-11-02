// Run C fixture exports with the production BGT import surface (including diagnostics),
// not a partial import table that silently discards runtime behaviour.
import { BACKEND_HEADLESS } from '../../bgt/runtime/abi';
import { GameHost, type HostConfig } from '../../bgt/runtime/host';
import { Vfs } from '../../bgt/runtime/vfs';

export async function instantiateFixture(wasm: BufferSource, config: Partial<HostConfig> = {}) {
  const logs: { level: number; message: string }[] = [];
  const host = await GameHost.create(wasm, {
    log: (level, message) => { logs.push({ level, message }); },
    vfs: new Vfs(),
    now: () => performance.now(),
  }, {
    backend: BACKEND_HEADLESS, caps: 0, seed: 1,
    displayWidth: 64, displayHeight: 64, arg0: 0, arg1: 0, ...config,
  });
  // Fixtures have additional test-only exports; keep private runtime access here.
  const exports = (host as unknown as { exports: WebAssembly.Exports }).exports;
  return { host, exports, logs };
}
