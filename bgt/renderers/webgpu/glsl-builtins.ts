// Engine-independent GLSL builtin lowering. Helpers take values, so arguments evaluate once.
export interface BuiltinExpr { code: string; type: string; bits?: string; constant?: boolean }
interface Context { helper(source: string): void; fail(message: string): never }
const shape = (t: string, scalar: string) => /^vec[234]/.test(t) ?
  'vec' + t[3] + (scalar === 'bool' ? '<bool>' : scalar[0]) : scalar;

/** Returns undefined only for names owned by another lowering path. */
export function lowerBuiltin(name: string, args: BuiltinExpr[], context: Context): BuiltinExpr | undefined {
  const a = args[0], b = args[1];
  const require = (valid: boolean, message: string) => { if (!valid) context.fail(name + ': ' + message); };
  if (/^noise[1234]$/.test(name)) {
    require(args.length === 1 && /^(f32|vec[234]f)$/.test(a.type), 'requires float scalar/vector');
    // Reviewer decision: deprecated desktop noise builtins return typed zero on the observed
    // NVIDIA/AMD/Intel driver class; preserve that portable behavior, not invented random noise.
    const type = name[5] === '1' ? 'f32' : 'vec' + name[5] + 'f';
    const helper = 'bgt_internal_' + name + '_' + a.type;
    context.helper('fn ' + helper + '(x: ' + a.type + ') -> ' + type + ' { return ' + type + '(0.0); }');
    return { code: helper + '(' + a.code + ')', type };
  }
  if (name === 'inverse') {
    const helper = args.length === 1 && inverseHelper(a.type);
    if (!helper) context.fail('inverse requires one square float matrix');
    if (a.constant) {
      const determinant = /let d = (.*); return/.exec(helper.source)![1];
      const result = /; return (.*); }$/.exec(helper.source)![1];
      return { code: result.replace(/\bd\b/g, '(' + determinant + ')').replace(/\bm\b/g, '(' + a.code + ')'), type: a.type };
    }
    context.helper(helper.source);
    return { code: helper.name + '(' + a.code + ')', type: a.type };
  }
  if (name === 'transpose') {
    require(args.length === 1 && /^mat[234]x[234]f$/.test(a.type), 'requires a float matrix');
    return { code: 'transpose(' + a.code + ')', type: 'mat' + a.type[5] + 'x' + a.type[3] + 'f' };
  }
  if (name === 'matrixCompMult' || name === 'outerProduct') {
    const matrix = name === 'matrixCompMult';
    require(args.length === 2 && (matrix ? /^mat[234]x[234]f$/.test(a.type) && a.type === b.type :
      /^vec[234]f$/.test(a.type) && /^vec[234]f$/.test(b.type)), 'invalid operand shapes');
    const type = matrix ? a.type : 'mat' + b.type[3] + 'x' + a.type[3] + 'f';
    const helper = 'bgt_internal_' + name + '_' + type;
    const columns = Array.from({ length: Number(type[3]) }, (_, c) => matrix ?
      'a[' + c + '] * b[' + c + ']' : 'a * b[' + c + ']');
    if (args.every(a => a.constant)) return { code: (type + '(' + columns.join(', ') + ')')
      .replace(/\b[ab]\b/g, n => '(' + (n === 'a' ? a.code : b.code) + ')'), type };
    context.helper('fn ' + helper + '(a: ' + a.type + ', b: ' + b.type + ') -> ' + type +
      ' { return ' + type + '(' + columns.join(', ') + '); }');
    return { code: helper + '(' + a.code + ', ' + b.code + ')', type };
  }
  const bitcasts: Record<string, [string, string]> = {
    floatBitsToInt: ['f', 'i32'], floatBitsToUint: ['f', 'u32'],
    intBitsToFloat: ['i', 'f32'], uintBitsToFloat: ['u', 'f32'],
  };
  if (bitcasts[name]) {
    const [from, to] = bitcasts[name];
    require(args.length === 1 && new RegExp('^(?:' + ({ f: 'f32', i: 'i32', u: 'u32' }[from]) + '|vec[234]' + from + ')$').test(a.type), 'invalid operand type');
    const type = shape(a.type, to);
    const code = a.bits && from === 'f' ? to === 'u32' ? a.bits : 'bitcast<' + type + '>(' + a.bits + ')' :
      'bitcast<' + type + '>(' + a.code + ')';
    return { code, type, bits: to === 'f32' ? from === 'u' ? a.code : 'bitcast<' + shape(a.type, 'u32') + '>(' + a.code + ')' : undefined };
  }
  if (name === 'isnan' || name === 'isinf') {
    require(args.length === 1 && /^(f32|vec[234]f)$/.test(a.type), 'requires float scalar/vector');
    const type = shape(a.type, 'bool'), uint = shape(a.type, 'u32');
    return { code: '((bitcast<' + uint + '>(' + a.code + ') & ' + uint + '(0x7fffffffu)) ' +
      (name === 'isnan' ? '>' : '==') + ' ' + uint + '(0x7f800000u))', type };
  }
  const packs: Record<string, [string, string, string]> = {
    packUnorm2x16: ['pack2x16unorm', 'vec2f', 'u32'], unpackUnorm2x16: ['unpack2x16unorm', 'u32', 'vec2f'],
    packSnorm2x16: ['pack2x16snorm', 'vec2f', 'u32'], unpackSnorm2x16: ['unpack2x16snorm', 'u32', 'vec2f'],
    packHalf2x16: ['pack2x16float', 'vec2f', 'u32'], unpackHalf2x16: ['unpack2x16float', 'u32', 'vec2f'],
    packUnorm4x8: ['pack4x8unorm', 'vec4f', 'u32'], unpackUnorm4x8: ['unpack4x8unorm', 'u32', 'vec4f'],
    packSnorm4x8: ['pack4x8snorm', 'vec4f', 'u32'], unpackSnorm4x8: ['unpack4x8snorm', 'u32', 'vec4f'],
  };
  if (name === 'unpackHalf2x16') {
    require(args.length === 1 && a.type === 'u32', 'requires uint');
    const helper = 'bgt_internal_unpack_half_bits';
    context.helper('fn ' + helper + '(p: u32) -> vec2u { return bitcast<vec2u>(unpack2x16float(p)) | ((vec2u(p, p >> 16u) & vec2u(0x8000u)) << vec2u(16u)); }');
    const bits = helper + '(' + a.code + ')';
    return { code: 'bitcast<vec2f>(' + bits + ')', type: 'vec2f', bits };
  }
  if (name === 'packHalf2x16') {
    require(args.length === 1 && a.type === 'vec2f', 'requires vec2f');
    const helper = 'bgt_internal_pack_half';
    // Some WGSL compilers canonicalize -0 in pack2x16float. Preserve both sign bits explicitly.
    context.helper('fn ' + helper + '(bits: vec2u) -> u32 { let signs = (bits >> vec2u(16u)) & vec2u(0x8000u); return pack2x16float(bitcast<vec2f>(bits & vec2u(0x7fffffffu))) | signs.x | (signs.y << 16u); }');
    const bits = a.bits ?? (a.code.startsWith('bitcast<vec2f>(') && a.code.endsWith(')') ?
      a.code.slice('bitcast<vec2f>('.length, -1) : 'bitcast<vec2u>(' + a.code + ')');
    return { code: helper + '(' + bits + ')', type: 'u32' };
  }
  if (packs[name]) {
    const [fn, from, type] = packs[name];
    require(args.length === 1 && a.type === from, 'requires ' + from);
    return { code: fn + '(' + a.code + ')', type };
  }
  if (a?.type === 'f32' && ['dot','normalize','faceforward','reflect','refract'].includes(name)) {
    const helper = 'bgt_internal_scalar_' + name;
    const expressions: Record<string,string> = { dot:'x * y', normalize:'sign(x)',
      faceforward:'select(-x, x, y * z < 0.0)', reflect:'x - 2.0 * y * x * y',
      refract:'select(0.0, z * x - (z * y * x + sqrt(max(k,0.0))) * y, k >= 0.0)' };
    const count = name === 'normalize' ? 1 : name === 'faceforward' || name === 'refract' ? 3 : 2;
    require(args.length === count && args.every(a=>a.type==='f32'), 'requires scalar floats');
    if (args.every(a => a.constant)) {
      const expression = expressions[name].replace(/\bk\b/g, '(1.0 - z * z * (1.0 - (y*x)*(y*x)))');
      return { code: '(' + expression.replace(/\b[xyz]\b/g, n => '(' + args['xyz'.indexOf(n)].code + ')') + ')', type: 'f32' };
    }
    context.helper('fn ' + helper + '(' + ['x','y','z'].slice(0,count).map(n=>n+': f32').join(', ') + ') -> f32 { ' +
      (name === 'refract' ? 'let k = 1.0 - z * z * (1.0 - (y*x)*(y*x)); ' : '') + 'return ' + expressions[name] + '; }');
    return { code: helper + '(' + args.map(a=>a.code).join(', ') + ')', type: 'f32' };
  }
  if (name === 'ldexp') {
    require(args.length === 2 && /^(f32|vec[234]f)$/.test(a.type) && b.type === shape(a.type, 'i32'), 'requires matching float / int shapes');
    return { code: 'ldexp(' + a.code + ', ' + b.code + ')', type: a.type };
  }
  return undefined;
}

