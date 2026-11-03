// Native opaque-default-screen boundary. Offscreen RGBA targets never use this helper.
export class WebGPUOpaqueScreen {
  private pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
  constructor(private device: GPUDevice) {}

  encode(encoder: GPUCommandEncoder, texture: GPUTexture): void {
    let pipeline = this.pipelines.get(texture.format);
    if (!pipeline) {
      const module = this.device.createShaderModule({ code: `
        @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
          var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);
        }
        @fragment fn fs()->@location(0) vec4f {return vec4f(0,0,0,1);}
      ` });
      pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: texture.format, writeMask: GPUColorWrite.ALPHA }] } });
      this.pipelines.set(texture.format, pipeline);
    }
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'load', storeOp: 'store' }] });
    pass.setPipeline(pipeline); pass.draw(3); pass.end();
  }
}
