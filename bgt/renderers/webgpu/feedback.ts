// Vertex -> compute lowering for §13.11. Invoke the canonical vertex function, never interpret GLSL on CPU.
import { glslName } from './shaders';
import { canonicalVertexType, vertexFormatScalar, vertexFormatWidth } from '../vertex-input';
import type { FeedbackLayout } from '../../runtime/feedback';
import { feedbackVertexCount } from '../../runtime/feedback';
export interface FeedbackInput { location:number; format:number; stride:number; step:number; offset:number }
const width=vertexFormatWidth;
const type=(f:number)=>{const n=width(f),s=f<5?'f':f<9?'i':'u';return n===1?({f:'f32',i:'i32',u:'u32'}[s]):`vec${n}${s}`;};
/** Packed input contains whole vertex buffer ranges, followed by optional u32 vertex IDs. */
export function lowerFeedback(code:string, layout:FeedbackLayout, inputs:FeedbackInput[], topology:number,
 count:number, instances:number, first:number, firstInstance:number, indexWord:number|undefined, base:number):string {
  const vertices=feedbackVertexCount(topology,count), total=vertices*instances;
  const inStruct=/struct bgt_internal_Input\s*\{([\s\S]*?)\};/.exec(code);
  const outStruct=/struct bgt_internal_Output\s*\{([\s\S]*?)\};/.exec(code);
  if(!inStruct||!outStruct)throw new Error('Feedback requires canonical vertex IO');
  const assignments:string[]=[];
  for(const m of inStruct[1].matchAll(/@location\((\d+)\)\s*(?:@interpolate\([^)]*\)\s*)?(\w+)\s*:\s*([^,\n]+)/g)) {
    const a=inputs.find(a=>a.location===+m[1]);if(!a)throw new Error(`Missing feedback input ${m[2]}`);
    const shaderType=canonicalVertexType(m[3]);
    if(!shaderType || shaderType.scalar!==vertexFormatScalar(a.format))throw new Error(`Feedback input type mismatch ${m[2]}`);
    const at=`(${a.offset}u + ${a.step?'instance':'vertex'} * ${a.stride}u)`;
    const values=Array.from({length:shaderType.width},(_,c)=>c>=width(a.format)?
      `${c===3?1:0}${shaderType.scalar==='f32'?'.0':shaderType.scalar==='i32'?'i':'u'}`:a.format===4?
      `(f32((bgt_internal_tf_in[(${at}+${c}u)/4u] >> (((${at}+${c}u)%4u)*8u)) & 255u) / 255.0)`:
      `${a.format<4?'bitcast<f32>':a.format<9?'bitcast<i32>':'u32'}(bgt_internal_tf_in[${at}/4u+${c}u])`);
    assignments.push(`v.${m[2]}=${m[3].trim()}(${values.join(',')});`);
  }
  if(/@builtin\(vertex_index\)/.test(inStruct[1]))assignments.push('v.bgt_vertex_index=vertex;');
  if(/@builtin\(instance_index\)/.test(inStruct[1]))assignments.push('v.bgt_instance_index=instance;');
  const writes:string[]=[];let fieldOffset=0,bufferOffset=0;
  layout.varyings.forEach((v,i)=>{
    const name=glslName(v.name);
    if(!new RegExp(`\\b${name}\\s*:\\s*${type(v.format)}\\b`).test(outStruct[1]))
      throw new Error(`Feedback output type mismatch ${v.name}`);
    const stride=layout.strides[layout.separate?i:0]/4;
    if(layout.separate)fieldOffset=0;
    for(let c=0;c<v.components;c++)writes.push(`bgt_internal_tf_out[${bufferOffset+fieldOffset+c}u+ordinal_id*${stride}u]=${v.format>=9?'u32':'bitcast<u32>'}(o.${name}${v.components===1?'':'.'+'xyzw'[c]});`);
    fieldOffset+=v.components;
    if(layout.separate)bufferOffset+=stride*total;
  });
  const index=indexWord===undefined?`${first}u+ordinal`:`u32(i32(bgt_internal_tf_in[${indexWord}u+ordinal])+${base}i)`;
  // Strip assembly is deterministic, including the odd triangle's winding.
  const ordinal=topology===2?'(local/2u+local%2u)':topology===4?
    '(local/3u + select(select(local%3u,1u-local%3u,local%3u<2u),local%3u,(local/3u)%2u==0u))':'local';
  code=code.replace(/@vertex\s+/g,'').replace(/@(?:location|builtin|interpolate)\([^)]*\)\s*/g,'');
  return `${code}\n@group(2) @binding(0) var<storage,read> bgt_internal_tf_in:array<u32>;
@group(2) @binding(1) var<storage,read_write> bgt_internal_tf_out:array<u32>;
@compute @workgroup_size(64) fn bgt_internal_capture(@builtin(global_invocation_id) id:vec3u) {
 let ordinal_id=id.x+id.y*4194240u;
 if(ordinal_id>=${total}u){return;} let local=ordinal_id%${Math.max(1,vertices)}u;let ordinal=${ordinal};
 let vertex=${index};let instance=${firstInstance}u+ordinal_id/${Math.max(1,vertices)}u;
 var v:bgt_internal_Input;${assignments.join('\n')}
 let o=vs_main(v);${writes.join('\n')}
}`;
}
