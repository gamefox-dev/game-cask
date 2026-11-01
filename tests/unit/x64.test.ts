// @bgt-examples: x64-basics x64-cpp x64-gui x64-tls
import {it,expect} from 'vitest';
import {loadHeadless,ROOT} from '../support/headless';
import {oracle} from '../oracle/oracle';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
// @ts-expect-error plain ESM
import {buildGame} from '../../tools/build/build.mjs';
// @ts-expect-error plain ESM
import {analyzePeMetadata} from '../../tools/x86/pe-metadata.mjs';
const fixtures=[['x64-basics','x64-basics result=PASS'],['x64-cpp','x64-cpp PASS caught=38 destructors=3 order=321'],['x64-tls','x64-tls PASS callbacks=1 jump=23'],['x64-gui','x64-gui PASS window']];
for(const [id,result] of fixtures)it(`${id}: known AMD64 results, zero interpretation, and 300-frame differential oracle`,async()=>{
 const h=await loadHeadless(id);await h.stepAsync(30);
 expect(h.logs.some((s)=>s.includes(result)),h.logs.join('\n')).toBe(true);
 const m=h.host.metrics() as any;expect(m.interp_insns).toBe(0);expect(m.stubs).toEqual([]);
 if(id==='x64-cpp')expect(h.logs.some((s)=>s.includes('x64-cpp rethrow=PASS caught=6 destructors=3 order=345'))).toBe(true);
 if(id==='x64-cpp')expect(m.apis_hit).toEqual(expect.arrayContaining(['RaiseException','RtlUnwindEx','RtlLookupFunctionEntry']));
 if(id==='x64-tls')expect(m.apis_hit).toEqual(expect.arrayContaining(['__intrinsic_setjmpex','longjmp','RtlVirtualUnwind']));
 const exe=join(ROOT,'node_modules/.cache/bgt/pipeline',id,'fixture',id==='x64-basics'?'basics.exe':id==='x64-cpp'?'cpp.exe':id==='x64-tls'?'tls.exe':'gui.exe');
 const pe=analyzePeMetadata(exe);expect(BigInt(pe.imageBase)).toBeGreaterThan(0xffffffffn);expect(pe.directories[5][1]).toBeGreaterThan(0);expect(pe.runtimeFunctions.length).toBeGreaterThan(0);
 if(id==='x64-tls')expect(pe.directories[9][0]).toBeGreaterThan(0);
 buildGame(`examples/${id}`,{interpretOnly:true,quiet:true});
 const r=await oracle(id,300);expect(r.frames).toBe(300);expect(r.identical).toBe(true);expect(r.errors).toEqual({lifted:null,interpreted:null});
 expect((r.metrics.lifted as any).interp_insns).toBe(0);expect((r.metrics.interpreted as any).interp_insns).toBeGreaterThan(0);
 const manifest=JSON.parse(readFileSync(join(ROOT,'web/public/games',id,'manifest.json'),'utf8'));
 expect(manifest.pipeline.metrics.lifted_insns).toBeGreaterThan(0);expect(manifest.pipeline.modules[0].functions).toBeGreaterThan(0);
 expect(manifest.pipeline.metrics.wasm_bytes_per_insn).toBeGreaterThan(0);expect(manifest.pipeline.metrics.build_ms).toBeGreaterThan(0);
},120_000);
