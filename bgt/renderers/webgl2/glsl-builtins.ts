// Later-version portable extras explicitly accepted by the renderer frontend.
// GLSL ES 3.00 already supplies every other audited numeric builtin natively.
export function builtinExtras(source: string): string {
  const definitions: string[] = [];
  if (/\bfrexp\s*\(/.test(source)) {
    definitions.push(`float frexp(float x, out int e) {
      uint b = floatBitsToUint(x); uint a = b & 0x7fffffffu;
      if (a == 0u) { e = 0; return x; }
      int correction = 0;
      if (a < 0x00800000u) { x *= 16777216.0; b = floatBitsToUint(x); correction = -24; }
      e = int((b >> 23u) & 255u) - 126 + correction;
      return uintBitsToFloat((b & 0x807fffffu) | 0x3f000000u);
    }`);
    for (const n of [2,3,4]) definitions.push('vec' + n + ' frexp(vec' + n + ' x, out ivec' + n + ' e) { return vec' + n + '(' +
      Array.from({ length: n }, (_, i) => 'frexp(x.' + 'xyzw'[i] + ', e.' + 'xyzw'[i] + ')').join(', ') + '); }');
  }
  if (/\bldexp\s*\(/.test(source)) {
    // Split the exponent so a representable result does not overflow an intermediate power of two.
    definitions.push(`float ldexp(float x, int e) {
      if (x == 0.0) return x;
      e = clamp(e, -512, 512);
      int a = clamp(e, -126, 127); int b = clamp(e - a, -126, 127); int c = e - a - b;
      return ((x * uintBitsToFloat(uint(a + 127) << 23u)) *
        uintBitsToFloat(uint(b + 127) << 23u)) * exp2(float(c));
    }`);
    for (const n of [2,3,4]) definitions.push('vec' + n + ' ldexp(vec' + n + ' x, ivec' + n + ' e) { return vec' + n + '(' +
      Array.from({ length: n }, (_, i) => 'ldexp(x.' + 'xyzw'[i] + ', e.' + 'xyzw'[i] + ')').join(', ') + '); }');
  }
  for (const signed of [false, true]) {
    const suffix = signed ? 'Snorm' : 'Unorm', scale = signed ? '127.0' : '255.0';
    if (new RegExp('\\bpack' + suffix + '4x8\\s*\\(').test(source)) definitions.push(
      'uint pack' + suffix + '4x8(vec4 x) { uvec4 b = uvec4(ivec4(floor(clamp(x, ' +
      (signed ? '-1.0' : '0.0') + ', 1.0) * ' + scale + ' + 0.5))) & uvec4(255u);' +
      ' return b.x | (b.y << 8u) | (b.z << 16u) | (b.w << 24u); }');
    if (new RegExp('\\bunpack' + suffix + '4x8\\s*\\(').test(source)) definitions.push(
      'vec4 unpack' + suffix + '4x8(uint p) { uvec4 b = uvec4(p, p >> 8u, p >> 16u, p >> 24u) & uvec4(255u); return ' +
      (signed ? 'max(vec4(ivec4(b << 24u) >> 24) / 127.0, vec4(-1.0))' : 'vec4(b) / 255.0') + '; }');
  }
  for (const n of [1,2,3,4]) if (new RegExp('\\bnoise' + n + '\\s*\\(').test(source)) {
    const result = n === 1 ? 'float' : 'vec' + n;
    for (const input of ['float','vec2','vec3','vec4']) definitions.push(result + ' noise' + n + '(' + input +
      ' x) { return ' + result + '(0.0); }');
  }
  // Preserve legal user overloads, including prototypes. Do not inject duplicate definitions.
  const signature = (params: string) => params.split(',').map(p => p.trim().split(/\s+/)
    .filter(t => !['const','in','out','inout','lowp','mediump','highp'].includes(t))[0]).join(',');
  const declared = new Map([...source.matchAll(/\b\w+\s+(\w+)\s*\(([^()]*)\)\s*(?:\{|;)/g)]
    .map(m => [m[1] + '(' + signature(m[2]) + ')', m[0].replace(/[;{]$/, ';')]));
  // Dependent vector wrappers precede source definitions. Forward-declare any user
  // overload replacing an injected helper, even when the source omitted a prototype.
  const prototypes: string[] = [];
  const generated = definitions.filter(d => {
    const m = /^\w+\s+(\w+)\s*\(([^()]*)\)/.exec(d)!;
    const prototype = declared.get(m[1] + '(' + signature(m[2]) + ')');
    if (!prototype) return true;
    prototypes.push(prototype); return false;
  });
  return [...prototypes, ...generated].join('\n') + '\n';
}
