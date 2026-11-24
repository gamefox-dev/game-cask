// Replay only: follow the bindings that determine explicit draw workspace.
// Charge native stores cumulatively until the next census, and CPU scratch by
// peak command (not by cumulative dead JS arrays). Cache/pool hits may be
// charged as misses; we do not estimate driver objects or deferred frees.
import { GPU_OP as O } from './abi';
import { feedbackLayout, feedbackVertexCount } from './feedback';
import { sizeClass } from '../renderers/webgpu/gpu';
import { VIEW_RING_BYTES, VIEW_RING_USABLE_SLOTS } from '../renderers/webgpu/view';
import { indexRingSize, sequenceCapacity } from '../renderers/webgpu/provoking';
import type { Renderer } from '../renderers/types';

const attrBytes = [4, 8, 12, 16, 4, 4, 8, 12, 16, 4, 8, 12, 16];
const round4 = (n: number) => Math.ceil(n / 4) * 4;
interface Layout {
  topology:number; vertexShader:number; fragmentShader:number;
  slots:{stride:number;step:boolean;repack:number}[];
  attrs:{slot:number;size:number}[];
  feedback?:number;
}

export class ReplayDrawAllocations {
  private glsl = new Set<number>();
  private pipelines = new Map<number,Layout>();
  private buffers = new Map<number,{bytes:number;generated:boolean}>();
  private bindings = new Map<number,number[]>();
  private pipeline?:Layout;
  private capture?:number[];
  private viewRing = false;
  private sequence = new Map<number,number>();
  private indexDemand = 0;
  private viewports = 0;
  native = 0;
  staging = 0;
  constructor(private kind:Renderer['kind']) {}