// Column-major cofactor expansion, with no epsilon, pivot threshold or identity fallback.
// GLSL leaves singular/poorly-conditioned inverse results undefined. We deterministically execute
// adjugate / determinant operations; non-finite results remain subject to native WGSL float rules.
export function inverseHelper(type: string): { name: string; source: string } | undefined {
  const shape = /^mat([234])x\1f$/.exec(type);
  if (!shape) return undefined;
  const n = Number(shape[1]), name = 'bgt_internal_inverse_' + n;
  const determinant = (columns: number[], rows: number[]): string => rows.length === 1 ?
    'm[' + columns[0] + '][' + rows[0] + ']' : '(' + columns.map((c, i) =>
      (i % 2 ? '-' : '+') + 'm[' + c + '][' + rows[0] + '] * ' +
      determinant(columns.filter((_, j) => j !== i), rows.slice(1))).join(' ').replace(/^\+/, '') + ')';
  const indices = Array.from({ length: n }, (_, i) => i);
  const cofactor = (c: number, r: number) => (c + r) % 2 ?
    '-(' + determinant(indices.filter(i => i !== c), indices.filter(i => i !== r)) + ')' :
    determinant(indices.filter(i => i !== c), indices.filter(i => i !== r));
  const columns = indices.map(c => 'vec' + n + 'f(' + indices.map(r => cofactor(r, c) + ' / d').join(', ') + ')');
  return { name, source: 'fn ' + name + '(m: ' + type + ') -> ' + type +
    ' { let d = ' + determinant(indices, indices) + '; return ' + type + '(' + columns.join(', ') + '); }' };
}
