// Native TF output preservation, separate from the raster GLSL translator.
import { translateShader } from './shaders';
import type { FeedbackLayout } from '../../runtime/feedback';
/** noperspective raster lowering forwards value*w. Feedback must capture the original value, not that proxy. */
export function feedbackShader(source:string,language:number,layout:FeedbackLayout):{source:string;names:string[];specialized:boolean} {
  let native=translateShader(source,1,language);
  const clean=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,' ');
  const linear=new Map([...clean.matchAll(/\bnoperspective\s+out\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*;/g)].map(m=>[m[2],m[1]]));
  const declarations:string[]=[],assignments:string[]=[];
  const names=layout.varyings.map((v,i)=>{
    const type=linear.get(v.name);if(!type)return v.name;
    const name=`bgt_internal_tf_raw_${i}`;
    declarations.push(`out highp ${type} ${name};`);assignments.push(`${name}=${v.name};`);return name;
  });
  if(declarations.length){
    native=native.replace('#version 300 es\n',`#version 300 es\n${declarations.join('\n')}\n`);
    const needle='void main() {\n  bgt_internal_main();';
    if(!native.includes(needle))throw new Error('Cannot preserve native feedback outputs');
    native=native.replace(needle,needle+'\n'+assignments.join('\n'));
  }
  return {source:native,names,specialized:declarations.length>0};
}
