// Build the example games once before unit tests (they load real wasm). Never the port: kit suites
// must not touch port/ or its results.
import { execFileSync } from 'node:child_process';

export default function setup(): void {
  execFileSync(process.execPath, ['tools/build/build.mjs', '--examples'], { stdio: 'inherit' });
}
