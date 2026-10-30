// Coverage snapshots are private evidence, tied to exact module hashes/bases, never to an engine name.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export function coveragePlan(files,gameDir) {
  const code=new Set(),ranges=[],modules=[];
  for(const file of files) {
    const c=JSON.parse(readFileSync(resolve(gameDir,file),'utf8'));
    if(c.schema!=='game-cask/coverage/1'||!Array.isArray(c.code)||!Array.isArray(c.files)||!Array.isArray(c.modules))throw new Error('invalid coverage snapshot');
    if(c.metrics?.code_entries_dropped>0)throw new Error('coverage overflowed; cannot package an incomplete recording');
    for(const m of c.modules) {
      const old=modules.find((x)=>x.name===m.name);
      if(old&&(old.sha256!==m.sha256||old.base!==m.base))throw new Error('coverage module identities disagree');
      if(!old)modules.push(m);
    }
    for(const e of c.code) {if(!Number.isInteger(e.address)||e.address<0||e.address>0xffffffff)throw new Error('invalid code coverage address');code.add(e.address);}
    for(const r of c.files) {if(typeof r.path!=='string'||!Number.isSafeInteger(r.offset)||r.offset<0||!Number.isSafeInteger(r.length)||r.length<0)throw new Error('invalid file range');ranges.push(r);}
  }
  return {code,ranges,modules};
}
export function staticClosure(analysis,recorded) {
  const fns=new Map(analysis.functions.map((f)=>[f.addr,f])),selected=new Set([...recorded].filter((a)=>fns.has(a))),pending=[...selected];
  while(pending.length)for(const call of fns.get(pending.pop()).calls)if(fns.has(call)&&!selected.has(call)){selected.add(call);pending.push(call);}
  return [...selected].sort((a,b)=>a-b);
}
