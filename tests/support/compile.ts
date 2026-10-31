// Compile small C fixtures to wasm with the kit's exact flags.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './headless';

export async function compileC(src: string, defines: string[] = [], withCrt = false): Promise<Uint8Array<ArrayBuffer>> {
  // @ts-expect-error -- plain ESM module without types
  const { CFLAGS, LDFLAGS } = await import('../../tools/build/build.mjs');
  // @ts-expect-error -- plain ESM module without types
  const { requireZig } = await import('../../tools/build/toolchain.mjs');
  const zig = requireZig({ quiet: true });
  const dir = mkdtempSync(join(tmpdir(), 'bgt-fixture-')), out = join(dir, 'out.wasm');
  try {
    const flags = CFLAGS.map((f: string) => withCrt && f === '--target=wasm32-freestanding' ? '--target=wasm32-wasi' : f);
    const link = withCrt ? ['-mexec-model=reactor', ...LDFLAGS.filter((f: string) => f !== '-nostdlib')] : LDFLAGS;
    execFileSync(zig.path, ['cc', ...flags, ...defines.map((d) => `-D${d}`), '-I', join(ROOT, 'bgt/include'), join(ROOT, src), ...(withCrt ? [] : [join(ROOT, 'bgt/sdk/bgt_libc.c')]), ...link, '-o', out], { stdio: 'inherit' });
    return new Uint8Array(readFileSync(out));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
