// Bounded content caches, with leases protecting concurrent builds during collection.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function locked(dir, fn) {
  mkdirSync(dir,{recursive:true});
  const lock=join(dir,'.gc-lock'), wait=new Int32Array(new SharedArrayBuffer(4));
  for (let tries=0;;tries++) {
    try {mkdirSync(lock);break;} catch(e) {
      if(e.code!=='EEXIST')throw e;
      try {
        const pid=Number(readFileSync(join(lock,'pid'),'utf8'));
        try {process.kill(pid,0);} catch(err) {if(err.code==='ESRCH'){rmSync(lock,{recursive:true,force:true});continue;}}
      } catch(err) {if(err.code!=='ENOENT')throw err;}
      if(tries>3000)throw new Error('cache collection lock timeout');
      Atomics.wait(wait,0,0,10);
    }
  }
  try {writeFileSync(join(lock,'pid'),String(process.pid));return fn();}
  finally {rmSync(lock,{recursive:true,force:true});}
}

export function leaseCache(dir, files) {
  return locked(dir,()=>{
  const leases = join(dir,'.leases'); mkdirSync(leases,{recursive:true});
  const path = join(leases,`${process.pid}-${randomUUID()}.json`);
  const tmp = path + '.tmp'; writeFileSync(tmp,JSON.stringify({pid:process.pid,files})); renameSync(tmp,path);
  return () => rmSync(path,{force:true});
  });
}

export function pruneCache(dir, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('cache budget must be nonnegative bytes');
  if (!existsSync(dir)) return {bytes:0,removed:0,pinnedBytes:0};
  return locked(dir,()=>{
  const pinned = new Set(), leases = join(dir,'.leases');
  if (existsSync(leases)) for (const file of readdirSync(leases).filter((s)=>s.endsWith('.json'))) {
    const path = join(leases,file);
    try {
      const lease = JSON.parse(readFileSync(path,'utf8'));
      let alive = true;
      try {process.kill(lease.pid,0);} catch(e) {if(e.code==='ESRCH')alive=false;}
      if (alive) for (const f of lease.files) pinned.add(f);
      else rmSync(path,{force:true});
    } catch(e) {if(e.code!=='ENOENT')throw e;}
  }
  const files = [];
  for (const name of readdirSync(dir).filter((s)=>/\.(o|wasm)$/.test(s))) {
    const path = join(dir,name);
    try {const s=statSync(path);files.push({path,size:s.size,time:s.mtimeMs});} catch(e) {if(e.code!=='ENOENT')throw e;}
  }
  files.sort((a,b)=>a.time-b.time || a.path.localeCompare(b.path));
  let bytes=files.reduce((s,f)=>s+f.size,0),removed=0;
  for (const f of files) if (bytes>maxBytes && !pinned.has(f.path)) {
    rmSync(f.path,{force:true}); bytes-=f.size; removed+=f.size;
  }
  return {bytes,removed,pinnedBytes:files.filter((f)=>pinned.has(f.path)).reduce((n,f)=>n+f.size,0)};
  });
}

export function touchCache(files) {
  const now=new Date();
  for (const f of files) try {utimesSync(f,now,now);} catch(e) {if(e.code!=='ENOENT')throw e;}
}
