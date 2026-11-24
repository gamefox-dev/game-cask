// Test-only deterministic checkpoint controller. Installed before boot, never in normal play.
import { DT_US, GPU_OP } from './abi';
import {cloneCheckpoint} from './savestate-clone';
import {validateSavestate} from './savestate-validation';
import type { GameHost, HostServices } from './host';
import type { BGTRuntime } from './runtime';
import {recordCheckpointFrame,checkpointFrameBytes,recordsMutation,type CheckpointFrame} from './savestate-recording';
import {trackCheckpointHost} from './savestate-host';
import './savestate-runtime';
import '../renderers/savestate-surfaces';
import { GPUReadbackFailure, LiveGPUCut, ReplayCursor, compactGPU, replayGPU, type GPUCheckpoint } from './savestate-gpu';
import { GPUByteLimit, checkGPUBytes, checkpointGPUBytes, GPU_HISTORY_BYTES, GPU_CAPTURE_BUDGET, type GPUCaptureBudget } from './savestate-budget';
import type { CheckpointRenderer } from '../renderers/checkpoint-surfaces';
import { WebGL2Renderer } from '../renderers/webgl2/webgl2';
import { WebGPURenderer } from '../renderers/webgpu/webgpu';
import type { Renderer } from '../renderers/types';

const ROLL_FRAMES=128, ROLL_BYTES=128*1024**2, ROLL_COMMANDS=50_000;
const MAX_GPU_HISTORY={frames:2*ROLL_FRAMES,bytes:GPU_HISTORY_BYTES,commands:4*ROLL_COMMANDS};
const historyBytes=(journal:CheckpointFrame[])=>journal.reduce((n,f)=>n+checkpointFrameBytes(f),0);

export interface Savestate {
  schema: 'bgt-savestate/1'; identity: string; backend: 'webgl2' | 'webgpu'; width: number; height: number;
  host: ReturnType<GameHost['checkpoint']>;
  vfs: ReturnType<BGTRuntime['vfs']['checkpoint']>;
  input: ReturnType<BGTRuntime['input']['checkpoint']>;
  services: {ticks: number; rng: number; audioQueued: number; audioTimeUs: number; storage: Map<string, Uint8Array>};
  journal: CheckpointFrame[]; gpuBase: GPUCheckpoint | null;
  stats: {nativeBytes:number;residualCommands:number;residualUpdates:number;snapshotMs:number;
    wasmMs?:number;hostMs?:number;gpuMs?:number;replayFrames?:number;replayMs?:number;
    provenanceMs?:number;readbackMs?:number;readbackBytes?:number;cloneMs?:number};
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
  private baseBytes = 0;
  private journalError: string | null = null;
  private recovery?: LiveGPUCut;
  private incoming?: {frame:CheckpointFrame;bytes:number;admitted:boolean};
  private recoveryWait?: {frames:number;readback?:GPUReadbackFailure;retriedWrite?:boolean};
  private journalCommands = 0;
  private retryAt = 0;
  private compactions = 0;
  private compactionMs = 0;
  private lastRollFailure = '';
  private pendingShaders = new Set<Record<string,unknown>>();
  private executions = new WeakMap<object,Record<string,unknown>>();
  private wrappedRenderer: Renderer | null = null;

