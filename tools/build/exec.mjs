// Keep the build lease alive until each subprocess writer finishes, even if Node is killed.
import { execFileSync as nativeExec } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './toolchain.mjs';
let token = null;
export const buildWriterToken = () => token;
export function withBuildWriters(lease, fn) {
  const previous=token;token=lease;
  try {return fn();} finally {token=previous;}
}
export function execFileSync(command,args,options) {
  return token ? nativeExec('python3',['-I',join(ROOT,'tools/build/writer.py'),token,command,...args],options)
    : nativeExec(command,args,options);
}
