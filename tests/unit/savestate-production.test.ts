// Regression for vK42b: exercise actual Vite production env replacement, not forced defines.
import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';

it('real flag-off production bytes are independent of the entire savestate implementation',()=>{
  // Vitest's NODE_ENV=test makes Vite treat even build() as DEV. A fresh Node process
  // with the ordinary production environment exercises the shipped multi-entry config
  // without Vitest transforms or define overrides (which masked optional-chain leakage).
  const script = `
    import {build} from 'vite';
    const bundles=[];
    for(const remove of [false,true]) {
      const result=await build({configFile:'vite.config.ts',publicDir:false,logLevel:'silent',
        plugins:remove?[{name:'remove-savestate-implementation',enforce:'pre',load(id){
          const name=id.split('/').at(-1);
          if(name.startsWith('savestate')&&name.endsWith('.ts'))return 'export class Savestates {} export function exportSavestate() {} export function importSavestate() {} export function instrumentCheckpointWasm() {}';
        }}]:[],build:{write:false}});
      bundles.push(result.output.filter(o=>o.type==='chunk').map(o=>({fileName:o.fileName,code:o.code})).sort((a,b)=>a.fileName.localeCompare(b.fileName)));
    }
    console.log(JSON.stringify(bundles));
  `;
  const [present,removed]=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{
    cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',VITE_BGT_TEST:''},encoding:'utf8',maxBuffer:4*1024*1024,
  })) as {fileName:string;code:string}[][];
  console.log('K42 real production JavaScript bytes:',present.reduce((n,c)=>n+Buffer.byteLength(c.code),0));
  expect(present.map(c=>c.code).join('')).not.toMatch(/bgt_checkpoint_|bgt-savestate|Savestate|scriptedOnly|guestNow|testHarness|captureTestSurfaces|restoreTestSurfaces|testCheckpointBusy/);
  expect(present.map(c=>c.fileName).join('')).not.toContain('savestate');
  expect(present).toEqual(removed);
});
