// Bounded content caches, with leases protecting concurrent builds during collection.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildLock } from './lock.mjs';
import { buildWriterToken } from './exec.mjs';

function locked(dir, fn) {
  const release=buildLock(dir,'.gc',30);
  try {return fn();} finally {release();}
}

export function leaseCache(dir, files) {
  return locked(dir,()=>{
  const leases = join(dir,'.leases'); mkdirSync(leases,{recursive:true});
  const path = join(leases,`${process.pid}-${randomUUID()}.json`);
  const tmp = path + '.tmp'; writeFileSync(tmp,JSON.stringify({pid:process.pid,files,writerToken:buildWriterToken()})); renameSync(tmp,path);
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
      // The guardian removes .writers only after draining subprocesses. It is
      // authoritative even when the owner is an unreaped zombie (kill(pid,0)
      // would pin stale generations indefinitely).
      let alive = lease.writerToken ? existsSync(lease.writerToken+'.writers') : true;
      if (!lease.writerToken) try {process.kill(lease.pid,0);} catch(e) {if(e.code==='ESRCH')alive=false;}
      if (alive) for (const f of lease.files) pinned.add(f);
      else rmSync(path,{force:true});
    } catch(e) {if(e.code!=='ENOENT')throw e;}
  }
  const files = [];
  for (const name of readdirSync(dir).filter((s)=>/\.(o|wasm)(\.[^.]+\.tmp)?$/.test(s))) {
    const path = join(dir,name);
    const payload = path.replace(/(\.(?:o|wasm))\.[^.]+\.tmp$/, '$1');
    try {const s=statSync(path);files.push({path,size:s.size,time:s.mtimeMs,pinned:pinned.has(payload)});} catch(e) {if(e.code!=='ENOENT')throw e;}
  }
  files.sort((a,b)=>a.time-b.time || a.path.localeCompare(b.path));
  let bytes=files.reduce((s,f)=>s+f.size,0),removed=0;
  for (const f of files) if (bytes>maxBytes && !f.pinned) {
    rmSync(f.path,{force:true}); bytes-=f.size; removed+=f.size;
  }
  return {bytes,removed,pinnedBytes:files.filter((f)=>f.pinned).reduce((n,f)=>n+f.size,0)};
  });
}

export function touchCache(files) {
  const now=new Date();
  for (const f of files) try {utimesSync(f,now,now);} catch(e) {if(e.code!=='ENOENT')throw e;}
}
