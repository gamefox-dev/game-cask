// Build the example games once before unit tests (they load real wasm).
import { execFileSync } from 'node:child_process';

export default function setup(): void {
  execFileSync(process.execPath, ['tools/build/build.mjs', '--all'], { stdio: 'inherit' });
}
