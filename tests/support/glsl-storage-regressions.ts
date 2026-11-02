// SPDX-License-Identifier: CC0-1.0
// Independently authored GLSL 3.30/ES 3.00 contract tests. No captured shader text.
import type { GlslRegression } from './glsl-regressions';
const pass = [64, 128, 191, 255];
function check(name: string, body: string, valid: string, header = ''): GlslRegression {
  return { name, header, expected: pass, body: `${body}\nbool valid = ${valid}; o = valid ? vec4(0.25, 0.5, 0.75, 1.0) : vec4(0.0);` };
}
export const storageRegressions: GlslRegression[] = [
  check('signed-integer-minimum-literal-and-fold', `
    int a=0x80000000; int b=-2147483648; int c=true ? int(0x80000000u) : 0;
    uint runtime=0x80000000u; int d=int(runtime);`,
    'a == d && b == d && c == d && uint(a) == 0x80000000u'),
  check('user-and-builtin-overload-coexistence', `
    int user=mix(1,2,true); vec4 builtin=mix(vec4(0.0),vec4(1.0),bvec4(true));
    float a=0.25; vec2 b=vec2(0.0); adjust(a); adjust(b);`,
    'user == 2 && builtin == vec4(1.0) && a == 0.75 && b == vec2(0.25,0.5)',
    'int mix(int x,int y,bool p){return p ? y : x;} void adjust(inout float a){a += 0.5;} void adjust(out vec2 b){b=vec2(0.25,0.5);}'),
  check('by-value-overload-indexed-swizzle', 'vec4 v=vec4(0.0); int i=1; float a=put(v.wy[i++],0.5);',
    'a == 0.5 && i == 2', 'void put(out float a){a=0.25;} float put(float a,float b){return a+b;}'),
  check('indexed-struct-member-not-swizzle', 'Indexed s; int i=0; put(s.rgba[i++]); put(s.xy[i++]);',
    's.rgba[0] == 0.25 && s.xy[1] == 0.25 && i == 2',
    'struct Indexed { float rgba[2]; float xy[2]; }; void put(out float a){a=0.25;}'),
  check('integer-bases-suffix-width', `
    const int extent = (0X10 >> 02) - 01;
    int values[extent]; values[2] = 7;
    uint a = uint(0x1abcdef); uint b = 0XfEdCbA98U; uint c = 0377u;
    uint high = 0x80000001u; high *= 3u;
    uint wrap = 4294967295U; wrap += 1u;
    const uint folded = (0xffffffffu + 2u) * 3u;
    int signedHex = 0Xffffffff; int signedOctal = 037777777777;`,
  'a == 28036591u && b == 4275878552u && c == 255u && high == 0x80000003u && wrap == 0u && folded == 3u && values[2] == 7 && signedHex == -1 && signedOctal == -1'),
  check('ternary-selected-inout-and-nesting', `
    uint seed=1u; float x = bgt_frag_coord.x > 0.0 ? bump(seed) : bump(seed);
    float y = false ? bump(seed) : (true ? bump(seed) : bump(seed));`,
  'seed == 3u && x == 2.0 && y == 3.0',
  'float bump(inout uint s) { s += 1u; return float(s); }'),
  check('ternary-forwarded-parameter', 'uint s=1u; float a=outer(s);', 's == 3u && a == 3.0',
    `float bump(inout uint s) { s += 2u; return float(s); }
     float outer(inout uint s) { return true ? bump(s) : 9.0; }`),
  check('inout-swizzle-member-element', `
    Box b; b.p=vec4(0.0); b.values[0]=0.0; b.values[1]=0.0;
    int i=0; put(b.p.wy); add(b.values[i++]); add(b.values[i++]);`,
  'b.p == vec4(0.0, 0.5, 0.0, 0.25) && b.values[0] == 0.25 && b.values[1] == 0.25 && i == 2',
    `struct Box { vec4 p; float values[2]; };
     void put(out vec2 p) { p=vec2(0.25,0.5); }
     void add(inout float f) { f += 0.25; }`),
  check('inout-alias-copy-in', 'float x=0.0; float sum=both(x,x);',
    'sum == 0.75 && (x == 0.25 || x == 0.5)',
    'float both(inout float a, inout float b) { a += 0.25; b += 0.5; return a+b; }'),
  check('inout-global-copy-out', 'totalShared=0.25; float a=mutate(totalShared);', 'totalShared == 0.5 && a == 0.5',
    `float totalShared=0.0;
     float mutate(inout float p) { totalShared=0.75; p += 0.25; return p; }`),
  check('inout-argument-lvalue-frozen', 'float a[2]=float[2](0.0,0.0); int i=0; write(a[i],i);',
    'a[0] == 0.75 && a[1] == 0.0 && i == 1',
    'void write(out float a, inout int index) { index=1; a=0.75; }'),
  check('conditional-loop-evaluation', `
    int n=0; int ticks=0;
    while (n < 3 ? advance(n) : false) { ticks += 1; }
    int steps=0; for(int i=0; i < 3; advance(i)) { steps += 1; continue; }`,
    'n == 3 && ticks == 3 && steps == 3', 'bool advance(inout int n) { n += 1; return true; }'),
  check('short-circuit-inout', 'int n=0; bool a=false && advance(n); bool b=true || advance(n); bool c=true && advance(n);',
    'n == 1 && !a && b && c', 'bool advance(inout int n) { n += 1; return true; }'),
  check('mutable-in-parameter', 'float f=0.25; float r=copy(f);', 'f == 0.25 && r == 0.75',
    'float copy(in float f) { f += 0.5; return f; }'),
  check('aggregate-side-effect-single-evaluation', `
    bool eq = create() == create();
    bool ne = create() != create();`, 'eq && !ne && calls == 4',
    `int calls=0;
     struct Item { vec2 a; mat2 b; float c[2]; };
     Item create() { calls += 1; Item i; i.a=vec2(1.0,2.0); i.b=mat2(2.0); i.c[0]=3.0; i.c[1]=4.0; return i; }`),
  check('array-struct-aggregate-equality', `
    Leaf a[2]; Leaf b[2];
    a[0].p=vec3(1.0); a[0].n=2; a[1]=a[0]; b=a;
    bool equal0 = a == b; b[1].n=3; bool different = a != b;
    int loops=0; while(a == a && loops < 1) { loops += 1; }`,
    'equal0 && different && !(a == b) && loops == 1', 'struct Leaf { vec3 p; int n; };'),
];
for (const [prefix, ctor] of [['float','vec'], ['int','ivec'], ['uint','uvec'], ['bool','bvec']]) {
  for (const n of [2,3,4]) {
    const t = ctor+n, zero = prefix === 'float' ? '0.0' : prefix === 'uint' ? '0u' : prefix === 'bool' ? 'false' : '0';
    const one = prefix === 'float' ? '1.0' : prefix === 'uint' ? '1u' : prefix === 'bool' ? 'true' : '1';
    storageRegressions.push(check(`aggregate-${t}-contexts`, `
      ${t} a=${t}(${zero}); ${t} b=a; bool same = a == b;
      b[${n-1}]=${one}; bool diff = a != b; int hit=0;
      if (a == a) hit += 1; while(a != b && hit < 2) hit += 1;
      int chosen=(a == b) ? 3 : 4;`, 'same && diff && hit == 2 && chosen == 4'));
  }
}
for (const t of ['mat2','mat3','mat4','mat2x3','mat2x4','mat3x2','mat3x4','mat4x2','mat4x3']) {
  const columns = Number(t[3]), rows=Number(t[5] ?? t[3]);
  const column = `vec${rows}(1.0)`;
  storageRegressions.push(check(`aggregate-${t}-equality`, `
    ${t} a=${t}(${Array.from({length:columns},()=>column).join(',')}); ${t} b=a;
    bool eq=a == b; b[${columns-1}][${rows-1}]=2.0;`, 'eq && a != b && !(a == b)'));
}
storageRegressions.push(
  check('non-square-diagonal-conversion', `mat3x2 a=mat3x2(2.0); mat4x2 b=mat4x2(a); mat4 c=mat4(b);`,
    'a[0].x == 2.0 && a[1].y == 2.0 && a[2] == vec2(0.0) && b[3] == vec2(0.0) && c[3].w == 1.0'),
  check('swizzle-index-and-struct-names', `Named n; n.xy=0.0; n.rgba=0.0; n.v=vec4(0.0); int i=1; put(n.xy); put(n.rgba); put2(n.v.wy); put(n.v.x); i++;`,
    'n.xy == 0.25 && n.rgba == 0.25 && n.v == vec4(0.25,0.5,0.0,0.25) && i == 2',
    'struct Named { float xy; float rgba; vec4 v; }; void put(out float f) { f=0.25; } void put2(out vec2 f) { f=vec2(0.25,0.5); }'),
  check('vector-side-effect-equality', `bool eq=makeV() == makeV(); bool ne=makeV() != makeV();`, 'eq && !ne && calls == 4',
    'int calls=0; vec3 makeV(){calls += 1; return vec3(1.0,2.0,3.0);}'),
  check('reserved-wgsl-identifier', 'float shared=0.25; shared += 0.5;', 'shared == 0.75'),
  check('constant-ternary-wrap-and-scopes', `const uint k=1u; uint v=0u; { uint k=3u; v=k+1u; } uint a=run(k);`, 'v == 4u && a == 2u && choice == 1u',
    'const uint choice = true ? 0xffffffffu+2u : 1u/0u; uint run(uint k) { return k + 1u; }'),
);
const paddedMatrices = check('non-square-std140-uniforms', `
  mat3x2 a=block.a; mat4x2 b=block.b[1];`,
  'a == mat3x2(vec2(1.0,2.0),vec2(3.0,4.0),vec2(5.0,6.0)) && b[3] == vec2(21.0,22.0)',
  'layout(std140) uniform bgt_u0 { mat3x2 a; mat4x2 b[2]; } block;');
paddedMatrices.uniform = Array.from({length:11}, (_,i) => [i*2+1,i*2+2,0,0]).flat();
const rejected = check('webgl-indexed-swizzle-out-boundary', 'vec4 v=vec4(0.0); int i=1; put(v.wy[i++]);',
  'v == vec4(0.0,0.25,0.0,0.0) && i == 2', 'void put(out float f) { f=0.25; }');
rejected.webglRejection = 'out/inout argument indexes a multi-component swizzle';
// A normal, unrelated program immediately follows the deliberate rejection, proving native containment.
export const webglBoundaryRegression = rejected;
storageRegressions.push(paddedMatrices);
storageRegressions.push({ name:'divergent-implicit-derivative-policy', expected:pass, texture:true,
  header:'uniform sampler2D bgt_t0;', body:`
    vec4 value=vec4(0.0); int chosen=int(bgt_frag_coord.x);
    for(int i=0;i<8;i++) { if(i == chosen) { value=texture(bgt_t0,vec2(0.75,0.25)); break; } }
    o=value;` });
