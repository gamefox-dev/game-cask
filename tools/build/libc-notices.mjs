// Retain notices for the existing toolchain libc/libm linked into AMD64 BGT modules.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function libcNotices(zig) {
  const { lib_dir: lib } = JSON.parse(execFileSync(zig, ['env'], { encoding: 'utf8' }));
  const files = ['libc/musl/COPYRIGHT', 'libc/wasi/LICENSE', 'libc/wasi/LICENSE-MIT',
    'libc/wasi/LICENSE-APACHE', 'libc/wasi/LICENSE-APACHE-LLVM'];
  const notices = files.map((p) => `\n=== Zig ${p} ===\n${readFileSync(join(lib, p), 'utf8')}`);
  // Math has additional per-file permissive notices. Include comments verbatim, never implementation code.
  const math = join(lib, 'libc/musl/src/math');
  const comments = new Set();
  for (const name of readdirSync(math).filter((n) => n.endsWith('.c')).sort()) {
    const source = readFileSync(join(math, name), 'utf8');
    for (const m of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
      if (/copyright|permission|license|SPDX/i.test(m[0])) comments.add(m[0]);
    }
  }
  return 'Linked backend: Zig bundled WASI musl libc/libm. Original bridge: MIT.\n'
    + notices.join('\n') + '\n=== Individual musl math notices ===\n' + [...comments].join('\n\n') + '\n';
}
