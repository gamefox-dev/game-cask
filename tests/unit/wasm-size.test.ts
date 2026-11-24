// @bgt-examples: none
// K72 (Q131): wasm size attribution tools, the name-section strip and the DWARF line attribution parsers.
import { it, expect } from 'vitest';
// @ts-expect-error plain ESM
import { analyze, functionKind, markedFeatures, nnls, coverageSplit, functionSizes, sectionSplit, opClass } from '../../tools/report/wasm-size.mjs';
// @ts-expect-error plain ESM
import { parseLines, parseInlined, lineClasses, attribute } from '../../tools/report/wasm-lines.mjs';
// @ts-expect-error plain ESM
import { stripNames, functionNames, encodeFunctionNames } from '../../tools/build/wasm-names.mjs';
// @ts-expect-error plain ESM
import { wasmNamesMode } from '../../tools/build/build.mjs';

const leb = (n: number) => { const b = []; do { let v = n & 127; n >>>= 7; if (n) v |= 128; b.push(v); } while (n); return Buffer.from(b); };
const section = (id: number, data: Buffer) => Buffer.concat([Buffer.from([id]), leb(data.length), data]);
const vec = (items: Buffer[]) => Buffer.concat([leb(items.length), ...items]);
/** One import (env.f), three defined functions with bodies of `sizes` bytes (nops), a data segment and names. */
function module(sizes: number[], names: string[]) {
  const type = section(1, vec([Buffer.from([0x60, 0, 0])]));
  const imp = section(2, vec([Buffer.concat([leb(3), Buffer.from('env'), leb(1), Buffer.from('f'), Buffer.from([0, 0])])]));
  const fn = section(3, vec(sizes.map(() => leb(0))));
  const mem = section(5, vec([Buffer.from([0, 1])]));
  const code = section(10, vec(sizes.map((n) => { const body = Buffer.concat([leb(0), Buffer.alloc(n - 2, 0x01), Buffer.from([0x0b])]); return Buffer.concat([leb(body.length), body]); })));
  const data = section(11, vec([Buffer.concat([Buffer.from([0, 0x41, 0, 0x0b]), leb(5), Buffer.from('hello')])]));
  return Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), type, imp, fn, mem, code, data,
    encodeFunctionNames([{ index: 0, name: 'f' }, ...names.map((name, i) => ({ index: i + 1, name }))])]);
}

it('sections, kinds and per-function sizes (imports offset the index space)', () => {
  const m = module([40, 10, 300], ['N_01000000', 'F_01000000', 'x86_fast_exec']);
  expect(new WebAssembly.Module(m)).toBeTruthy();
  const split = sectionSplit(m);
  expect(split.name.subsections.function).toBeGreaterThan(0);
  expect(split.sections.find((s: { id: number }) => s.id === 11)).toMatchObject({ segments: 1, payload: 5 });
  const fns = functionSizes(m);
  expect(fns.map((f: { name: string; kind: string; bytes: number }) => [f.name, f.kind, f.bytes])).toEqual([
    ['N_01000000', 'lifted-fast', 41], ['F_01000000', 'lifted-wrapper', 11], ['x86_fast_exec', 'x86-runtime', 302]]);
  const r = analyze(m);
  expect(r.kinds['lifted-fast']).toMatchObject({ functions: 1, bytes: 41 });
  expect(r.largest[0].name).toBe('x86_fast_exec');
  expect(functionKind('R_01000000_01000010')).toBe('lifted-region');
  expect(functionKind('w32_gl_draw')).toBe('win32-profile');
});

it('stripNames drops only the name section; the symbol map restores names for the size report', () => {
  const m = module([40, 10, 300], ['N_01000000', 'F_01000000', 'x86_fast_exec']);
  const { bytes, stripped } = stripNames(m);
  expect(stripped).toBeGreaterThan(0); expect(bytes.length).toBe(m.length - stripped);
  expect(functionNames(bytes)).toEqual([]);
  expect(WebAssembly.Module.customSections(new WebAssembly.Module(bytes), 'name')).toHaveLength(0);
  expect(stripNames(bytes).stripped).toBe(0);
  const map = { functions: functionNames(m) };
  expect(functionSizes(bytes, map).map((f: { name: string }) => f.name)).toEqual(['N_01000000', 'F_01000000', 'x86_fast_exec']);
  expect(wasmNamesMode({ pipeline: {} }, {})).toBe('keep');
  expect(wasmNamesMode({ pipeline: {} }, { BGT_WASM_NAMES: 'strip' })).toBe('strip');
  expect(wasmNamesMode({ pipeline: { wasmNames: 'keep' } }, { BGT_WASM_NAMES: 'strip' })).toBe('keep');
  expect(() => wasmNamesMode({ pipeline: { wasmNames: 'drop' } }, {})).toThrow(/keep or strip/);
});

