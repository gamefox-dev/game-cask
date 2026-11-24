// Test-only deterministic checkpoint controller. Installed before boot, never in normal play.
import { DT_US } from './abi';
import {cloneCheckpoint} from './savestate-clone';
import {validateSavestate} from './savestate-validation';
import type { GameHost, HostServices } from './host';
import type { BGTRuntime } from './runtime';
import {recordCheckpointFrame,checkpointFrameBytes,recordsMutation,type CheckpointFrame} from './savestate-recording';
import {trackCheckpointHost} from './savestate-host';
import './savestate-runtime';
import '../renderers/savestate-surfaces';
import { compactGPU, replayGPU, type GPUCheckpoint } from './savestate-gpu';
import type { CheckpointRenderer } from '../renderers/checkpoint-surfaces';
import { WebGL2Renderer } from '../renderers/webgl2/webgl2';
import { WebGPURenderer } from '../renderers/webgpu/webgpu';
import type { Renderer } from '../renderers/types';

export interface Savestate {
  schema: 'bgt-savestate/1'; identity: string; backend: 'webgl2' | 'webgpu'; width: number; height: number;
  host: ReturnType<GameHost['checkpoint']>;
  vfs: ReturnType<BGTRuntime['vfs']['checkpoint']>;
  input: ReturnType<BGTRuntime['input']['checkpoint']>;
  services: {ticks: number; rng: number; audioQueued: number; audioTimeUs: number; storage: Map<string, Uint8Array>};
  journal: CheckpointFrame[]; gpuBase: GPUCheckpoint | null;
  stats: {nativeBytes:number;residualCommands:number;residualUpdates:number;snapshotMs:number;
    wasmMs?:number;hostMs?:number;gpuMs?:number;replayFrames?:number;replayMs?:number};
}

export class Savestates {
  private ticks = 0;
  private rng: number;
  private audioQueued = 0;
  private audioTimeUs = 0;
  private storage = new Map<string, Uint8Array>();
  private journal: CheckpointFrame[] = [];
  private gpuBase: GPUCheckpoint | null = null;
  private busy = false;
  private journalBytes = 0;
  private journalError: string | null = null;
  private readonly journalLimit = 2 * 1024 * 1024 * 1024;
  private nextCompaction = 128;
  private compacting = 0;
  private executions = new WeakMap<object,Record<string,unknown>>();
  private wrappedRenderer: Renderer | null = null;

