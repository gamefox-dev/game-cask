// Original CC0 post-link stress input. No game code, padding, or custom-section size inflation.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const leb = n => { const a=[]; do { let b=n%128;n=Math.floor(n/128);if(n)b|=128;a.push(b); } while(n); return Buffer.from(a); };
const vec = a => Buffer.concat([leb(a.length),...a]);
const str = s => {const b=Buffer.from(s);return Buffer.concat([leb(b.length),b]);};
const section = (id,b) => Buffer.concat([Buffer.from([id]),leb(b.length),b]);
const op = (...v) => Buffer.from(v);
const get = n => Buffer.concat([op(0x20),leb(n)]);
const set = n => Buffer.concat([op(0x21),leb(n)]);
const cn = n => {const a=[]; n|=0;for(;;){let b=n&127;n>>=7;const done=(n===0&&!(b&64))||(n===-1&&(b&64));a.push(b|(done?0:128));if(done)break;}return Buffer.from([0x41,...a]);};
const call = n => Buffer.concat([op(0x10),leb(n)]);
const body = (locals,ops) => {const b=Buffer.concat([locals?op(1,...leb(locals),0x7f):op(0),...ops,op(0x0b)]);return Buffer.concat([leb(b.length),b]);};
export function suspensionFixture({functions=10438,rounds=1400,locals=32}={}) {
 if(!Number.isInteger(functions)||functions<2||functions>100000||!Number.isInteger(rounds)||rounds<1||rounds>100000||!Number.isInteger(locals)||locals<1||locals>1000)throw new Error('invalid scale fixture dimensions');
 // import 0: yield; definitions 1..3: deep chain, then scale functions, run, buffer.
 const first=4,run=first+functions,buffer=run+1;
 const bodies=[body(0,[call(0)]),body(0,[call(1)]),body(0,[call(2)])];
 for(let i=0;i<functions;i++){
  const a=[];for(let l=1;l<=locals;l++)a.push(get(0),cn(l+i),op(0x73),set(l));
  for(let r=0;r<rounds;r++){
   const l=1+r%locals,next=1+(r+1)%locals;
   a.push(get(l),get(next),cn(13),op(0x76,0x73),cn((1664525+i*2)|0),op(0x6c),cn((r*127+i*7919)|0),op(0x6a),set(l));
   // Defined functions really can suspend, including through a table, and locals live across the call.
   if(r===Math.floor(rounds/2))a.push(call(3));
  }
  for(let l=1;l<=locals;l++)a.push(get(l),l===1?op():op(0x73));
  bodies.push(body(locals,a));
 }
 // run(frame): 35 consecutive owners/frame. All 10438 owners executed in 300 frames.
 // rolling checksum is also stored before/after each deep suspension.
 const a=[cn(0),set(1),cn(0),set(2),op(0x02,0x40,0x03,0x40),get(1),cn(35),op(0x4f,0x0d,1),get(0),cn(35),op(0x6c),get(1),op(0x6a),cn(functions),op(0x70),set(3),get(2),get(3),get(3),op(0x11,1,0,0x73),set(2),get(1),cn(1),op(0x6a),set(1),op(0x0c,0,0x0b,0x0b),get(2)];
 bodies.push(body(3,a),body(0,[cn(1024)]));
 const names=['deep0','deep1','deep2',...Array.from({length:functions},(_,i)=>'scale_'+i),'run','bgt_async_buffer'];
 const namePayload=Buffer.concat([str('name'),op(1),...(()=>{const b=vec(names.map((n,i)=>Buffer.concat([leb(i+1),str(n)])));return [leb(b.length),b];})()]);
 return Buffer.concat([Buffer.from([0,97,115,109,1,0,0,0]),
  section(1,vec([op(0x60,0,0),op(0x60,1,0x7f,1,0x7f),op(0x60,0,1,0x7f)])),
  section(2,vec([Buffer.concat([str('bgt'),str('yield'),op(0,0)])])),
  section(3,vec([...Array(3).fill(op(0)),...Array(functions).fill(op(1)),op(1),op(2)])),
  section(4,vec([Buffer.concat([op(0x70,0),leb(functions)])])),section(5,vec([op(0,2)])),
  section(7,vec([Buffer.concat([str('run'),op(0),leb(run)]),Buffer.concat([str('bgt_async_buffer'),op(0),leb(buffer)]),Buffer.concat([str('memory'),op(2,0)])])),
  section(9,vec([Buffer.concat([op(0,0x41,0,0x0b),vec(Array.from({length:functions},(_,i)=>leb(first+i)))])])),section(10,vec(bodies)),section(0,namePayload)]);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const bytes=suspensionFixture({functions:Number(process.argv[3]??10438),rounds:Number(process.argv[4]??1400)});writeFileSync(process.argv[2],bytes);console.log(bytes.length+' bytes');
}
