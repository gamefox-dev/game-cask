// Original CC0-1.0. Compiler source attribution, not a unique causal instruction-cost model.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const [dir,decoder]=process.argv.slice(2);
const decoded=JSON.parse(execFileSync(decoder,[dir+'/workload.exe'],{encoding:'utf8',maxBuffer:16*1024*1024}));
const byAddr=new Map(decoded.map(x=>[x.address,x]));
const form=x=>{const name=x.text.split(' ')[0];return name+'_'+x.operands.map(p=>({1:'r',2:'m',3:'i'}[p.kind]??'x')+(p.size*8)).join('_');};
const c=readFileSync(dir+'/debug/lifted.c','utf8').split(String.fromCharCode(10)),lines=new Map();let addr=null;
for(let n=0;n<c.length;n++){
 const label=c[n].match(/^(?:L|N)_([0-9a-f]+):/);if(label)addr=parseInt(label[1],16);
 if(/^(?:boundary:|memory_fault:|generic:|quantum:|static |void |dispatch:|switch)/.test(c[n]))addr=null;
 if(addr!==null&&byAddr.has(addr)&&!label&&!/^(?:if\(budget|if\(x86_protection_active|case |default:)/.test(c[n]))lines.set(n+1,addr);
}
const dump=execFileSync('/Library/Developer/CommandLineTools/usr/bin/llvm-dwarfdump',['--debug-info','--debug-line',dir+'/debug/debug.wasm'],{encoding:'utf8',maxBuffer:256*1024*1024});
const inlines=[];
for(const block of dump.split(/(?=0x[0-9a-f]+:)/)){
 if(!block.includes('DW_TAG_inlined_subroutine')||!block.match(/DW_AT_call_file\s+\("[^"\n]*(?:lifted_|chunks_)[^"\n]*[.]c"\)/))continue;
 const line=Number(block.match(/DW_AT_call_line\s+\((\d+)\)/)?.[1]),addr=lines.get(line);if(!addr)continue;
 const lo=block.match(/DW_AT_low_pc\s+\(0x([0-9a-f]+)\)/),hi=block.match(/DW_AT_high_pc\s+\(0x([0-9a-f]+)\)/);
 if(lo&&hi)inlines.push({lo:parseInt(lo[1],16),hi:parseInt(hi[1],16),addr});
 for(const r of block.matchAll(/\[0x([0-9a-f]+), 0x([0-9a-f]+)\)/g))inlines.push({lo:parseInt(r[1],16),hi:parseInt(r[2],16),addr});
}
let files={},active=null;const events=new Map();
for(const line of dump.split(String.fromCharCode(10))){
 if(line.startsWith('debug_line[')){files={};active=null;}
 const file=line.match(/file_names\[\s*(\d+)\]:/);if(file)active=Number(file[1]);
 const name=line.match(/^\s+name: "(.*)"/);if(name&&active!==null)files[active]=name[1];
 const row=line.match(/^0x([0-9a-f]+)\s+(\d+)\s+\d+\s+(\d+)\s+/);if(!row)continue;
 const pc=parseInt(row[1],16),ln=Number(row[2]),fname=files[Number(row[3])]??'';
 const addr=/(?:lifted_|chunks_).*\.c$/.test(fname)?lines.get(ln):null;
 events.set(pc,line.includes('end_sequence')?null:(addr??null));
}
// Caller ranges override helper source lines. Splitting all endpoints prevents attribution leaking.
for(const r of inlines){if(!events.has(r.lo))events.set(r.lo,null);if(!events.has(r.hi))events.set(r.hi,null);}
const b=readFileSync(dir+'/debug/debug.wasm');let p=8,code=0;const leb=()=>{let v=0,s=0,x;do{x=b[p++];v|=(x&127)<<s;s+=7;}while(x&128);return v;};
while(p<b.length){const id=b[p++],n=leb();if(id===10)code=p;p+=n;}
if(!code)throw Error('missing code section');
const sources=['boundary'],meta={};const vlq=n=>{n=n<0?((-n)*2+1):n*2;let s='';do{let v=n&31;n=Math.floor(n/32);if(n)v|=32;s+='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[v];}while(n);return s;};
let previous=0,prevSource=0;const mappings=[];
for(const [pc,base]of [...events].sort((a,b)=>a[0]-b[0])){
 const candidates=inlines.filter(r=>pc>=r.lo&&pc<r.hi);const addr=candidates.length?candidates.sort((a,b)=>(b.hi-b.lo)-(a.hi-a.lo))[0].addr:base;
 let index=0;if(addr){const x=byAddr.get(addr),key='form-'+form(x);index=sources.indexOf(key);if(index<0){index=sources.length;sources.push(key);}meta[addr]={...x,form:form(x)};}
 mappings.push([code+pc-previous,index-prevSource,0,0].map(vlq).join(''));previous=code+pc;prevSource=index;
}
writeFileSync(dir+'/debug/source.map',JSON.stringify({version:3,sources,names:[],mappings:mappings.join(',')}));
writeFileSync(dir+'/debug/attribution.json',JSON.stringify({meta,lines:[...lines],inlines,sources,method:'DWARF line rows plus inline caller ranges; shared optimized instructions inherit compiler source attribution; boundary/unattributed costs separate.'}));
execFileSync(process.execPath,['node_modules/binaryen/bin/wasm-dis',dir+'/debug/debug.wasm','--source-map',dir+'/debug/source.map','-o',dir+'/debug/attributed.wat']);
console.log({sources:sources.length,inlines:inlines.length,lines:lines.size,events:events.size});
