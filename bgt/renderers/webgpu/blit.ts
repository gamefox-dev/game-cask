// Ordered §13.10 framebuffer transfers. SPDX-License-Identifier: MIT
// Stencil is extracted from the *rendered* attachment by tests, never from a CPU upload shadow.
export interface BlitImage { texture: GPUTexture; mip: number; format: GPUTextureFormat; kind: number }
const vertex = `@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
 var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}`;
const coordinates = `struct Rects {s:vec4f,d:vec4f}; @group(0) @binding(1) var<uniform> r:Rects;
fn coord(p:vec2f)->vec2f {return r.s.xy+(p-r.d.xy)/(r.d.zw-r.d.xy)*(r.s.zw-r.s.xy);}
fn inside(p:vec2f,q:vec2f,size:vec2f)->bool {return all(p>=min(r.d.xy,r.d.zw))&&all(p<max(r.d.xy,r.d.zw))&&all(q>=vec2f(0))&&all(q<size);}`;
export class WebGPUBlit {
  private pipelines = new Map<string, GPURenderPipeline>();
  constructor(private device: GPUDevice) {}
  private pipeline(key: string, code: string, targets: GPUColorTargetState[], depthStencil?: GPUDepthStencilState): GPURenderPipeline {
    let p = this.pipelines.get(key);
    if (!p) {
      const module = this.device.createShaderModule({code: vertex + code});
      p = this.device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},
        fragment:{module,entryPoint:'fs',targets},depthStencil,primitive:{topology:'triangle-list'}});
      if (this.pipelines.size >= 128) this.pipelines.delete(this.pipelines.keys().next().value!);
      this.pipelines.set(key,p);
    }
    return p;
  }
  execute(w: readonly number[], source: BlitImage, dest: BlitImage): void {
    const d = this.device, e = d.createCommandEncoder(), garbage: (GPUTexture | GPUBuffer)[] = [];
    const size = (im: BlitImage) => [Math.max(1, im.texture.width >> im.mip),Math.max(1, im.texture.height >> im.mip)];
    const [sw,sh] = size(source), [dw,dh] = size(dest), rect = w.slice(4,12).map(n=>n|0), mask=w[12];
    if (!w[16] || !w[17] || rect[0]===rect[2] || rect[1]===rect[3] || rect[4]===rect[6] || rect[5]===rect[7]) return;
    const view = (im: BlitImage, aspect: GPUTextureAspect='all') => im.texture.createView({baseMipLevel:im.mip,mipLevelCount:1,aspect});
    // Copy only if formats, extents, orientation and clipping permit an exact native transfer.
    const x=rect[0],y=rect[1],dx=rect[4],dy=rect[5],width=rect[2]-x,height=rect[3]-y;
    const fullDepth = !(mask&6) || (x===0&&y===0&&dx===0&&dy===0&&width===sw&&height===sh&&sw===dw&&sh===dh&&mask=== (source.kind===5?6:2));
    if (source.texture!==dest.texture && source.format===dest.format && fullDepth && width>0&&height>0&&
      rect[6]-dx===width&&rect[7]-dy===height&&x>=0&&y>=0&&dx>=w[14]&&dy>=w[15]&&
      x+width<=sw&&y+height<=sh&&dx+width<=dw&&dy+height<=dh&&dx+width<=w[14]+w[16]&&dy+height<=w[15]+w[17]) {
      e.copyTextureToTexture({texture:source.texture,mipLevel:source.mip,origin:[x,y]},
        {texture:dest.texture,mipLevel:dest.mip,origin:[dx,dy]},[width,height]);
      d.queue.submit([e.finish()]);return;
    }
    if (source.texture===dest.texture) {
      const t=d.createTexture({size:[sw,sh],format:source.format,usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});
      e.copyTextureToTexture({texture:source.texture,mipLevel:source.mip},{texture:t},[sw,sh]);
      garbage.push(t);source={...source,texture:t,mip:0};
    }
    const uniform=d.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM,mappedAtCreation:true});
    new Float32Array(uniform.getMappedRange()).set(rect);uniform.unmap();garbage.push(uniform);
    const bind=(p:GPURenderPipeline,v:GPUTextureView)=>d.createBindGroup({layout:p.getBindGroupLayout(0),entries:[
      {binding:0,resource:v},{binding:1,resource:{buffer:uniform}}]});
    const render=(p:GPURenderPipeline,v:GPUTextureView,ref=0)=>{
      const depth: GPURenderPassDepthStencilAttachment={view:view(dest),depthLoadOp:'load',depthStoreOp:'store'};
      if(dest.kind===5)Object.assign(depth,{stencilLoadOp:'load',stencilStoreOp:'store'});
      const pass=e.beginRenderPass(mask&1?{colorAttachments:[{view:view(dest),loadOp:'load',storeOp:'store'}]}:
        {colorAttachments:[],depthStencilAttachment:depth});
      pass.setPipeline(p);pass.setBindGroup(0,bind(p,v));pass.setScissorRect(w[14],w[15],w[16],w[17]);
      pass.setStencilReference(ref);pass.draw(3);pass.end();
    };
    if(mask&3){
      const depth=!!(mask&2), type=depth?'f32':source.kind<13?'vec4f':source.kind&1?'vec4u':'vec4i';
      let load='textureLoad(src,vec2i(floor(q)),0)';
      if(w[13])load=`mix(mix(textureLoad(src,clamp(vec2i(floor(q-0.5)),vec2i(0),vec2i(size)-1),0),textureLoad(src,clamp(vec2i(floor(q-0.5))+vec2i(1,0),vec2i(0),vec2i(size)-1),0),fract(q.x-0.5)),mix(textureLoad(src,clamp(vec2i(floor(q-0.5))+vec2i(0,1),vec2i(0),vec2i(size)-1),0),textureLoad(src,clamp(vec2i(floor(q-0.5))+vec2i(1,1),vec2i(0),vec2i(size)-1),0),fract(q.x-0.5)),fract(q.y-0.5))`;
      const code=`@group(0) @binding(0) var src:${depth?'texture_depth_2d':`texture_2d<${type==='vec4f'?'f32':type==='vec4u'?'u32':'i32'}>`};${coordinates}
@fragment fn fs(@builtin(position) p:vec4f)->${depth?'@builtin(frag_depth)':'@location(0)'} ${type} {
 let q=coord(p.xy);let size=vec2f(textureDimensions(src));if(!inside(p.xy,q,size)){discard;}return ${load};}`;
      const pipe=this.pipeline(`${source.kind}:${dest.kind}:${w[13]}:main`,code,depth?[]:[{format:dest.format}],
        depth?{format:dest.format,depthWriteEnabled:true,depthCompare:'always',stencilWriteMask:0}:undefined);
      render(pipe,view(source,depth?'depth-only':'all'));
    }
    if(mask&4) for(let bit=1;bit<=128;bit<<=1){
      const plane=d.createTexture({size:[sw,sh],format:'r8uint',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});garbage.push(plane);
      const face:GPUStencilFaceState={compare:'equal',passOp:'keep'};
      const extract=this.pipeline(`extract:${bit}`,'@fragment fn fs()->@location(0) vec4u {return vec4u(1,0,0,1);}',[{format:'r8uint'}],
        {format:source.format,depthWriteEnabled:false,depthCompare:'always',stencilFront:face,stencilBack:face,stencilReadMask:bit,stencilWriteMask:0});
      const pass=e.beginRenderPass({colorAttachments:[{view:plane.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}],
        depthStencilAttachment:{view:view(source),depthReadOnly:true,stencilReadOnly:true}});
      pass.setPipeline(extract);pass.setStencilReference(bit);pass.draw(3);pass.end();
      for(const value of [0,1]){
        const code=`@group(0) @binding(0) var src:texture_2d<u32>;${coordinates}
@fragment fn fs(@builtin(position) p:vec4f){let q=coord(p.xy);if(!inside(p.xy,q,vec2f(textureDimensions(src)))){discard;}
if(textureLoad(src,vec2i(floor(q)),0).x!=${value}u){discard;}}`;
        const face:GPUStencilFaceState={compare:'always',passOp:'replace'};
        const p=this.pipeline(`insert:${bit}:${value}`,code,[],{format:dest.format,depthWriteEnabled:false,depthCompare:'always',
          stencilFront:face,stencilBack:face,stencilWriteMask:bit});
        render(p,plane.createView(),value?bit:0);
      }
    }
    d.queue.submit([e.finish()]);for(const obj of garbage)obj.destroy();
  }
}
