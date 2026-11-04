// macOS/Linux kernel locks; permanent inodes, no stale-owner pathname deletion.
import { execFileSync, withBuildWriters } from './exec.mjs';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './toolchain.mjs';

export function buildLock(root,id,timeout = 3600) {
  mkdirSync(root,{recursive:true});
  // A long-lived nested guardian must not inherit an outer build's writer lease.
  // Bound lock contention AND guardian readiness, including a stopped fork child.
  const deadline=Math.min(timeout*1000,Number(process.env.BGT_BUILD_TIMEOUT_MS ?? 30*60*1000));
  const token=withBuildWriters(null,()=>execFileSync('python3',['-I',join(ROOT,'tools/build/file-lock.py'),join(root,id+'.flock'),String(process.pid),String(timeout)],{encoding:'utf8',timeout:deadline,phase:'lock acquisition/readiness'})).trim();
  const release=()=>rmSync(token,{force:true});
  release.token=token;
  return release;
}
