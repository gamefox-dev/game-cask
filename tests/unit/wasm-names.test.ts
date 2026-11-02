import {it,expect} from 'vitest';
// @ts-expect-error ESM build helper
import {functionNames,stripDwarf,encodeFunctionNames} from '../../tools/build/wasm-names.mjs';
const str=(s:string)=>Buffer.concat([Buffer.from([Buffer.byteLength(s)]),Buffer.from(s)]);
const custom=(name:string,data:Buffer)=>{const body=Buffer.concat([str(name),data]);return Buffer.concat([Buffer.from([0,body.length]),body]);};
it('retains indexed function names while removing only DWARF custom sections',()=>{
 const names=Buffer.concat([Buffer.from([2,4]),str('F_01001000'),Buffer.from([7]),str('R_01001000_01001000')]);
 const name=custom('name',Buffer.concat([Buffer.from([1,names.length]),names]));
 const header=Buffer.from([0,97,115,109,1,0,0,0]);
 const binary=Buffer.concat([header,custom('.debug_info',Buffer.from([1,2,3])),name,custom('target_features',Buffer.from([0]))]);
 const result=stripDwarf(binary);
 expect(result.includes(Buffer.from('.debug_info'))).toBe(false);expect(result.includes(Buffer.from('target_features'))).toBe(true);
 expect(functionNames(binary)).toEqual([{index:4,name:'F_01001000'},{index:7,name:'R_01001000_01001000'}]);
 expect(functionNames(result)).toEqual(functionNames(binary));
 expect(functionNames(Buffer.concat([header,encodeFunctionNames([{index:4,name:'F_01001000'},{index:70000,name:'helper'}])]))).toEqual([{index:4,name:'F_01001000'},{index:70000,name:'helper'}]);
 expect(()=>functionNames(binary.subarray(0,binary.length-1))).toThrow(/truncated/);
 expect(()=>stripDwarf(binary.subarray(0,binary.length-1))).toThrow(/truncated/);
});