  constructor(private readonly rt: BGTRuntime, seed: number) {
    if (rt.ready || rt.host) throw new Error('Deterministic mode must be enabled before boot');
    this.rng = (seed >>> 0) || 1;
    rt.testHarness = {
      services: s => this.services(s),
      trackHost: trackCheckpointHost,
      updated: () => { this.ticks++; this.drainAudio(); },
      afterFrame: () => this.rollJournal(),

      frame: (...args) => {
        if (this.journalError) return;
        const frame = recordCheckpointFrame(...args), bytes = checkpointFrameBytes(frame);
        if (this.journalBytes + bytes > this.journalLimit) {
          this.journalError = 'Savestate GPU journal exceeded 2 GiB; reload or restore an earlier checkpoint (call compactJournal before overflow)';
          this.journal = []; this.journalBytes = 0; return;
        }
        const renderer=rt.renderer!;
        if(renderer!==this.wrappedRenderer && renderer.gpu) {
          const execute=renderer.gpu.execute.bind(renderer.gpu);
          renderer.gpu.execute=item=>{const code=execute(item);if(code){const recorded=this.executions.get(item);if(recorded)recorded.executeCode=code;}return code;};
          this.wrappedRenderer=renderer;
        }
        let i=0;
        for(const item of args[0].items){
          if(!recordsMutation(item))continue;
          const recorded=frame.items[i++];this.executions.set(item,recorded);
          if(item.kind==='gpu' && item.complete) {
            const complete=item.complete;item.complete=(code,log)=>{recorded.completeCode=code;complete(code,log);};
          }
        }
        this.journal.push(frame); this.journalBytes += bytes;
      },
    };
  }
  private services(s: HostServices): HostServices {
    return {...s,
      guestNow: () => this.clockUs() / 1000,
      entropy: bytes => { for (let i = 0; i < bytes.length; i++) {
        let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0; bytes[i] = x & 255;
      } },
      storage: {persistent:false, read:key => this.storage.get(key)?.slice() ?? null,
        write:(key,data) => { this.storage.set(key,data.slice()); return 0; }},
      audio:{sampleRate:48000, queued:() => { this.drainAudio(); return Math.round(this.audioQueued); },
        push:samples => this.pushAudio(samples.length), pushStereo:samples => this.pushAudio(Math.floor(samples.length/2))},
      gamepadRumble:() => {},
    };
  }
  private clockUs(): number { return this.rt.host?.guestTimeUs() ?? this.ticks * DT_US; }
  private drainAudio(): void {
    const now=this.clockUs();
    this.audioQueued=Math.max(0,this.audioQueued-Math.max(0,now-this.audioTimeUs)*48000/1000000);
    this.audioTimeUs=now;
  }
  private pushAudio(frames: number): number {
    this.drainAudio();
    const n = Math.min(frames,Math.max(0,Math.floor(14400 - this.audioQueued)));
    this.audioQueued += n; return n;
  }
  private identity(): string {
    return JSON.stringify({manifest:this.rt.manifest, suspension:this.rt.host?.config.suspensionMode,
      seed:this.rt.host?.config.seed,arg0:this.rt.host?.config.arg0,arg1:this.rt.host?.config.arg1});
  }
  private async exclusive<T>(fn: () => Promise<T>, prepare?: () => void): Promise<T> {
    if (this.busy || !this.rt.testQuiescent()) throw new Error('Savestate requires a paused quiescent update boundary');
    this.busy = true; this.rt.testCheckpointBusy = true;
    try { prepare?.(); await this.rt.renderer!.finish(); return await fn(); }
    finally { this.busy = false; this.rt.testCheckpointBusy = false; }
  }
  snapshot(): Promise<Savestate> {
    return this.exclusive(async () => {
      const rt = this.rt, started = performance.now();
      if (this.journalError) throw new Error(this.journalError);
      if (rt['deviceResets']) throw new Error('Savestates unsupported after graphics device loss');
      let wasmMs=0;
      const host = rt.host!.checkpoint(ms=>{wasmMs=ms;}), vfs = rt.vfs.checkpoint(), input = rt.input.checkpoint();
      const hostMs=performance.now()-started, compact=await this.materialize(), gpuMs=performance.now()-started-hostMs;
      const gpuBase=cloneCheckpoint(this.gpuBase),journal=cloneCheckpoint(this.journal);
      const services=cloneCheckpoint({ticks:this.ticks,rng:this.rng,audioQueued:this.audioQueued,audioTimeUs:this.audioTimeUs,storage:this.storage});
      return {schema:'bgt-savestate/1',identity:this.identity(),backend:rt.renderer!.kind,
        width:rt.canvas.width,height:rt.canvas.height,host,vfs,input,gpuBase,services,journal,
        stats:{...compact.stats,wasmMs,hostMs,gpuMs,snapshotMs:performance.now()-started}};
    });
  }
  compactJournal(): Promise<void> { return this.exclusive(async()=>{ await this.materialize(); }); }
  journalStats() {return {bytes:this.journalBytes,frames:this.journal.length,limit:this.journalLimit,error:this.journalError,compactions:this.compacting};}
  private async rollJournal() {
    // The runtime holds the render/update handoff until this completes. Never
    // compound an unsupported cut on every update; retry exponentially as new
    // resource resets/deletions can make a later cut provable.
    if(this.journalError||this.rt.renderer!.lost||this.rt['deviceResets']||this.journal.length<this.nextCompaction)return;
    try {
      await this.rt.renderer!.finish();
      await this.materialize();
      this.compacting++;
    } catch { this.nextCompaction = this.journal.length * 2; }
  }
  private async materialize() {
    const temporary = await this.createRenderer();
    let compact: Awaited<ReturnType<typeof compactGPU>>;
    try {compact=await compactGPU(temporary,this.gpuBase,this.journal,this.rt.renderer as Renderer & CheckpointRenderer);}finally{this.park(temporary);}
    this.gpuBase=compact.base;this.journal=compact.journal;
    this.nextCompaction=128;
    this.journalBytes=this.journal.reduce((n,f)=>n+checkpointFrameBytes(f),0);
    return compact;
  }
  /** K69: one WebGL2 context is recycled through every temporary/replaced renderer (WebGL2Renderer.reuse): WebKit frees a
   * lost context only on GC, so a new canvas per snapshot, compaction and restore exhausted its 16-context page budget. */
  private scratch?: HTMLCanvasElement;
  private park(renderer: Renderer): void { renderer.destroy(); if (renderer.kind==='webgl2') this.scratch=renderer.canvas; }
  private async createRenderer(): Promise<Renderer & CheckpointRenderer> {
    const sized=(canvas:HTMLCanvasElement)=>{canvas.width=this.rt.canvas.width;canvas.height=this.rt.canvas.height;return canvas;};
    const scratch=this.scratch;this.scratch=undefined;
    const renderer=this.rt.renderer!.kind==='webgl2'
      ? (scratch&&await WebGL2Renderer.reuse(sized(scratch),{debug:true}))||WebGL2Renderer.create(sized(document.createElement('canvas')),{debug:true})
      : await WebGPURenderer.create(sized(document.createElement('canvas')),{debug:true});
    if(!renderer)throw new Error('Savestate renderer unavailable');return renderer;
  }
  restore(snapshot: Savestate): Promise<void> {
    let s:Savestate;
    return this.exclusive(async () => {
      const rt = this.rt;
      if (s.schema !== 'bgt-savestate/1' || s.identity !== this.identity() || s.backend !== rt.renderer!.kind ||
        s.width !== rt.canvas.width || s.height !== rt.canvas.height) throw new Error('Incompatible savestate (artifact, mode, configuration, backend or canvas)');
      // Reject an arbitrary parked JSPI stack before allocating a replacement; returnable boundaries have no task.
      rt.host!.assertCheckpointBoundary();
      validateSavestate(s);
      // All fallible preparation precedes the commit. These detached plain records are
      // assigned synchronously after testReplace; no clone, validation or guest work follows it.
      const vfs=cloneCheckpoint(s.vfs),input=cloneCheckpoint(s.input),services=s.services;
      const journalBytes=s.journal.reduce((n,f)=>n+checkpointFrameBytes(f),0);
      let renderer: (Renderer & CheckpointRenderer) | null = null;
      try {
        renderer = await this.createRenderer();
        await replayGPU(renderer,s.gpuBase,s.journal);
        const host = await rt.testHostFactory!(renderer);
        host.restoreCheckpoint(s.host);
        const previous = rt.renderer!;
        rt.testReplace(host,renderer,input.letterbox); renderer = null;
        if (previous.kind === 'webgl2') this.scratch = previous.canvas; // destroyed by testReplace: the next temporary
        Object.assign(rt.vfs,vfs);Object.assign(rt.input,input);
        this.ticks = services.ticks; this.rng = services.rng; this.audioQueued = services.audioQueued; this.audioTimeUs = services.audioTimeUs;
        this.storage = services.storage; this.journal = s.journal; this.gpuBase = s.gpuBase;
        this.journalBytes = journalBytes; this.journalError = null; this.nextCompaction=128;
      } finally { if (renderer) this.park(renderer); }
    }, () => {
      // Capture synchronously, before even finish() can yield to caller mutation.
      s = cloneCheckpoint(snapshot);
    });
  }
}
