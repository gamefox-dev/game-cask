// Engine-independent GLSL builtin lowering. Helpers take values, so arguments evaluate once.
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
