// GL 3.3 §4.3.2 stencil transfer fallback; never uses upload shadows. SPDX-License-Identifier: MIT
export function blitStencil(g: WebGL2RenderingContext, source: WebGLTexture, sw: number, sh: number,
  destination: WebGLTexture, dw: number, dh: number, w: readonly number[],
  framebufferStatus = (target: number) => g.checkFramebufferStatus(target)): void {
  const sf=g.createFramebuffer()!,df=g.createFramebuffer()!,plane=g.createTexture()!,vao=g.createVertexArray()!;
  const programs:WebGLProgram[]=[],shaders:WebGLShader[]=[];
  const program=(body:string)=>{
    const p=g.createProgram()!;programs.push(p);
    for(const [stage,code] of [[g.VERTEX_SHADER,`#version 300 es
void main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));gl_Position=vec4(p[gl_VertexID],0,1);}`],
      [g.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;precision highp int;'+body]] as const){
      const s=g.createShader(stage)!;shaders.push(s);g.shaderSource(s,code);g.compileShader(s);
      if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw new Error(g.getShaderInfoLog(s)??'Stencil blit shader failed');g.attachShader(p,s);
    }
    g.linkProgram(p);if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error(g.getProgramInfoLog(p)??'Stencil blit link failed');return p;
  };
  try {
    g.bindVertexArray(vao);g.disable(g.CULL_FACE);g.disable(g.DEPTH_TEST);g.disable(g.BLEND);g.enable(g.STENCIL_TEST);g.depthMask(false);
    g.activeTexture(g.TEXTURE0);g.bindSampler(0,null);g.bindTexture(g.TEXTURE_2D,plane);g.texStorage2D(g.TEXTURE_2D,1,g.R8,sw,sh);
    g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.NEAREST);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.NEAREST);
    g.bindFramebuffer(g.FRAMEBUFFER,sf);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,plane,0);
    g.framebufferTexture2D(g.FRAMEBUFFER,g.DEPTH_STENCIL_ATTACHMENT,g.TEXTURE_2D,source,w[1]);g.drawBuffers([g.COLOR_ATTACHMENT0]);g.readBuffer(g.COLOR_ATTACHMENT0);
    if(framebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('Stencil source incomplete');
    g.bindFramebuffer(g.FRAMEBUFFER,df);g.framebufferTexture2D(g.FRAMEBUFFER,g.DEPTH_STENCIL_ATTACHMENT,g.TEXTURE_2D,destination,w[3]);g.drawBuffers([g.NONE]);g.readBuffer(g.NONE);
    if(framebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw new Error('Stencil destination incomplete');
    const extract=program('layout(location=0)out vec4 c;void main(){c=vec4(1,0,0,1);}');
    const insert=program(`uniform sampler2D plane;uniform vec4 srcRect;uniform vec4 dstRect;uniform int value;
void main(){vec2 p=gl_FragCoord.xy,q=srcRect.xy+(p-dstRect.xy)/(dstRect.zw-dstRect.xy)*(srcRect.zw-srcRect.xy);
if(any(lessThan(p,min(dstRect.xy,dstRect.zw)))||any(greaterThanEqual(p,max(dstRect.xy,dstRect.zw)))||any(lessThan(q,vec2(0)))||any(greaterThanEqual(q,vec2(textureSize(plane,0)))))discard;
if(int(texelFetch(plane,ivec2(floor(q)),0).r+0.5)!=value)discard;}`);
    g.useProgram(insert);g.uniform1i(g.getUniformLocation(insert,'plane'),0);
    g.uniform4fv(g.getUniformLocation(insert,'srcRect'),w.slice(4,8).map(v=>v|0));g.uniform4fv(g.getUniformLocation(insert,'dstRect'),w.slice(8,12).map(v=>v|0));
    for(let bit=1;bit<=128;bit<<=1){
      g.bindFramebuffer(g.FRAMEBUFFER,sf);g.viewport(0,0,sw,sh);g.disable(g.SCISSOR_TEST);g.colorMask(true,true,true,true);
      g.clearBufferfv(g.COLOR,0,[0,0,0,0]);g.stencilMask(0);g.stencilOp(g.KEEP,g.KEEP,g.KEEP);g.stencilFunc(g.EQUAL,bit,bit);
      g.useProgram(extract);g.bindTexture(g.TEXTURE_2D,null);g.drawArrays(g.TRIANGLES,0,3);
      g.bindFramebuffer(g.FRAMEBUFFER,df);g.viewport(0,0,dw,dh);g.enable(g.SCISSOR_TEST);g.scissor(w[14],w[15],w[16],w[17]);
      g.useProgram(insert);g.bindTexture(g.TEXTURE_2D,plane);g.stencilMask(bit);g.stencilOp(g.KEEP,g.KEEP,g.REPLACE);
      for(const value of [0,1]){g.stencilFunc(g.ALWAYS,value?bit:0,255);g.uniform1i(g.getUniformLocation(insert,'value'),value);g.drawArrays(g.TRIANGLES,0,3);}
    }
  } finally {
    g.bindFramebuffer(g.FRAMEBUFFER,null);g.bindVertexArray(null);g.deleteFramebuffer(sf);g.deleteFramebuffer(df);g.deleteTexture(plane);g.deleteVertexArray(vao);
    programs.forEach(p=>g.deleteProgram(p));shaders.forEach(s=>g.deleteShader(s));g.disable(g.STENCIL_TEST);g.stencilMask(255);g.depthMask(true);
  }
}
