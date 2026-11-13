import {describe,expect,it} from 'vitest';
import {jspiUnavailableReason,testSuspensionModes} from '../support/suspension-modes';
import {suspensionCapabilities} from '../../bgt/runtime/jspi';

const wasm={url:'game.wasm',size:1,sha256:'0'.repeat(64)};
describe('explicit JSPI test capabilities',()=>{
 for(const supported of [false,true])for(const variantPresent of [false,true]){
  it('supported='+supported+' variant='+variantPresent,()=>{
   const capability={supported,variantPresent};
   if(supported&&variantPresent){
    expect(jspiUnavailableReason(capability,false)).toBeNull();
    expect(jspiUnavailableReason(capability,true)).toBeNull();
   }else{
    const reason=jspiUnavailableReason(capability,false)!;
    expect(reason.includes('browser')).toBe(!supported);
    expect(reason.includes('artifact')).toBe(!variantPresent);
    expect(()=>jspiUnavailableReason(capability,true)).toThrow(/required by BGT_TEST_JSPI/);
   }
  });
 }
 it('recognizes dual and JSPI-only manifests without mistaking Asyncify for JSPI',()=>{
  expect(suspensionCapabilities({wasm},'jspi',true)).toEqual({requested:'jspi',supported:true,variantPresent:false});
  expect(suspensionCapabilities({wasm,variants:{jspi:wasm}},'jspi',false)).toEqual({requested:'jspi',supported:false,variantPresent:true});
  expect(suspensionCapabilities({wasm,suspension:'jspi'},undefined,true)).toEqual({requested:'jspi',supported:true,variantPresent:true});
  expect(suspensionCapabilities({wasm,preferredSuspension:'jspi'},undefined,true).requested).toBe('jspi');
  expect(suspensionCapabilities({wasm,preferredSuspension:'jspi'},'asyncify',true).requested).toBe('asyncify');
 });
 it('retains the Node optional/required browser-API convention',()=>{
  expect(testSuspensionModes(false,false)).toEqual(['asyncify']);
  expect(testSuspensionModes(true,true)).toEqual(['asyncify','jspi']);
  expect(()=>testSuspensionModes(false,true)).toThrow(/required by BGT_TEST_JSPI/);
 });
});
