// SPDX-License-Identifier: CC0-1.0
import { describe, expect, it } from 'vitest';
import { integerConstant, integerLiteral } from '../../bgt/renderers/webgpu/glsl-integers';
import { translateGLSL } from '../../bgt/renderers/webgpu/shaders';
const tokens = (s: string) => s.match(/0[xX][\da-fA-F]+[uU]?|\d+[uU]?|[A-Za-z_]\w*|<<|>>|&&|\|\||==|!=|<=|>=|[^\s]/g)!;
const value = (s: string) => integerConstant(tokens(s), new Map());
describe('32-bit GLSL integer lexical and constant-expression contracts', () => {
  it.each([
    ['0', '0i'], ['00', '0i'], ['010', '8i'], ['037777777777', '-1i'], ['0xEF', '239i'],
    ['0XfF', '255i'], ['0x80000000', '(-2147483647i - 1i)'], ['4294967295', '-1i'],
    ['0xFFFFFFFFU', '4294967295u'], ['037777777777u', '4294967295u'], ['4294967295U', '4294967295u'],
  ])('%s becomes exactly %s', (input, code) => expect(integerLiteral(input)?.code).toBe(code));
  it.each(['08', '09u', '0x', '0Xg', '3uu', '1.0', '1e3', '0x123fF.0'])('does not misclassify %s as an integer', input => {
    expect(integerLiteral(input)).toBeUndefined();
  });
  it.each(['4294967296u', '0x100000000', '040000000000'])('rejects oversized %s, never truncates a literal silently', input => {
    expect(() => integerLiteral(input)).toThrow('exceeds 32 bits');
  });
  it.each([
    ['0x10 + 010 + 10', 34], ['0xffffffffu + 2u', 1], ['0x80000001u * 3u', 2147483651],
    ['~0u', 4294967295], ['uint(-1) >> 31', 1], ['int(0xffffffffu) >> 31u', -1],
    ['(0Xff & 077) ^ 0x1', 62], ['true ? 3 : 1/0', 3], ['false ? 1/0 : 4', 4],
    ['false && (1/0 > 0)', 0], ['true || (1/0 > 0)', 1], ['2 < 3 ? 5 : 6', 5],
  ])('evaluates %s with GLSL width and signedness', (input, expected) => expect(value(input)).toBe(expected));
  it.each(['1/0', '1u << 32', '1 >> -1', 'notKnown + 1', '3 trailing'])('does not invent a value for %s', input => {
    expect(value(input)).toBeUndefined();
  });
  it('retains unsigned named constants in mixed-signed operations', () => {
    expect(integerConstant(tokens('one + -2 < 0'), new Map([['one', { value: 1n, unsigned: true }]]))).toBe(0);
  });
  it('restores constants after scopes and never folds mutable shadows', () => {
    const code = translateGLSL(`#version 330 core
const uint k=1u; const uint choice = true ? 0xFFFFFFFFu+2u : 1u/0u;
uint run(uint k) { return k + 1u; }
void main() { { uint k=3u; uint v=k+1u; gl_Position=vec4(float(v)); }
uint last = run(k); gl_Position.x=float(last); }`, 1, 1);
    expect(code).toContain('const choice: u32 = 1u;');
    expect(code).toContain('(k + 1u)');
    expect(code).toMatch(/run\(1u\)/);
  });
  it.each(['08', '0x', '4294967296u'])('rejects malformed or oversized shader literal %s', literal => {
    expect(() => translateGLSL(`#version 330 core\nvoid main(){uint v=${literal};}`, 1, 1)).toThrow();
  });
});
