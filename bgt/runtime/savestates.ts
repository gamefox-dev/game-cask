// Test-only deterministic checkpoint controller. Installed before boot, never in normal play.
import { DT_US } from './abi';
import type { GameHost, HostServices } from './host';
import type { BGTRuntime } from './runtime';
import { recordFrame, type RecordedFrame } from '../renderers/recording';
import './savestate-host';
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
  services: {ticks: number; rng: number; audioQueued: number; storage: Map<string, Uint8Array>};
  journal: RecordedFrame[]; gpuBase: GPUCheckpoint | null;
  stats: {nativeBytes:number;residualCommands:number;residualUpdates:number;snapshotMs:number};
}

export class Savestates {
  private ticks = 0;
  private rng: number;
  private audioQueued = 0;
  private storage = new Map<string, Uint8Array>();
  private journal: RecordedFrame[] = [];
  private gpuBase: GPUCheckpoint | null = null;
  private busy = false;
  private journalBytes = 0;
  private journalError: string | null = null;
  private readonly journalLimit = 256 * 1024 * 1024;
  private executions = new WeakMap<object,Record<string,unknown>>();
  private wrappedRenderer: Renderer | null = null;
  private lastCompact = 0;
  constructor(private readonly rt: BGTRuntime, seed: number) {
    if (rt.ready || rt.host) throw new Error('Deterministic mode must be enabled before boot');
    this.rng = (seed >>> 0) || 1;
    rt.testHarness = {
      services: s => this.services(s),
      updated: () => { this.ticks++; this.audioQueued = Math.max(0,this.audioQueued - DT_US * 48000 / 1000000); },
      afterFrame: async () => {
        if(this.journalError || (this.ticks-this.lastCompact<120 && this.journalBytes<32*1024*1024))return;
        this.lastCompact=this.ticks;
        // Bound recording during long routes, not just the eventual restore. A failed
        // materialization keeps the original journal; the explicit snapshot reports why.
        try {await this.materialize();} catch { /* no approximation or guest-visible failure */ }
      },
      frame: (...args) => {
        if (this.journalError) return;
        const frame = recordFrame(...args), bytes = JSON.stringify(frame).length * 2;
        if (this.journalBytes + bytes > this.journalLimit) {
          this.journalError = 'Savestate GPU journal exceeded 256 MiB; reload or restore an earlier checkpoint';
          this.journal = []; this.journalBytes = 0; return;
        }
        const renderer=rt.renderer!;
        if(renderer!==this.wrappedRenderer && renderer.gpu) {
          const execute=renderer.gpu.execute.bind(renderer.gpu);
          renderer.gpu.execute=item=>{const code=execute(item);const recorded=this.executions.get(item);if(recorded)recorded.executeCode=code;return code;};
          this.wrappedRenderer=renderer;
        }
        args[0].items.forEach((item,i)=>{
          this.executions.set(item,frame.items[i]);
          if(item.kind==='gpu' && item.complete) {
            const complete=item.complete;item.complete=(code,log)=>{frame.items[i].completeCode=code;complete(code,log);};
          }
        });
        this.journal.push(frame); this.journalBytes += bytes;
      },
    };
  }
  private services(s: HostServices): HostServices {
    return {...s,
      guestNow: () => this.ticks * DT_US / 1000,
      entropy: bytes => { for (let i = 0; i < bytes.length; i++) {
        let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0; bytes[i] = x & 255;
      } },
      storage: {persistent:false, read:key => this.storage.get(key)?.slice() ?? null,
        write:(key,data) => { this.storage.set(key,data.slice()); return 0; }},
      audio:{sampleRate:48000, queued:() => Math.round(this.audioQueued),
        push:samples => this.pushAudio(samples.length), pushStereo:samples => this.pushAudio(Math.floor(samples.length/2))},
      gamepadRumble:() => {},
    };
  }
  private pushAudio(frames: number): number {
    const n = Math.min(frames,Math.max(0,Math.floor(14400 - this.audioQueued)));
    this.audioQueued += n; return n;
  }
  private identity(): string {
    return JSON.stringify({manifest:this.rt.manifest, suspension:this.rt.host?.config.suspensionMode,
      seed:this.rt.host?.config.seed,arg0:this.rt.host?.config.arg0,arg1:this.rt.host?.config.arg1});
  }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy || !this.rt.testQuiescent()) throw new Error('Savestate requires a paused quiescent update boundary');
    this.busy = true; this.rt.testCheckpointBusy = true;
    try { await this.rt.renderer!.finish(); return await fn(); }
    finally { this.busy = false; this.rt.testCheckpointBusy = false; }
  }
  snapshot(): Promise<Savestate> {
    return this.exclusive(async () => {
      const rt = this.rt, started = performance.now();
      if (this.journalError) throw new Error(this.journalError);
      if (rt.diagnostics().deviceResets) throw new Error('Savestates unsupported after graphics device loss');
      const host = rt.host!.checkpoint(), vfs = rt.vfs.checkpoint(), input = rt.input.checkpoint();
      const compact = await this.materialize();
      return {schema:'bgt-savestate/1',identity:this.identity(),backend:rt.renderer!.kind,
        width:rt.canvas.width,height:rt.canvas.height,host,vfs,input,
        gpuBase:structuredClone(this.gpuBase),stats:{...compact.stats,snapshotMs:performance.now()-started},
        services:structuredClone({ticks:this.ticks,rng:this.rng,audioQueued:this.audioQueued,storage:this.storage}),
        journal:structuredClone(this.journal)};
    });
  }
  private async materialize() {
    const temporary = await this.createRenderer();
    let compact: Awaited<ReturnType<typeof compactGPU>>;
    try {compact=await compactGPU(temporary,this.gpuBase,this.journal);}finally{temporary.destroy();}
    this.gpuBase=compact.base;this.journal=compact.journal;
    this.journalBytes=this.journal.reduce((n,f)=>n+JSON.stringify(f).length*2,0);
    return compact;
  }
  private async createRenderer(): Promise<Renderer & CheckpointRenderer> {
    const canvas=document.createElement('canvas');canvas.width=this.rt.canvas.width;canvas.height=this.rt.canvas.height;
    const renderer=this.rt.renderer!.kind==='webgl2' ? WebGL2Renderer.create(canvas,{debug:true}) : await WebGPURenderer.create(canvas,{debug:true});
    if(!renderer)throw new Error('Savestate renderer unavailable');return renderer;
  }
  restore(snapshot: Savestate): Promise<void> {
    return this.exclusive(async () => {
      // Clone before any await: caller mutation must not race validation or replay.
      const s = structuredClone(snapshot), rt = this.rt;
      if (s.schema !== 'bgt-savestate/1' || s.identity !== this.identity() || s.backend !== rt.renderer!.kind ||
        s.width !== rt.canvas.width || s.height !== rt.canvas.height) throw new Error('Incompatible savestate (artifact, mode, configuration, backend or canvas)');
      // Reject live JSPI continuation before allocating a replacement; never silently abandon a suspended task.
      rt.host!.assertCheckpointBoundary();
      let renderer: (Renderer & CheckpointRenderer) | null = null;
      try {
        renderer = await this.createRenderer();
        await replayGPU(renderer,s.gpuBase,s.journal);
        const host = await rt.testHostFactory!(renderer);
        host.restoreCheckpoint(s.host);
        rt.testReplace(host,renderer,s.input.letterbox); renderer = null;
        rt.vfs.restoreCheckpoint(s.vfs); rt.input.restoreCheckpoint(s.input);
        this.ticks = s.services.ticks; this.rng = s.services.rng; this.audioQueued = s.services.audioQueued;
        this.storage = s.services.storage; this.journal = s.journal; this.gpuBase = s.gpuBase;
        this.journalBytes = this.journal.reduce((n,f)=>n+JSON.stringify(f).length*2,0); this.journalError = null;
      } finally { renderer?.destroy(); }
    });
  }
}
