// SPDX-License-Identifier: CC0-1.0
// Original known-answer sampler helper contracts, not captured shaders.
export interface OpaqueRegression { name: string; globals: string; helpers: string; body: string; expected: number[]; slots: number[]; zeroFallthrough?: boolean; fragmentOnly?: boolean; webglOnly?: boolean }
export const opaqueRegressions: OpaqueRegression[] = [
  // WGSL's pre-existing local-struct boundary is not expanded by opaque specialization.
  { name: 'webgl-ordinary-local-struct-field', globals: '', slots: [], expected: [64, 128, 191, 255], fragmentOnly: true, webglOnly: true,
    helpers: 'vec4 read(){struct S{float bgt_t0;};S q=S(0.5);return vec4(0.25,q.bgt_t0,0.75,1.0);}', body: 'o=read();' },
  { name: 'webgl-helper-local-struct-field', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255], fragmentOnly: true, webglOnly: true,
    helpers: 'vec4 read(sampler2D s){struct S{float bgt_t0;};S q=S(1.0);return texture(s,vec2(0.5))*q.bgt_t0;}',
    body: 'vec4 a=read(bgt_t0);o=vec4(a.r,a.b*128.0/191.0,a.b,1.0);' },
  { name: 'webgl-helper-anonymous-struct-field', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255], fragmentOnly: true, webglOnly: true,
    helpers: 'vec4 read(sampler2D s){struct {float bgt_t0;float s;}q;q.bgt_t0=1.0;q.s=1.0;return texture(s,vec2(0.5))*q.bgt_t0*q.s;}',
    body: 'vec4 a=read(bgt_t0);o=vec4(a.r,a.b*128.0/191.0,a.b,1.0);' },
  { name: 'webgl-ordinary-anonymous-struct-field', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255], fragmentOnly: true, webglOnly: true,
    helpers: 'float value(){struct {float bgt_t0;float s;}q;q.bgt_t0=1.0;q.s=1.0;return q.bgt_t0*q.s;}vec4 read(sampler2D s){return texture(s,vec2(0.5))*value();}',
    body: 'vec4 a=read(bgt_t0);o=vec4(a.r,a.b*128.0/191.0,a.b,1.0);' },
  { name: 'webgl-local-struct-type-shadow-without-helper', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255], fragmentOnly: true, webglOnly: true,
    helpers: '', body: 'vec4 a=texture(bgt_t0,vec2(0.5));{struct S{float x;};S bgt_t0=S(1.0);a*=bgt_t0.x;}o=vec4(a.r,a.b*128.0/191.0,a.b,1.0);' },
  { name: 'webgl-ordinary-inline-value-struct', globals: '', slots: [], expected: [64, 128, 191, 255], fragmentOnly: true, webglOnly: true,
    helpers: 'struct S{float x;}v;S read(S a){return a;}', body: 'v.x=0.5;o=vec4(0.25,read(v).x,0.75,1.0);' },
  { name: 'discard-in-nonvoid-sampler-helper', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255], fragmentOnly: true,
    helpers: 'vec4 read(sampler2D s,bool k){if(k){discard;}else{return texture(s,vec2(0.5));}}',
    body: 'vec4 a=read(bgt_t0,false);o=vec4(a.r,a.b*128.0/191.0,a.b,1.0);' },
  { name: 'nonvoid-fallthrough-defined-branches-and-side-effects', globals: '', slots: [], expected: [64, 128, 191, 255], zeroFallthrough: true,
    helpers: `int calls=0; vec3 choose(int n){calls++;if(n==1)return vec3(0.25,0.5,0.75);else if(n==2){return vec3(0.75,0.25,0.5);}}`,
    body: 'vec3 a=choose(1);vec3 b=choose(2);vec3 unused=choose(3);o=vec4(a.r,b.b,a.b,calls==3?1.0:0.0);' },
  { name: 'hygienic-numeric-parameter-and-local-bindings', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255],
    helpers: `vec4 read(sampler2D s,float bgt_t0){return texture(s,vec2(0.5))*bgt_t0;}
      vec4 relay(sampler2D s){float bgt_t0=1.0;return read(s,bgt_t0);}`,
    body: 'vec4 a=relay(bgt_t0);o=vec4(a.r,a.b*128.0/191.0,a.b,1.0);' },
  { name: 'nested-shadow-and-loop-scope', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255],
    helpers: `float read(float x){return x;} vec4 read(sampler2D s){float x=0.0;
      {float s=0.25;x=read(s);}for(int s=0;s<2;s++){x+=read(float(s));}
      vec4 v=texture(s,vec2(0.5));if(x!=1.25)return vec4(0.0);return v;}`,
    body: 'vec4 a=read(bgt_t0);o=vec4(a.r,a.b*128.0/191.0,a.b,1.0);' },
  { name: 'implicit-if-while-and-else-local-scopes', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255],
    helpers: `vec4 read(sampler2D s){while(false)float s=0.25;if(false)float s=0.5;
      vec4 v=vec4(0.0);if(false)float s=0.75;else v=texture(s,vec2(0.5));return v;}`,
    body: 'vec4 a=read(bgt_t0);o=vec4(a.r,a.b*128.0/191.0,a.b,1.0);' },
  { name: 'zero-argument-numeric-overload', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255],
    helpers: `float read(){return 0.5;} vec4 read(sampler2D s){return texture(s,vec2(read()));}`,
    body: 'vec4 a=read(bgt_t0);o=vec4(a.r,read(),a.b,1.0);' },
  { name: 'constant-array-numeric-parameter', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255],
    helpers: `const int N=2; vec4 read(sampler2D s,float a[N]){return texture(s,vec2(a[0],a[1]));}`,
    body: 'float uv[2]=float[2](0.5,0.5);vec4 a=read(bgt_t0,uv);o=vec4(a.r,a.b*128.0/191.0,a.b,1.0);' },
  { name: 'numeric-copy-in-out-next-to-opaque-argument', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255],
    helpers: `vec4 read(sampler2D s,inout float n,out float k){n+=0.25;k=0.75;return texture(s,vec2(0.5));}`,
    body: 'float n=0.25;float k;vec4 a=read(bgt_t0,n,k);o=vec4(a.r,n,k,1.0);' },
  { name: 'forward-two-distinct-bindings', globals: 'uniform sampler2D bgt_t0; uniform sampler2D bgt_t1;', slots: [0, 1], expected: [64, 128, 191, 255],
    helpers: `vec4 leaf(const in highp sampler2D s, vec2 uv){return texture(s,uv);}
      vec4 relay(vec2 uv,in sampler2D s){return leaf(s,uv);}`,
    body: `vec4 a=relay(vec2(0.5),bgt_t0); vec4 b=relay(vec2(0.5),bgt_t1); o=vec4(a.r,b.g,a.b,1.0);` },
  { name: 'two-sampler-parameters-and-order', globals: 'uniform sampler2D bgt_t0; uniform sampler2D bgt_t1;', slots: [0, 1], expected: [64, 128, 191, 255],
    helpers: `int calls=0; vec2 once(){calls++;return vec2(0.5);}
      vec4 readPair(sampler2D a,vec2 uv,sampler2D b){vec4 x=texture(a,uv);vec4 y=texture(b,uv);return vec4(x.r,y.g,x.b,1.0);}
      vec4 passPair(sampler2D a,sampler2D b){return readPair(a,once(),b);}`,
    body: 'o=passPair(bgt_t0,bgt_t1); if(calls!=1)o=vec4(0.0);' },
  { name: 'sampler-type-overloads-3d-array', globals: 'uniform sampler3D bgt_t2; uniform sampler2DArray bgt_t3;', slots: [2, 3], expected: [64, 128, 191, 255],
    helpers: `vec4 read(in sampler3D s,vec3 p){return texture(s,p);}
      vec4 read(in sampler2DArray s,vec3 p){return texture(s,p);}
      vec4 relay(sampler3D s){return read(s,vec3(0.5));}
      vec4 relay(sampler2DArray s){return read(s,vec3(0.5,0.5,1.0));}`,
    body: 'vec4 a=relay(bgt_t2);vec4 b=relay(bgt_t3);o=vec4(a.r,b.g,a.b,b.a);' },
  { name: 'numeric-overloads-and-prototypes', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255],
    helpers: `vec4 read(sampler2D s,int k); vec4 read(sampler2D s,float k);
      vec4 read(sampler2D s,int k){return texture(s,vec2(float(k)*0.5));}
      vec4 read(sampler2D s,float k){return texture(s,vec2(k));}`,
    body: 'vec4 a=read(bgt_t0,1);vec4 b=read(bgt_t0,0.5);o=vec4(a.r,b.b*128.0/191.0,a.b,1.0);' },
  { name: 'shadow-forwarding-and-two-comparisons', globals: 'uniform sampler2DShadow bgt_t4;', slots: [4], expected: [64, 128, 191, 255],
    helpers: `float compare(in sampler2DShadow s,float ref){return texture(s,vec3(0.5,0.5,ref));}
      float relay(sampler2DShadow s,float ref){return compare(s,ref);}`,
    body: 'float yes=relay(bgt_t4,0.25);float no=relay(bgt_t4,0.75);o=vec4(yes*0.25,yes*0.5,yes*0.75,1.0-no);' },
  { name: 'signed-unsigned-forwarding-overloads', globals: 'uniform isampler2D bgt_t5; uniform usampler2D bgt_t6;', slots: [5, 6], expected: [64, 128, 191, 255],
    helpers: `ivec4 read(isampler2D s){return texture(s,vec2(0.5));}
      uvec4 read(usampler2D s){return texelFetch(s,ivec2(0),0);}
      ivec4 relay(isampler2D s){return read(s);} uvec4 relay(usampler2D s){return read(s);}`,
    body: 'bool ok=relay(bgt_t5).r == -16777217 && relay(bgt_t6).r == 0xfedcba98u;o=ok?vec4(0.25,0.5,0.75,1.0):vec4(0.0);' },
  { name: 'lod-grad-size-fetch-through-helper', globals: 'uniform sampler2D bgt_t0;', slots: [0], expected: [64, 128, 191, 255],
    helpers: `vec4 read(sampler2D s){ivec2 n=textureSize(s,0);vec4 a=textureLod(s,vec2(0.5),0.0);
      vec4 b=textureGrad(s,vec2(0.5),vec2(0.0),vec2(0.0)); vec4 c=texelFetch(s,n-ivec2(1),0);return vec4(a.r,b.b*128.0/191.0,c.b,1.0);}`,
    body: 'o=read(bgt_t0);' },
  { name: 'sampler-only-argument-removal', globals: 'uniform sampler2D bgt_t0; uniform sampler2D bgt_t1;', slots: [0, 1], expected: [64, 128, 191, 255],
    helpers: `vec4 read(sampler2D s){return texture(s,vec2(0.5));} vec4 pass(sampler2D s){return read(s);}`,
    body: 'vec4 a=pass((bgt_t0));vec4 b=pass(bgt_t1);o=vec4(a.r,b.g,a.b,1.0);' },
];
export function opaqueFragment(c: OpaqueRegression): string {
  return c.globals + '\nlayout(location=0) out vec4 o;\n' + c.helpers + '\nvoid main(){' + c.body + '}';
}
export const opaqueVertex = 'void main(){vec2 p[3]=vec2[3](vec2(-1.0,-1.0),vec2(3.0,-1.0),vec2(-1.0,3.0));gl_Position=vec4(p[bgt_vertex_index],0.5,1.0);}';