it('marked features, class mapping, NNLS and coverage split', () => {
  const text = '/*@F 01000000 3*//* function */\n/*@mov*/x\n/*@call*/y\n/*@+s.addsd*/z\n/*@F 01000010 1*/\n/*@ret*/';
  const f = markedFeatures(text);
  expect(f.get('01000000')).toMatchObject({ insns: 3, own: 2, inlined: 1, classes: { mov: 1, call: 1, 's.addsd': 1 } });
  expect(opClass('s.addsd')).toBe('simd'); expect(opClass('call_ind')).toBe('call'); expect(opClass('xyz')).toBe('other');
  // y = 2 + 3a + 5b exactly
  const X = [[1, 1, 0], [1, 0, 1], [1, 2, 1], [1, 1, 3], [1, 4, 2]], y = X.map((r) => 2 * r[0] + 3 * r[1] + 5 * r[2]);
  const fit = nnls(X, y);
  expect(fit.coefficients.map((c: number) => +c.toFixed(6))).toEqual([2, 3, 5]); expect(fit.r2).toBeCloseTo(1, 9);
  const fns = [{ name: 'N_01000000', kind: 'lifted-fast', bytes: 100 }, { name: 'N_01000010', kind: 'lifted-fast', bytes: 300 }, { name: 'x86_run', kind: 'x86-runtime', bytes: 50 }];
  expect(coverageSplit(fns, { code: [{ address: 0x01000000, kind: 1 }] })).toMatchObject({ lifted: { functions: 2, bytes: 400 }, entered: { bytes: 100 }, never: { functions: 1, bytes: 300 }, neverShare: 0.75 });
});

it('DWARF line attribution: header code goes to the outermost inlined call line in the chunk', () => {
  const lineText = [
    'debug_line[0x00000000]', 'include_directories[  1] = "./chunks"', 'include_directories[  2] = "./platforms/x86"',
    'file_names[  1]:', '           name: "m_0000.c"', '      dir_index: 1', 'file_names[  2]:', '           name: "x86_lift64.h"', '      dir_index: 2',
    'Address            Line   Column File   ISA Discriminator OpIndex Flags',
    '0x0000000000000010      3      1      1   0             0       0  is_stmt',
    '0x0000000000000018    200      9      2   0             0       0  is_stmt',
    '0x0000000000000030      4      1      1   0             0       0  is_stmt',
    '0x0000000000000040      0      0      1   0             0       0 ',
    '0x0000000000000048      0      0      1   0             0       0  end_sequence'].join('\n');
  const rows = parseLines(lineText);
  expect(rows).toEqual([{ lo: 0x10, hi: 0x18, file: './chunks/m_0000.c', line: 3 }, { lo: 0x18, hi: 0x30, file: './platforms/x86/x86_lift64.h', line: 200 },
    { lo: 0x30, hi: 0x40, file: './chunks/m_0000.c', line: 4 }, { lo: 0x40, hi: 0x48, file: './chunks/m_0000.c', line: 0 }]);
  const infoText = ['0x00000100:     DW_TAG_inlined_subroutine', '                  DW_AT_low_pc	(0x00000018)', '                  DW_AT_high_pc	(0x00000030)',
    '                  DW_AT_call_file	("./chunks/m_0000.c")', '                  DW_AT_call_line	(4)', '',
    '0x00000110:       DW_TAG_inlined_subroutine', '                    DW_AT_low_pc	(0x00000020)', '                    DW_AT_high_pc	(0x00000028)',
    '                    DW_AT_call_file	("./platforms/x86/x86_lift64.h")', '                    DW_AT_call_line	(210)', '', '0x00000120:       NULL'].join('\n');
  const inl = parseInlined(infoText, (f: string) => f.endsWith('m_0000.c'));
  expect(inl).toEqual([{ lo: 0x18, hi: 0x30, file: './chunks/m_0000.c', line: 4 }]);
  const marked = '/* GENERATED */\n/*@F 01000000 2*//* function */\n/*@mov*/t=1;\n/*@call*/X.r[1]=r[1];\nslow:X.eip=pc;\nvoid F_01000000(void){}';
  const lc = lineClasses(marked);
  expect(lc.cls.slice(1, 7)).toEqual(['(other)', '(prologue)', 'mov', 'call', '(epilogue)', '(epilogue)']);
  const r = attribute({ lineText, infoText, marked: new Map([['m_0000.c', lc]]) });
  expect(r.bytes).toEqual({ mov: 8, call: 0x18 + 0x10, '(merged, line 0)': 8 });
  expect(r.lifted).toBe(0x38);
});