  constructor(private readonly rt: BGTRuntime, seed: number, private readonly gpuBudget:GPUCaptureBudget=GPU_CAPTURE_BUDGET) {
    if (rt.ready || rt.host) throw new Error('Deterministic mode must be enabled before boot');
    this.rng = (seed >>> 0) || 1;
    rt.testHarness = {
      services: s => this.services(s),
      trackHost: trackCheckpointHost,
      updated: () => { this.ticks++; this.drainAudio(); },
      afterFrame: () => this.rollJournal(),

      frame: (...args) => {
        if (this.journalError&&!this.recovery) return;
        const frame = recordCheckpointFrame(...args), bytes = checkpointFrameBytes(frame);
        if (this.retainedBytes()+bytes>this.gpuBudget.retained)this.releaseReplay();
        const admitted=!this.journalError&&this.fits(this.journalBytes+bytes,this.journal.length+1,this.journalCommands+frame.items.length);
        this.incoming={frame,bytes,admitted};
        if(admitted){this.journal.push(frame);this.journalBytes+=bytes;this.journalCommands+=frame.items.length;}
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
            if(item.op===GPU_OP.SHADER_CREATE)this.pendingShaders.add(recorded);
            const complete=item.complete;item.complete=(code,log)=>{
              recorded.completeCode=code;this.pendingShaders.delete(recorded);complete(code,log);
            };
          }
        }
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
      let wasmMs=0;
      const host = rt.host!.checkpoint(ms=>{wasmMs=ms;}), vfs = rt.vfs.checkpoint(), input = rt.input.checkpoint();
      const hostMs=performance.now()-started, compact=await this.materialize(true), gpuMs=performance.now()-started-hostMs;
      const cloneAt=performance.now(),{gpuBase,journal}=cloneCheckpoint({gpuBase:this.gpuBase,journal:this.journal});
      const services=cloneCheckpoint({ticks:this.ticks,rng:this.rng,audioQueued:this.audioQueued,audioTimeUs:this.audioTimeUs,storage:this.storage});
      return {schema:'bgt-savestate/1',identity:this.identity(),backend:rt.renderer!.kind,
        width:rt.canvas.width,height:rt.canvas.height,host,vfs,input,gpuBase,services,journal,
        stats:{...compact.stats,wasmMs,hostMs,gpuMs,cloneMs:performance.now()-cloneAt,snapshotMs:performance.now()-started}};
    },()=>this.assertBoundary());
  }
  private assertBoundary():void {
    this.rt.host!.assertCheckpointBoundary();
    if(this.pendingShaders.size)throw new Error('Checkpoint has pending GPU shader completions');
  }
  compactJournal(): Promise<void> { return this.exclusive(async()=>{ await this.materialize(); }); }
  private retainedBytes() { return this.baseBytes+this.journalBytes+this.replayBytes+(this.recovery?.bytes()??0); }
  private fits(bytes:number,frames:number,commands:number):boolean {
    return bytes<=MAX_GPU_HISTORY.bytes&&this.baseBytes+bytes<=this.gpuBudget.retained&&
      frames<=MAX_GPU_HISTORY.frames&&commands<=MAX_GPU_HISTORY.commands;
  }
  private disableJournal(frame:CheckpointFrame,failure:string):void {
    this.journalError = 'Savestate GPU journal exceeded bounded history without a safe cut; restore an earlier checkpoint or wait for a live cut'+
      (failure?': '+failure:'');
    try {
      const recovery=new LiveGPUCut(this.gpuBase,[...this.journal,frame]);
      this.recovery=recovery.bytes()<=this.gpuBudget.retained?recovery:undefined;
    } catch {this.recovery=undefined;}
    this.recoveryWait=undefined;
    this.journal=[];this.baseBytes=this.journalBytes=this.journalCommands=0;this.gpuBase=null;this.releaseReplay();
  }
  journalStats() {return {bytes:this.journalBytes,frames:this.journal.length,limit:MAX_GPU_HISTORY.bytes,
    retainedBytes:this.retainedBytes(),retainedLimit:this.gpuBudget.retained,
    error:this.journalError,compactions:this.compactions,compactionMs:this.compactionMs};}
  private async rollJournal() {
    // An over-cap record is held only for the current render. The renderer has
    // consumed it now, so a clear/delete in this frame can make a cut possible.
    // Hold the update handoff while trying the cut; never publish an over-cap
    // history or discard provenance before trying an available in-budget cut.
    const incoming=this.incoming;this.incoming=undefined;
    if(!incoming)return;
    const {frame,bytes,admitted}=incoming;
    if(this.journalError){await this.recoverLive(frame);return;}
    const overflow=!admitted;
    const due=this.journal.length>=ROLL_FRAMES||this.journalBytes>=ROLL_BYTES||this.journalCommands>=ROLL_COMMANDS||
      this.baseBytes+this.journalBytes+bytes>this.gpuBudget.retained;
    if(!overflow&&(!due||this.journal.length<this.retryAt))return;
    if(this.pendingShaders.size||this.rt.renderer!.lost||this.rt['deviceResets']) {
      if(overflow)this.disableJournal(frame,this.lastRollFailure||'renderer or shader results not ready');
      return;
    }
    const started=performance.now();
    try {
      await this.materialize(false,overflow?incoming:undefined);
      this.compactions++;
    } catch(e) {
      this.lastRollFailure=String(e);
      if(overflow){
        this.disableJournal(frame,this.lastRollFailure);
        if(e instanceof GPUReadbackFailure&&e.live)this.recoveryWait={frames:31,readback:e};
      } else this.retryAt=Math.min(MAX_GPU_HISTORY.frames,this.journal.length+32);
    } finally { this.compactionMs+=performance.now()-started; }
  }
  private async recoverLive(frame:CheckpointFrame):Promise<void> {
    const recovery=this.recovery;
    if(!recovery)return;
    try {
      recovery.append(frame);
      if(recovery.bytes()>this.gpuBudget.retained){this.recovery=undefined;return;}
    } catch {this.recovery=undefined;return;}
    const live=this.rt.renderer as Renderer & CheckpointRenderer;
    if(this.pendingShaders.size||live.lost||this.rt['deviceResets'])return;
    const wait=this.recoveryWait;
    let retryingWrite=false;
    if(wait?.frames) {
      wait.frames--;
      const changed=wait.readback?.op!==undefined?wait.readback.changed(frame):
        frame.items.some(i=>i.kind==='texDelete'||i.op===GPU_OP.BUFFER_DELETE||i.op===GPU_OP.TEXTURE_DELETE)?'delete':undefined;
      // A targeted write gets one early retry per window. If the guest keeps
      // rendering non-finite values to the same target, don't read every frame.
      retryingWrite=changed==='write'&&!wait.retriedWrite;
      if(changed!=='delete'&&!retryingWrite)return;
    }
    this.recoveryWait=undefined;
    const started=performance.now();
    try {
      const compact=await recovery.capture(live,frame,(base,staging)=>{
        checkGPUBytes(base,this.gpuBudget.retained,'retained history');
        checkGPUBytes(this.retainedBytes()+checkpointFrameBytes(frame)+base+staging,this.gpuBudget.workspace,'capture workspace');
      });
      if(live.lost||live!==this.rt.renderer||this.rt['deviceResets'])return;
      this.gpuBase=compact.base;this.baseBytes=checkpointGPUBytes(this.gpuBase);
      this.recovery=undefined;this.journalError=null;this.retryAt=0;this.lastRollFailure='';
      this.compactions++;
    } catch(e) {
      // Provenance refusals never read back; the next packed clear can make
      // them safe. Throttle only budget refusals and actual readback failures.
      if(e instanceof GPUByteLimit)this.recoveryWait={frames:31};
      if(e instanceof GPUReadbackFailure)this.recoveryWait=retryingWrite
        ?{frames:wait!.frames,readback:e,retriedWrite:true}:{frames:31,readback:e};
    } finally {this.compactionMs+=performance.now()-started;}
  }
  private async materialize(forSnapshot=false,overflow?:{frame:CheckpointFrame;bytes:number}) {
    const journal=overflow?[...this.journal,overflow.frame]:this.journal;
    const journalBytes=this.journalBytes+(overflow?.bytes??0);
    if(this.journalError)throw new Error(this.journalError);
    if(this.pendingShaders.size)throw new Error('Checkpoint has pending GPU shader completions');
    const live=this.rt.renderer as Renderer & CheckpointRenderer;
    const usable=()=>{
      if(live.lost||live!==this.rt.renderer||this.rt['deviceResets'])throw new Error('Savestates unsupported after graphics device loss');
      const last=journal.at(-1)??this.gpuBase?.frame;
      if(last&&(last.width!==live.canvas.width||last.height!==live.canvas.height))throw new Error('Savestate requires a consumed frame after canvas resize');
    };
    usable();
    let compact: Awaited<ReturnType<typeof compactGPU>>;
    let retainCursor=true;
    const workspace=(next:number)=>checkGPUBytes(this.baseBytes+journalBytes+next,this.gpuBudget.workspace,'capture workspace');
    if(forSnapshot&&!journal.length)workspace(this.baseBytes+this.replayBytes);
    try {
      workspace(0); // even a live cut overlaps the consumed input history
      compact=await compactGPU(async()=>{
        if(this.replay?.renderer.lost)this.releaseReplay();
        if(this.replay)return {cursor:this.replay,atBase:true};
        const cursor=this.replay=new ReplayCursor(await this.createRenderer());
        return {cursor,atBase:false};
      },this.gpuBase,journal,live,(base,staging,residual,keepReplay)=>{
        const cursor=this.replay?.bytes()??0;
        workspace(cursor+base+staging); // previous base + whole input journal still owned
        if(!base)return; // intermediate replay allocation (no candidate base yet)
        const residualBytes=historyBytes(residual),next=base+residualBytes;
        checkGPUBytes(next,this.gpuBudget.retained,'retained history');
        if(residual.length>MAX_GPU_HISTORY.frames||residualBytes>MAX_GPU_HISTORY.bytes||
            residual.reduce((n,f)=>n+f.items.length,0)>MAX_GPU_HISTORY.commands)throw new GPUByteLimit('Savestate residual exceeds bounded GPU history');
        retainCursor=keepReplay&&next+cursor<=this.gpuBudget.retained;
        if(forSnapshot)checkGPUBytes(2*next+(retainCursor?cursor:0),this.gpuBudget.workspace,'capture workspace');
      },()=>this.releaseReplay());
      usable();
      if(this.replay?.renderer.lost)throw new Error('Savestate replay renderer lost');
    } catch(e){this.releaseReplay();throw e;}
    if(!compact.keepReplay||!retainCursor)this.releaseReplay();
    this.replayBytes=this.replay?.bytes()??0;
    this.gpuBase=compact.base;this.journal=compact.journal;
    this.retryAt=0;this.lastRollFailure='';
    this.baseBytes=checkpointGPUBytes(this.gpuBase);
    this.journalBytes=historyBytes(this.journal);
    this.journalCommands=this.journal.reduce((n,f)=>n+f.items.length,0);
    return compact;
  }
  // The cursor is at the *start* of the residual, just like gpuBase. Advance
  // it on the next roll instead of re-uploading the entire compact base.
  private replay?: ReplayCursor;
  private replayBytes=0;
  private releaseReplay():void {
    if(this.replay){this.replay.replay.stop();this.park(this.replay.renderer);}
    this.replay=undefined;this.replayBytes=0;
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
    let s:Savestate, original:Renderer|null, resets:number, baseBytes:number, journalBytes:number, journalCommands:number;
    return this.exclusive(async () => {
      const rt = this.rt;
      // All fallible preparation precedes the commit. These detached plain records are
      // assigned synchronously after testReplace; no clone, validation or guest work follows it.
      const vfs=cloneCheckpoint(s.vfs),input=cloneCheckpoint(s.input),services=s.services;
      let renderer: (Renderer & CheckpointRenderer) | null = null;
      try {
        this.releaseReplay();
        renderer = await this.createRenderer();
        await replayGPU(renderer,s.gpuBase,s.journal,bytes=>checkGPUBytes(this.retainedBytes()+baseBytes+journalBytes+bytes,this.gpuBudget.workspace,'restore workspace'));
        const {abiVersion,ioPtr}=s.host.data;
        const host = await rt.testHostFactory!(renderer,{abiVersion,ioPtr,memoryBytes:s.host.wasm.memory.byteLength});
        host.restoreCheckpoint(s.host);
        if(renderer.lost||rt.renderer!==original||rt.renderer!.lost||rt['deviceResets']!==resets)
          throw new Error('Savestate restore interrupted by graphics device loss');
        const previous = rt.renderer!;
        rt.testReplace(host,renderer,input.letterbox); renderer = null;
        if (previous.kind === 'webgl2') this.scratch = previous.canvas; // destroyed by testReplace: the next temporary
        Object.assign(rt.vfs,vfs);Object.assign(rt.input,input);
        this.ticks = services.ticks; this.rng = services.rng; this.audioQueued = services.audioQueued; this.audioTimeUs = services.audioTimeUs;
        this.storage = services.storage; this.journal = s.journal; this.gpuBase = s.gpuBase;
        this.baseBytes = baseBytes; this.journalBytes = journalBytes; this.journalError = null; this.retryAt=0; this.lastRollFailure='';
        this.recovery=undefined;this.incoming=undefined;this.recoveryWait=undefined;
        this.journalCommands=journalCommands;this.pendingShaders.clear();
      } finally { if (renderer) this.park(renderer); }
    }, () => {
      // Reject before cloning or allocating anything if JSPI still owns a continuation.
      this.assertBoundary();
      const rt=this.rt;
      if (snapshot.schema !== 'bgt-savestate/1' || snapshot.identity !== this.identity() || snapshot.backend !== rt.renderer!.kind ||
        snapshot.width !== rt.canvas.width || snapshot.height !== rt.canvas.height) throw new Error('Incompatible savestate (artifact, mode, configuration, backend or canvas)');
      validateSavestate(snapshot);
      original=rt.renderer;resets=rt['deviceResets'];
      baseBytes=checkpointGPUBytes(snapshot.gpuBase);journalBytes=historyBytes(snapshot.journal);
      journalCommands=snapshot.journal.reduce((n,f)=>n+f.items.length,0);
      if(journalBytes>MAX_GPU_HISTORY.bytes||journalCommands>MAX_GPU_HISTORY.commands||snapshot.journal.length>MAX_GPU_HISTORY.frames)
        throw new Error('Restored savestate exceeds bounded GPU history');
      checkGPUBytes(baseBytes+journalBytes,this.gpuBudget.retained,'retained history');
      checkGPUBytes(this.retainedBytes()+baseBytes+journalBytes,this.gpuBudget.workspace,'restore workspace');
      // Capture synchronously, before even finish() can yield to caller mutation.
      s = cloneCheckpoint(snapshot);
    });
  }
}
