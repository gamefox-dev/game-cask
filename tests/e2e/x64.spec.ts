import {test,expect,openGame,assertBackend,step,diagnostics,input,stateHash,readPixels,attachScreenshot,catches} from './fixtures';
import { hardwarePixels } from './fixtures';
const fixtures=[['x64-basics','x64-basics result=PASS'],['x64-cpp','x64-cpp PASS caught=38 destructors=3 order=321'],['x64-tls','x64-tls PASS callbacks=1 jump=23'],['x64-gui','x64-gui PASS window']];
for(const [id,result] of fixtures)test(`${id}: AMD64 binary executes known results fully lifted`,async({page,backendParam,collector},info)=>{
 catches(`AMD64 ${id} wrong result, missing TLS/exception destructor, ABI error, or interpreter fallback`);collector.allow(/guest:/);
 const logs:string[]=[];page.on('console',(m)=>logs.push(m.text()));
 expect(await openGame(page,backendParam,{game:id})).toBe('ready');await assertBackend(page,backendParam,info);await step(page,30);
 expect(logs.some((s)=>s.includes(result)),logs.join('\n')).toBe(true);
 const d=await diagnostics(page);expect(d.errors).toEqual([]);expect(d.commandErrors.count).toBe(0);
 expect((d.metrics as any).interp_insns).toBe(0);expect((d.metrics as any).stubs).toEqual([]);
 if(id==='x64-cpp')expect(logs.some((s)=>s.includes('x64-cpp rethrow=PASS caught=6 destructors=3 order=345'))).toBe(true);
 if(id==='x64-gui'){
   const px=await readPixels(page),scale=d.letterbox.w/d.logical.width;
   const at=(x:number,y:number)=>{const o=(Math.floor(d.letterbox.y+(y+.5)*scale)*px.width+Math.floor(d.letterbox.x+(x+.5)*scale))*4;return [...px.data.subarray(o,o+3)];};
   if(hardwarePixels()){expect(at(30,70)).toEqual([40,220,90]);expect(at(80,70)).toEqual([20,30,50]);}
   const before=await stateHash(page);
   await input(page,[{type:'pointer',x:30,y:70,buttons:1}]);await step(page,1);await input(page,[{type:'pointer',x:30,y:70,buttons:0}]);await step(page,2);
   expect(await stateHash(page)).not.toBe(before);expect(logs.some((s)=>s.includes('x64-gui clicks=1'))).toBe(true);
   await input(page,[{type:'key',code:'ArrowRight',down:true}]);await step(page,1);await input(page,[{type:'key',code:'ArrowRight',down:false}]);await step(page,2);
   expect(logs.some((s)=>s.includes('x64-gui clicks=2'))).toBe(true);
   const moved=await readPixels(page),x=Math.floor(d.letterbox.x+30.5*scale),y=Math.floor(d.letterbox.y+70.5*scale);
   if(hardwarePixels())expect([...moved.data.subarray((y*moved.width+x)*4,(y*moved.width+x)*4+3)]).toEqual([20,30,50]);
   await attachScreenshot(page,info,'x64-gui-input.png');
 }
});
