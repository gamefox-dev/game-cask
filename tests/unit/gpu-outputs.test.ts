// SPDX-License-Identifier: CC0-1.0. Original synthetic interfaces.
import {it,expect} from 'vitest';
import {fragmentOutputs} from '../../bgt/renderers/webgpu/outputs';
import {translateGLSL} from '../../bgt/renderers/webgpu/shaders';
it('reflects the fragment return, not vertex outputs, fragment inputs, helpers or comments',()=>{
 const wgsl=`struct V { @builtin(position) p:vec4f, @location(0) v:vec4f }; struct F { @location(1) a:vec4f, @location(3u) b:vec4f };
 @vertex fn vs_main()->V {return V();} fn helper()->@location(2) vec4f{return vec4f();}
 // @location(9) not an output
 @fragment fn fs_main(@location(0) v:vec4f,@builtin(position) p:vec4f)->F{return F();}`;
 expect([...fragmentOutputs(wgsl)]).toEqual([1,3]);
 expect([...fragmentOutputs('@fragment fn fs_main(@location(0) p:vec4f) {}')]).toEqual([]);
 expect([...fragmentOutputs('@fragment fn fs_main()->@builtin(frag_depth) f32{return 0.;}')]).toEqual([]);
 expect([...fragmentOutputs('@fragment fn fs_main()->@location(0x2) vec4f{return vec4f();}')]).toEqual([2]);
 expect([...fragmentOutputs('struct F{@location(3) c:vec4f};alias A=F;alias B=A;@fragment fn fs_main()->B{return B();}')]).toEqual([3]);
 expect([...fragmentOutputs('const IDX:u32=2u;@fragment fn fs_main()->@location(IDX) vec4f{return vec4f();}')]).toEqual([2]);
});
it.each([1,2])('uses actual translated GLSL output locations (%s)',language=>{
 const version=language===1?'#version 330 core':'#version 300 es\nprecision highp float;';
 const code=translateGLSL(version+'\nlayout(location=1) out vec4 a;layout(location=3) out vec4 b;void main(){a=vec4(1);b=vec4(0);}',2,language);
 expect([...fragmentOutputs(code)]).toEqual([1,3]);
});
it('resolves case-sensitive module constants, never local helper shadows',()=>{
 const prelude='const loc:u32=0u;fn helper(){const LOC:u32=3u;}const LOC:u32=1u;';
 expect([...fragmentOutputs(prelude+'@fragment fn fs_main()->@location(LOC) vec4f{return vec4f();}')]).toEqual([1]);
 expect([...fragmentOutputs(prelude+'struct F{@location(LOC) c:vec4f};@fragment fn fs_main()->F{return F();}')]).toEqual([1]);
 expect(()=>fragmentOutputs('fn helper(){const LOCAL=3u;}@fragment fn fs_main()->@location(LOCAL) vec4f{}')).toThrow('location requires');
});
it('ignores nested WGSL comments containing a decoy entry point and constants',()=>{
 const source='/* outer /* nested */ fn fs_main()->@location(0) vec4f{} const LOC=0u; */ const LOC=1u;@fragment fn fs_main()->@location(LOC) vec4f{return vec4f();}';
 expect([...fragmentOutputs(source)]).toEqual([1]);
 expect(()=>fragmentOutputs('/* unclosed /* nested */')).toThrow('unterminated');
});
it('fails closed on unknown interfaces',()=>{
 expect(()=>fragmentOutputs('')).toThrow('missing fs_main');
 expect(()=>fragmentOutputs('fn fs_main()->@location(1+2) vec4f{}')).toThrow('location requires');
 expect(()=>fragmentOutputs('fn fs_main()->Missing{}')).toThrow('missing return structure');
 expect(()=>fragmentOutputs('alias A=B;alias B=A;fn fs_main()->A{}')).toThrow('cyclic');
});
