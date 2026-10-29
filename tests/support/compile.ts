// Compile small C fixtures to wasm with the kit's exact flags.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './headless';

export async function compileC(src: string, defines: string[] = []): Promise<Uint8Array<ArrayBuffer>> {
  // @ts-expect-error -- plain ESM module without types
  const { CFLAGS, LDFLAGS } = await import('../../tools/build/build.mjs');
  // @ts-expect-error -- plain ESM module without types
  const { requireZig } = await import('../../tools/build/toolchain.mjs');
  const zig = requireZig({ quiet: true });
  const out = join(mkdtempSync(join(tmpdir(), 'bgt-fixture-')), 'out.wasm');
  execFileSync(zig.path, ['cc', ...CFLAGS, ...defines.map((d) => `-D${d}`), '-I', join(ROOT, 'bgt/include'), join(ROOT, src), join(ROOT, 'bgt/sdk/bgt_libc.c'), ...LDFLAGS, '-o', out], { stdio: 'inherit' });
  return new Uint8Array(readFileSync(out));
}
