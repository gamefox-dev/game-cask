// Per-game writer lock: generated drivers/sources and output manifests share an id across callers.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function buildLock(root,id) {
  mkdirSync(root,{recursive:true});
  const path=join(root,id+'.lock'), wait=new Int32Array(new SharedArrayBuffer(4));
  for(let tries=0;;tries++) {
    try {mkdirSync(path);break;} catch(e) {
      if(e.code!=='EEXIST')throw e;
      try {
        const pid=Number(readFileSync(join(path,'pid'),'utf8'));
        try {process.kill(pid,0);} catch(err) {if(err.code==='ESRCH'){rmSync(path,{recursive:true,force:true});continue;}}
      } catch(err) {if(err.code!=='ENOENT')throw err;}
      if(tries>36000)throw new Error(`build lock timeout for ${id}`);
      Atomics.wait(wait,0,0,100);
    }
  }
  writeFileSync(join(path,'pid'),String(process.pid));
  return ()=>rmSync(path,{recursive:true,force:true});
}
