// @bgt-examples: none
// Original CC0. Detect lost task identity, parked wall counted as running, wrong
// wait reason, post-update snapshots, reset loss and silent ring eviction.
import {it,expect} from 'vitest';
import {cpSync,mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from '../support/headless';
import {GameHost} from '../../bgt/runtime/host';
import {Vfs} from '../../bgt/runtime/vfs';
import {instructionSummary} from '../../bgt/runtime/instruction-accounting';
// @ts-expect-error plain ESM
import {buildGame} from '../../tools/build/build.mjs';
type Ex={account_setup():void;account_api(op:number,a:number,b:number):bigint;account_schedule():number;
 account_work():void;account_io(begin:number):void;account_present():void;account_exit():void;
 account_idle(begin:number):void;account_tick(frame:number):void;bgt_profile_reset():void};
for(const wide of [false,true])it('scheduler-owned exact waits, work, presents and drops '+(wide?'AMD64':'i386'),async()=>{
 const root=join(ROOT,'node_modules/.cache/bgt/scheduler-accounting');mkdirSync(root,{recursive:true});
 const dir=mkdtempSync(join(root,'case-')),out=join(dir,'out'),id='scheduler-account-'+Number(wide);
 try {
  writeFileSync(join(dir,'entry.c'),'/* CC0 */ int _tls_index,value; int *volatile pointer=&value; void entry(void) {*pointer=1;}');
  cpSync(join(ROOT,'tests/fixtures/c/scheduler-accounting.c'),join(dir,'controls.c'));
  writeFileSync(join(dir,'game.json'),JSON.stringify({id,name:'CC0 scheduler accounting',sources:['controls.c'],
   cflags:['-DX86_ACCOUNTING_ENABLED=1','-DX86_PROFILE_ENABLED=1'],pipeline:{platform:'win32',streamModules:false,
    fixture:{out:'entry.exe',sources:['entry.c'],target:wide?'x86_64-windows-gnu':'x86-windows-gnu'},modules:[{from:'./build/entry.exe',main:true}]}}));
  const manifest=buildGame(dir,{outRoot:out,quiet:true});const game=join(out,id),vfs=new Vfs();
  for(const a of manifest.assets)vfs.add(a.path,new Uint8Array(readFileSync(join(game,'assets',a.path))));
  let us=0;
  const host=await GameHost.create(readFileSync(join(game,'game.wasm')),{vfs,now:()=>us/1000,log:()=>{}},
   {backend:3,caps:0,seed:1,displayWidth:64,displayHeight:64,arg0:0,arg1:0});
  host.init();const ex=(host as unknown as {exports:Ex}).exports;ex.account_setup();
  const api=(op:number,a=0,b=0)=>ex.account_api(op,a,b);
  us=10;const worker=Number(api(0));expect(worker).toBeGreaterThan(0);
  us=20;ex.account_work();us=100;ex.account_present();
  const first=(host.metrics() as any).execution_accounting;
  expect(first.retired.total).toBe('3');expect(first.frames.snapshots[0].retired.total).toBe('3');
  expect(first.threads.map((t:any)=>t.id)).toEqual([1,2]);expect(first.threads[1].start_address).toBe(0x1000);
  us=110;api(1,10);us=120;expect(ex.account_schedule()).toBe(2);
  us=150;ex.account_work();us=160;const event=Number(api(2));
  us=170;api(3,event,0xffffffff);us=180;ex.account_tick(1);expect(ex.account_schedule()).toBe(1);
  us=200;expect(api(4,event)).toBe(1n);
  us=210;api(7);us=220;expect(ex.account_schedule()).toBe(2);
  us=230;expect(api(5,worker)).toBe(0n); // suspend self via its real handle
  us=240;expect(api(6,worker)).toBe(1n);
  // Resuming the current task is ready until selected again; select via the real scheduler.
  expect(ex.account_schedule()).toBe(1);expect(ex.account_schedule()).toBe(2);
  us=250;ex.account_io(1);us=270;ex.account_io(0);
  us=280;ex.account_idle(1);us=380;ex.account_idle(0);
  us=400;ex.account_exit();us=410;expect(ex.account_schedule()).toBe(1);
  us=420;ex.account_present();
  const m=host.metrics() as any,a=m.execution_accounting;
  expect(a.retired.total).toBe('6');expect(a.cpu_time_us).toBeNull();
  expect(a.threads.map((t:any)=>t.retired.total)).toEqual(['3','3']);
  expect(a.threads[0]).toMatchObject({state:'running',sleep_requested_ms:10,switches_in:3,wall_us:{running:160,ready:190,sleep_timer:70}});
  expect(a.threads[1]).toMatchObject({state:'exited',infinite_waits:1,parked_host_us:100,switches_in:3,
   wall_us:{running:100,ready:130,wait_objects:30,io:20,host_yield:100,suspended:10}});
  const s=instructionSummary(m);expect(s.instructions_per_guest_frame).toBe(3);
  expect(s.frames?.intervals).toHaveLength(1);expect(s.frames?.intervals[0].retired.total).toBe('3');
  expect(s.frames?.intervals[0].threads?.map(t=>t.instructions)).toEqual([0,3]);
  expect(s.frames?.intervals[0]).toMatchObject({wall_us:320,active_wall_us:160,executing_instructions_per_second:18750});
  expect(a.threads[0].virtual_ms.sleep_timer).toBe(16);
  for(let i=0;i<70;i++){us+=10;ex.account_work();ex.account_present();if(i===34)ex.bgt_profile_reset();}
  ex.account_work(); // This tail MUST NOT leak into the last native present.
  const last=(host.metrics() as any).execution_accounting;
  expect(last.retired.total).toBe('219');expect(last.frames.dropped).toBe(8);
  expect(last.frames.snapshots).toHaveLength(64);expect(last.frames.snapshots[0].present).toBe(9);
  expect(last.frames.snapshots.at(-1)).toMatchObject({present:72,retired:{total:'216'}});
  expect(instructionSummary(host.metrics() as any).instructions_per_guest_frame).toBe(3);
 } finally {rmSync(dir,{recursive:true,force:true});}
},600000);
