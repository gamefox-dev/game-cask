// macOS/Linux kernel locks; permanent inodes, no stale-owner pathname deletion.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './toolchain.mjs';

export function buildLock(root,id,timeout = 3600) {
  mkdirSync(root,{recursive:true});
  const token=execFileSync('python3',['-I',join(ROOT,'tools/build/file-lock.py'),join(root,id+'.flock'),String(process.pid),String(timeout)],{encoding:'utf8'}).trim();
  const release=()=>rmSync(token,{force:true});
  release.token=token;
  return release;
}
