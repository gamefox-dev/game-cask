// ?debug=1 diagnostics overlay: backend, timings, memory, errors.
import type { BGTRuntime } from '../../bgt/runtime/runtime';

export function startOverlay(rt: BGTRuntime): void {
  const el = document.createElement('pre');
  el.className = 'bgt-debug';
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  const fmt = (n: number) => n.toFixed(2);
  setInterval(() => {
    const d = rt.diagnostics();
    el.textContent = [
      `${d.game?.name ?? '?'}  ABI ${d.abi}  backend ${d.backend}`,
      `frame ${d.frame}  logical ${d.logical.width}x${d.logical.height}  canvas ${d.canvas.width}x${d.canvas.height} @${d.canvas.dpr}x`,
      `interval avg ${fmt(d.timing.frameIntervalMs.avg)} p95 ${fmt(d.timing.frameIntervalMs.p95)} ms`,
      `update ${fmt(d.timing.updateMs)}  render ${fmt(d.timing.renderMs)}  decode ${fmt(d.timing.decodeMs)}  gpu ${fmt(d.timing.gpuSubmitMs)} ms`,
      `draws ${d.lastFrame.drawCalls}  verts ${d.lastFrame.vertices}  cmd ${d.lastFrame.commandBytes} B`,
      `wasm ${(d.wasmMemoryBytes / 1048576).toFixed(1)} MiB  tex ${d.textures.count} (${(d.textures.bytes / 1024).toFixed(0)} KiB)`,
      `audio ${d.audio.state} dropped ${d.audio.droppedFrames}  resets ${d.deviceResets}`,
      `cmd errors ${d.commandErrors.count}  errors ${d.errors.length}${d.errors.length ? ': ' + d.errors[d.errors.length - 1].message : ''}`,
      ...d.backendNotes,
    ].join('\n');
  }, 250);
}
