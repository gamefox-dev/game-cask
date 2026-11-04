// Original CC0-1.0. Real profile, counting transport; pixels are separately tested in Chromium.
import {afterAll,beforeAll,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT} from '../support/headless';
let dir:string,exe:string;
beforeAll(()=>{
 dir=mkdtempSync(join(tmpdir(),'bgt-gl-scale-'));exe=join(dir,'driver');
 execFileSync(process.env.CC??'cc',['-std=c11','-O1','-Wall','-Wextra','-Werror','-DW32_GL_DEMAND_COUNT=24000u','-ffunction-sections','-fdata-sections',process.platform==='darwin'?'-Wl,-dead_strip':'-Wl,--gc-sections',
 '-I',join(ROOT,'bgt/include'),'-I',join(ROOT,'platforms/x86'),'-I',join(ROOT,'platforms/win32'),join(ROOT,'tests/native/gl_frontend_driver.c'),'-o',exe],{stdio:'pipe'});
},30000);
afterAll(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});
it('24,000 live buffers/stores and VAOs are uncensored with the negotiated capability',()=>{
 const output=execFileSync(exe,['demand'],{encoding:'utf8',timeout:120000});
 expect(output).toContain('requested=24000 buffers=24000 stores=24000 vaos=24000');
 const metrics=JSON.parse(output.match(/metrics=(.*)/)![1]);
 for(const kind of ['buffers','vaos'])expect(metrics[kind]).toEqual({live:24000,peak:24000,failures:0,failed_requests:0});
},120000);
it('growth/churn, full names, retained generations, atomic real host-memory OOM and recovery',()=>{
 const output=execFileSync(exe,['scale-churn'],{encoding:'utf8',timeout:120000});
 expect(output).toContain('scale churn=4 count=24000 atomic/retained/host-OOM/recovery OK');
},120000);