  restoreBuffers(buffers:readonly {handle:number;generated:boolean}[]):void {
    for(const {handle,generated} of buffers) {
      const b=this.buffers.get(handle);if(b)b.generated=generated;
    }
  }
  startFrame():void {
    this.native=this.staging=this.indexDemand=this.viewports=0;
    this.resetPass();
  }
  private resetPass():void {this.pipeline=this.capture=undefined;this.bindings.clear();}
  endFrame():number {
    // A new ring wastes less than the write that overflowed the previous one,
    // or is rounded up from that write. Cover both plus an initially empty ring.
    const rings=this.indexDemand?indexRingSize(0)+4*this.indexDemand:0;
    return this.native+this.staging+rings;
  }
  command(op:number,w:number[],source:unknown):void {
    const h=w[0], gpu=this.kind==='webgpu';
    switch(op) {
      case O.SHADER_CREATE: if(w[2])this.glsl.add(h);else this.glsl.delete(h);break;
      case O.SHADER_DELETE: this.glsl.delete(h);break;
      case O.BUFFER_CREATE: this.buffers.set(h,{bytes:w[2],generated:false});break;
      case O.BUFFER_DELETE: this.buffers.delete(h);break;
      case O.BUFFER_UPDATE: {
        const buffer=this.buffers.get(h);if(!buffer)break;
        const {bytes}=buffer, whole=!w[1]&&w[3]===bytes;
        if(!buffer.generated||whole) {
          // Assume a prior draw touched the updated range. Each rename can
          // take a fresh size-class buffer, including the 256-byte minimum.
          if(gpu&&bytes<=256*1024) {
            this.native+=sizeClass(bytes);this.staging=Math.max(this.staging,round4(bytes));
          } else if(!gpu&&!whole&&bytes<=32768)this.native+=bytes; // orphaned store
        }
        if(whole)buffer.generated=false;
        break;
      }
      case O.BUFFER_COPY: {
        const dst=this.buffers.get(w[2]);if(!dst)break;
        if(this.buffers.get(h)?.generated)dst.generated=true;
        else if(!w[3]&&w[4]===dst.bytes)dst.generated=false;
        break;
      }
      case O.PIPELINE_CREATE: {
        const slots:Layout['slots']=[], attrs:Layout['attrs']=[], unaligned=new Set<number>();
        const n=w[23], count=w[24];
        // Bound table walks even for invalid imported recordings.
        if(!Number.isInteger(n)||n<0||n>8||!Number.isInteger(count)||count<0||count>32||26+2*n+4*count>w.length)
          throw new Error('Invalid replay vertex layout');
        for(let j=0;j<n;j++)slots.push({stride:w[26+2*j],step:!!w[27+2*j],repack:0});
        for(let a=26+2*n,j=0;j<count;j++,a+=4) {
          const slot=w[a+1],size=attrBytes[w[a+3]];
          if(!slots[slot]||!size)throw new Error('Invalid replay vertex attribute');
          if(w[a+2]%4)unaligned.add(slot);
          attrs.push({slot,size});
        }
        for(const {slot,size} of attrs)if(unaligned.has(slot))slots[slot].repack+=size;
        this.pipelines.set(h,{topology:w[3],vertexShader:w[1],fragmentShader:w[2],slots,attrs});
        if(gpu&&this.glsl.has(w[1]))this.reserveViews();
        break;
      }
      case O.PIPELINE_DELETE: this.pipelines.delete(h);break;
      case O.FEEDBACK_VARYINGS: {
        const p=this.pipelines.get(h);
        if(p)p.feedback=feedbackLayout(String(source??''),!!w[1],w[2]).strides.reduce((a,b)=>a+b,0);
        break;
      }
      case O.PASS_BEGIN:case O.PASS_END: this.resetPass();break;
      case O.PIPELINE:this.pipeline=this.pipelines.get(h);break;
      case O.VERTEX_BUFFER:this.bindings.set(h,w);break;
      case O.FEEDBACK_CAPTURE:this.capture=w;break;
      case O.VIEWPORT:if(gpu)this.reserveViews(++this.viewports);break;
      case O.CLEAR_BUFFER:if(gpu&&(h&3)!==2)this.native+=16;break;
      case O.DRAW:case O.DRAW_INDEXED: {
        const capture=this.capture;this.capture=undefined;
        const p=this.pipeline;if(!p)break;
        const indexed=op===O.DRAW_INDEXED;
        if(gpu)this.webgpuDraw(p,w,indexed,capture);else this.webglDraw(p,w,indexed,!!capture);
        if(capture&&feedbackVertexCount(p.topology,h))for(let j=1;j<capture.length;j+=3){
          const dst=this.buffers.get(capture[j]);if(dst)dst.generated=true;
        }
        break;
      }
    }
  }
  private reserveViews(newTransforms=0):void {
    if(!this.viewRing){this.native+=VIEW_RING_BYTES;this.viewRing=true;}
    // The existing ring might have no room. Even unique viewports then need
    // at most this many additional rings. A re-applied viewport is cached.
    if(newTransforms&&newTransforms%VIEW_RING_USABLE_SLOTS===1)this.native+=VIEW_RING_BYTES;
  }
  private webgpuDraw(p:Layout,w:number[],indexed:boolean,capture?:number[]):void {
    const {topology,slots}=p, count=w[0];
    if(capture) {
      const total=feedbackVertexCount(topology,count)*w[1];
      if(total&&p.feedback) {
        const ids=indexed?4*count:0;
        const gather=slots.reduce((n,_,slot)=>n+round4(this.bindings.get(slot)?.[3]??0),ids);
        this.native+=sizeClass(gather)+sizeClass(total*p.feedback);
        this.staging=Math.max(this.staging,ids);
      }
      if(capture[0])return; // rasterizer discard
    }
    slots.forEach(({stride,repack},slot)=>{
      if(!repack)return;
      const binding=this.bindings.get(slot);if(!binding)return;
      const bytes=(stride?Math.ceil(binding[3]/stride):1)*repack;
      this.native+=bytes;this.staging=Math.max(this.staging,bytes);
    });
    if(topology===2||topology===4) {
      const bytes=4*feedbackVertexCount(topology,count);
      this.indexDemand+=bytes;this.staging=Math.max(this.staging,bytes);
    } else if((topology===1||topology===3)&&this.glsl.has(p.fragmentShader)) {
      // Flat GLSL inputs may rotate the provoking vertex. Conservatively
      // charge for the GLSL path without compiling the shader in preflight.
      const n=topology===1?2:3, primitives=Math.floor(count/n), bytes=4*primitives*n;
      if(!bytes)return;
      if(indexed) {this.indexDemand+=bytes;this.staging=Math.max(this.staging,2*bytes);}
      else if(w[2]>0x7fffffff) {this.native+=bytes;this.staging=Math.max(this.staging,2*bytes);}
      else if(primitives>(this.sequence.get(n)??0)) {
        const cap=sequenceCapacity(primitives), size=4*cap*n;
        this.sequence.set(n,cap);this.native+=size;this.staging=Math.max(this.staging,2*size);
      }
    }
  }
  private webglDraw(p:Layout,w:number[],indexed:boolean,capture:boolean):void {
    const count=w[0], strip=p.topology===2||p.topology===4;
    const remap=capture&&(indexed||strip)?feedbackVertexCount(p.topology,count):indexed?count:0;
    const padded=remap<=4096?remap:4096*Math.ceil(remap/4096);
    // Dense indices + optional ID texture + upload arrays (and feedback order).
    this.native+=4*(Number(indexed)*count+padded)+4;
    const cpu=4*(Number(indexed)*2*count+remap+padded)+(capture?8*remap:0);
    let attributeScratch=0;
    for(const {slot,size} of p.attrs) {
      const {stride,step}=p.slots[slot], binding=this.bindings.get(slot);
      if(!binding||!stride||(stride<=255&&(!remap||step)))continue;
      // Without reading the actual index store we cannot know the fetched
      // interval. The binding bounds it, even for very sparse native indices.
      const elements=step?w[1]:capture&&remap?remap:indexed?Math.ceil(binding[3]/stride):count;
      const bytes=elements*size;
      const buffer=this.buffers.get(binding[1]);
      this.native+=bytes;
      attributeScratch=Math.max(attributeScratch,bytes+(buffer?.generated?buffer.bytes:0));
    }
    this.staging=Math.max(this.staging,cpu+attributeScratch);
  }
}
