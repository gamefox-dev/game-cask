// Host build of the GL profile's GLSL front end (platforms/win32/w32_glsl.h) driven by tests/native/glsl_driver.c.
// Only our own CC0 sources are compiled; the driver prints preprocessing, reflection and canonical output as JSON.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './headless';

export interface GlslStage { ok: boolean; log: string; pp: string; version: number; es: number; core: number }
export interface GlslUniform {
  name: string; type: number; size: number; location: number; block: number; offset: number;
  arrayStride: number; matrixStride: number; stages: number; slot: number;
}
export interface GlslResult {
  vs: GlslStage | null; fs: GlslStage | null; linked: boolean; linkLog?: string; usize?: number; slots?: number;
  uniforms?: GlslUniform[]; blocks?: { name: string; size: number; members: number; stages: number }[];
  attribs?: { name: string; type: number; size: number; location: number }[];
  outputs?: { name: string; type: number; size: number; location: number }[];
  vsOut?: string | null; fsOut?: string | null; vsEmitLog?: string; fsEmitLog?: string;
}
export interface GlslOptions {
  vs?: string[]; fs?: string[]; attr?: Record<string, number>; frag?: Record<string, number>;
  ppOnly?: boolean; reflectOnly?: boolean;
}

let driver: string | undefined;
export function glslDriver(): string {
  if (driver) return driver;
  const dir = join(ROOT, 'node_modules/.cache/bgt/glsl-native');
  mkdirSync(dir, { recursive: true });
  const exe = join(dir, `driver-${process.pid}`);
  const cc = process.env.CC ?? 'cc';
  execFileSync(cc, ['-std=c11', '-O1', '-Wall', '-Wextra', '-Werror', '-o', exe, join(ROOT, 'tests/native/glsl_driver.c')],
    { stdio: 'inherit' });
  return driver = exe;
}

export function runGlsl(options: GlslOptions): GlslResult {
  const exe = glslDriver();
  const work = mkdtempSync(join(ROOT, 'node_modules/.cache/bgt/glsl-native/run-'));
  try {
    const args: string[] = [];
    const add = (flag: string, sources: string[] = []) => sources.forEach((text, i) => {
      const path = join(work, `${flag.slice(2)}${i}.glsl`); writeFileSync(path, text); args.push(flag, path);
    });
    add('--vs', options.vs); add('--fs', options.fs);
    for (const [name, loc] of Object.entries(options.attr ?? {})) args.push('--attr', `${name}=${loc}`);
    for (const [name, loc] of Object.entries(options.frag ?? {})) args.push('--frag', `${name}=${loc}`);
    if (options.ppOnly) args.push('--pp');
    if (options.reflectOnly) args.push('--reflect-only');
    return JSON.parse(execFileSync(exe, args, { encoding: 'utf8', maxBuffer: 64 << 20 })) as GlslResult;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** Preprocess one shader given as one or more source strings (glShaderSource semantics). */
export function preprocess(...sources: string[]): GlslStage {
  const r = runGlsl({ fs: sources, ppOnly: true }); return r.fs!;
}
