// ?bench=1 : measure the frame pipeline without conflating its stages.
//   updateMs      wasm bgt_update
//   wasmRenderMs  wasm bgt_render minus time inside submit_commands. In the
//                 direct-call path this INCLUDES the per-sprite import calls,
//                 which are left untimed to avoid perturbing them; compare
//                 paths by renderTotalMs = wasmRenderMs + jsBridgeMs.
//   jsBridgeMs    JS time inside submit_commands (validation + decode + vertex build)
//   gpuSubmitMs   backend JS time to encode + submit the frame
//   frameMs       requestAnimationFrame interval while running free (vsync bound)
import type { BGTRuntime } from '../../bgt/runtime/runtime';

export interface BenchResult {
  backend: string;
  arg0: number;
  arg1: number;
  frames: number;
  updateMs: number;
  wasmRenderMs: number;
  jsBridgeMs: number;
  gpuSubmitMs: number;
  frameMsAvg: number;
  frameMsP95: number;
  drawCalls: number;
  vertices: number;
  commandBytes: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export async function runBench(rt: BGTRuntime, q: URLSearchParams): Promise<void> {
  const frames = Number(q.get('frames') ?? 240);
  const w = window as unknown as { __BGT_BENCH__: { done: boolean; result?: BenchResult; error?: string } };
  w.__BGT_BENCH__ = { done: false };
  try {
    rt.pause();
    await rt.step(30); // warm up JIT and GPU resources
    const up: number[] = [], wr: number[] = [], js: number[] = [], gpu: number[] = [];
    for (let i = 0; i < frames; i++) {
      await rt.step(1);
      const d = rt.diagnostics();
      up.push(d.timing.updateMs);
      wr.push(Math.max(0, d.timing.renderMs - d.timing.decodeMs));
      js.push(d.timing.decodeMs);
      gpu.push(d.timing.gpuSubmitMs);
    }
    rt.resume();
    await new Promise((r) => setTimeout(r, 2000));
    const d = rt.diagnostics();
    w.__BGT_BENCH__ = {
      done: true,
      result: {
        backend: d.backend,
        arg0: Number(q.get('arg0') ?? 0),
        arg1: Number(q.get('arg1') ?? 0),
        frames,
        updateMs: median(up),
        wasmRenderMs: median(wr),
        jsBridgeMs: median(js),
        gpuSubmitMs: median(gpu),
        frameMsAvg: d.timing.frameIntervalMs.avg,
        frameMsP95: d.timing.frameIntervalMs.p95,
        drawCalls: d.lastFrame.drawCalls,
        vertices: d.lastFrame.vertices,
        commandBytes: d.lastFrame.commandBytes,
      },
    };
  } catch (e) {
    w.__BGT_BENCH__ = { done: true, error: (e as Error).message };
  }
}
