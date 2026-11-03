// Standalone renderer-input replay with ordered native attachment snapshots.
import { GPU_OP as O } from '../runtime/abi';
import type { FrameItem } from '../runtime/commands';
import { canonicalize, isDepthFormat, mipExtent, toCanonicalTexture, type CanonicalTexture } from './gpu-texture';
import { encodeBytes, restoreFrame, type RecordedFrame } from './recording';
import type { Renderer } from './types';

export interface ReplaySnapshot { label: string; format: number; width: number; height: number; data: string }
export class FrameReplay {
  readonly errors: string[] = [];
  private textures = new Map<number, CanonicalTexture>();
  constructor(readonly renderer: Renderer) {
    renderer.onError(message => this.errors.push(message));
    renderer.onLost(message => this.errors.push('Device/context loss: ' + message));
    // Do not let an executor's synchronous failure disappear into drawFrame's void path.
    if (renderer.gpu) {
      const execute = renderer.gpu.execute.bind(renderer.gpu);
      renderer.gpu.execute = item => {
        const code = execute(item); if (code) this.errors.push('GPU opcode ' + item.op + ': ' + code);
        return code;
      };
    }
  }
  async draw(record: RecordedFrame, inspect = false): Promise<ReplaySnapshot[]> {
    const frame = restoreFrame(record), snapshots: ReplaySnapshot[] = [], pending: Promise<void>[] = [];
    const out: FrameItem[] = []; let attachments: { handle: number; mip: number }[] = [];
    const capture = (handle: number, mip: number, label: string) => {
      if (!handle) {
        // Legacy readback routes through the same logical screen as GPU presentation.
        pending.push(new Promise<void>((resolve, reject) => out.push({ kind: 'readback', target: 0,
          x: 0, y: 0, w: frame.logicalW, h: frame.logicalH, complete: (data, error) => {
            if (!data || error) reject(new Error(label + ': screen readback failed'));
            else { snapshots.push({ label, format: 0, width: frame.logicalW, height: frame.logicalH, data: encodeBytes(data) }); resolve(); }
          } })));
        return;
      }
      const desc = this.textures.get(handle);
      if (!desc) throw new Error(label + ': missing texture ' + handle + ' (recording is not standalone)');
      // Packed stencil has no portable WebGPU texture readback. Never fake its contents.
      if (desc.format === 5) return;
      const e = mipExtent(desc, mip);
      pending.push(new Promise<void>((resolve, reject) => out.push({ kind: 'gpu', op: O.TEXTURE_READBACK,
        words: [handle, mip, 0, 0, 0, e.width, e.height, e.depth, 0], readback: (data, error) => {
          if (!data || error) reject(new Error(label + ': native readback failed: ' + error));
          else { snapshots.push({ label, format: desc.format, width: e.width, height: e.height, data: encodeBytes(data) }); resolve(); }
        } })));
    };
    for (let index = 0; index < frame.items.length; index++) {
      const item = frame.items[index]; out.push(item);
      if (item.kind !== 'gpu') continue;
      const { op, words: w } = canonicalize(item.op, item.words);
      if (op === O.TEXTURE_CREATE_EX) this.textures.set(w[0], toCanonicalTexture(w));
      if (op === O.TEXTURE_DELETE) this.textures.delete(w[0]);
      if (op === O.SHADER_CREATE) pending.push(new Promise<void>((resolve, reject) => {
        item.complete = (code, log) => code ? reject(new Error(log || 'shader failed')) : resolve();
      }));
      if (op === O.TEXTURE_READBACK || op === O.BUFFER_READBACK) pending.push(new Promise<void>((resolve, reject) => {
        item.readback = (data, error) => !data || error ? reject(new Error('Recorded readback failed: ' + error)) : resolve();
      }));
      if (op === O.PASS_BEGIN) {
        attachments = Array.from({ length: w[0] }, (_, i) => ({ handle: w[7 + i * 7], mip: w[8 + i * 7] }));
        if (w[1] && !isDepthFormat(this.textures.get(w[1])?.format ?? 0)) throw new Error('Missing depth attachment');
        if (w[1]) attachments.push({ handle: w[1], mip: w[2] });
      }
      if (inspect && op === O.PASS_END) for (const a of attachments) capture(a.handle, a.mip, index + ':pass:' + a.handle + ':' + a.mip);
      if (inspect && op === O.BLIT) capture(w[2], w[3], index + ':blit:' + w[2] + ':' + w[3]);
    }
    frame.items = out;
    // Avoid resizing a preserved canvas when dimensions did not change.
    if (this.renderer.canvas.width !== record.width || this.renderer.canvas.height !== record.height) this.renderer.resize(record.width, record.height);
    const completions = Promise.all(pending);
    // Attach rejection handling before issuing work: readback/compile can finish during drawFrame.
    const completionResult = completions.then(() => undefined, error => error as Error);
    const pixels = await this.renderer.drawFrame(frame, record.letterbox, inspect);
    await this.renderer.finish();
    const completionError = await completionResult; if (completionError) throw completionError;
    if (inspect && pixels) snapshots.push({ label: 'screen', format: 0, width: pixels.width, height: pixels.height, data: encodeBytes(pixels.data) });
    if (this.errors.length) throw new Error(this.errors.join('\n'));
    return snapshots.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }
}
