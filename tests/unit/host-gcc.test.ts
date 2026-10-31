import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain ESM
import { findGcc, checkHostGcc } from '../../tools/build/check-host-gcc.mjs';

it('GCC lint skips clang aliases and discovers versioned Homebrew GCC on PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-gcc-discovery-'));
  try {
    writeFileSync(join(dir, 'gcc-14'), '');
    const calls: string[] = [];
    const cc = findGcc(dir, (file: string) => {
      calls.push(file);
      return { status: 0, stdout: file === 'gcc' ? 'Apple clang version 21' : 'gcc-14 (Homebrew GCC 14.2.0) 14.2.0' };
    });
    expect(cc).toBe(join(dir, 'gcc-14'));
    expect(calls).toEqual(['gcc', join(dir, 'gcc-14')]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('GCC lint accepts unversioned Linux GCC and skips quietly when it is unavailable', () => {
  expect(findGcc('', () => ({ status: 0, stdout: 'gcc (Ubuntu 14.2.0) 14.2.0' }))).toBe('gcc');
  expect(findGcc('', () => ({ status: null, error: new Error('ENOENT') }))).toBeNull();
  let called = false;
  checkHostGcc(null, () => { called = true; });
  expect(called).toBe(false);
});

it.each([false, true])('GCC lint enforces CI flags and cleans outputs even on compiler failure (%s)', (fail) => {
  let output = '';
  const run = (cc: string, args: string[]) => {
    expect(cc).toBe('gcc-14');
    expect(args.slice(0, 6)).toEqual(['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-o']);
    expect(args.slice(7).map((p) => p.replaceAll('\\', '/'))).toEqual([
      expect.stringMatching(/\/tools\/x86\/x86tool\.c$/),
      expect.stringMatching(/\/platforms\/x86\/x86_decode\.c$/),
    ]);
    output = args[6];
    mkdirSync(output); // A stand-in artifact that must be removed on both paths.
    if (fail) throw new Error('warning treated as error');
  };
  if (fail) expect(() => checkHostGcc('gcc-14', run)).toThrow('warning treated as error');
  else checkHostGcc('gcc-14', run);
  expect(output).not.toBe('');
  expect(existsSync(output)).toBe(false);
});
