// SPDX-License-Identifier: CC0-1.0
// Original independent known answers, never captured game shaders.
import type { GlslRegression } from './glsl-regressions';
const success = [64, 128, 191, 255];
export const builtinRegressions: GlslRegression[] = [];
const matrices = [
  { n: 2, m: [2,1,1,1], inv: [1,-1,-1,2] },
  { n: 3, m: [1,0,5,2,1,6,3,4,0], inv: [-24,20,-5,18,-15,4,5,-4,1] },
  { n: 4, m: [1,0,0,0,1,1,0,0,2,3,1,0,4,5,6,1], inv: [1,0,0,0,-1,1,0,0,1,-3,1,0,-5,13,-6,1] },
];
for (const { n, m, inv } of matrices) {
  const uniform = m.flatMap((_, c) => c < n ? [...m.slice(c*n, (c+1)*n), ...Array(4-n).fill(0)] : []);
  builtinRegressions.push({ name: 'inverse-mat' + n, expected: success, uniform,
    header: 'layout(std140) uniform bgt_u0 { mat' + n + ' m; };',
    body: 'mat' + n + ' a = inverse(m); bool valid = a == mat' + n + '(' + inv.map(x => x + '.0').join(',') +
      ') && m * a == mat' + n + '(1.0) && a * m == mat' + n + '(1.0);' +
      ' o = valid ? vec4(0.25,0.5,0.75,1.0) : vec4(0.0);' });
}
builtinRegressions.push({ name: 'inverse-evaluates-once', expected: success,
  header: 'int calls = 0; mat4 value() { calls++; return mat4(2.0); }',
  body: 'mat4 a = inverse(value()); o = a == mat4(0.5) && calls == 1 ? vec4(0.25,0.5,0.75,1.0) : vec4(0.0);' });

const validCase = (name: string, body: string, check: string, extra: Partial<GlslRegression> = {}) =>
  builtinRegressions.push({ name, body: body + '\no = (' + check + ') ? vec4(0.25,0.5,0.75,1.0) : vec4(0.0);', expected: success, ...extra });
for (const n of [2,3,4]) {
  validCase('determinant-mat' + n, 'mat' + n + ' m = mat' + n + '(2.0);', 'determinant(m) == ' + 2**n + '.0');
  for (const r of [2,3,4]) {
    const type = 'mat' + n + 'x' + r, transpose = 'mat' + r + 'x' + n;
    const values = Array.from({ length: n*r }, (_, i) => i+1);
    const transposed = Array.from({ length: n*r }, (_, i) => values[(i % n)*r + Math.floor(i/n)]);
    validCase('transpose-' + type,
      type + ' m = ' + type + '(' + values.map(x=>x+'.0') + '); ' + transpose + ' t = transpose(m);',
      't == ' + transpose + '(' + transposed.map(x=>x+'.0') + ') && transpose(t) == m');
    validCase('matrixCompMult-' + type,
      type + ' m = ' + type + '(' + values.map(x=>x+'.0') + ');',
      'matrixCompMult(m, m) == ' + type + '(' + values.map(x=>x*x+'.0') + ')');
    validCase('outerProduct-' + type, '',
      'outerProduct(vec' + r + '(' + Array.from({length:r},(_,i)=>i+1+'.0') + '), vec' + n + '(' +
      Array.from({length:n},(_,i)=>i+2+'.0') + ')) == ' + type + '(' +
      Array.from({length:n*r},(_,i)=>(Math.floor(i/r)+2)*(i%r+1)+'.0') + ')');
  }
}
for (const n of [1,2,3,4]) {
  const f = n===1 ? 'float' : 'vec'+n, i = n===1 ? 'int' : 'ivec'+n, u = n===1 ? 'uint' : 'uvec'+n;
  const eq = (a: string, b: string) => n===1 ? a+' == '+b : 'all(equal('+a+','+b+'))';
  validCase('bitcasts-shape'+n, f+' x = '+f+'(1.0);',
    eq('floatBitsToInt(x)',i+'(1065353216)')+' && '+eq('floatBitsToUint(x)',u+'(1065353216u)')+' && '+
    eq('intBitsToFloat('+i+'(-1082130432))',f+'(-1.0)')+' && '+eq('uintBitsToFloat('+u+'(1073741824u))',f+'(2.0)'));
  validCase('modf-shape'+n, f+' whole; '+f+' fraction = modf('+f+'(-2.75), whole);',
    eq('whole',f+'(-2.0)')+' && '+eq('fraction',f+'(-0.75)'));
  validCase('frexp-ldexp-shape'+n, i+' exponent; '+f+' fraction = frexp('+f+'(-6.0), exponent);',
    eq('exponent',i+'(3)')+' && '+eq('fraction',f+'(-0.75)')+' && '+eq('ldexp(fraction, exponent)',f+'(-6.0)'));
  validCase('trunc-roundEven-shape'+n,'',eq('trunc('+f+'(-2.75))',f+'(-2.0)')+' && '+
    eq('roundEven('+f+'(2.5))',f+'(2.0)')+' && '+eq('roundEven('+f+'(-1.5))',f+'(-2.0)'));
}
validCase('modf-output-swizzle-index', 'vec4 v = vec4(9.0); float f = modf(-3.25, v.y); vec2 r = modf(vec2(1.5,-2.75), v.wz);',
  'v == vec4(9.0,-3.0,-2.0,1.0) && r == vec2(0.5,-0.75) && f == -0.25');
validCase('frexp-output-side-effect', 'ivec3 e = ivec3(99); int i = 0; float r = frexp(8.0, e[i++]);',
  'e == ivec3(4,99,99) && i == 1 && r == 0.5');
validCase('isnan-isinf-runtime', 'vec4 v = texelFetch(bgt_t0, ivec2(0), 0);',
  'isnan(v) == bvec4(true,false,true,false) && isinf(v) == bvec4(false,true,false,true) && isnan(v.x) && isinf(v.w) && !isinf(1.0) && !isnan(1.0)',
  { header: 'uniform sampler2D bgt_t0;', texture: true, invalid: true });
for (const [suffix, input, packed, unpacked] of [
  ['Unorm2x16','vec2(-1.0,2.0)','0xffff0000u','vec2(0.0,1.0)'],
  ['Snorm2x16','vec2(-2.0,2.0)','0x7fff8001u','vec2(-1.0,1.0)'],
  ['Half2x16','vec2(1.5,-2.0)','0xc0003e00u','vec2(1.5,-2.0)'],
  ['Unorm4x8','vec4(-1.0,1.0,0.0,1.0)','0xff00ff00u','vec4(0.0,1.0,0.0,1.0)'],
  ['Snorm4x8','vec4(-2.0,2.0,0.0,-1.0)','0x81007f81u','vec4(-1.0,1.0,0.0,-1.0)'],
]) validCase('pack-unpack-'+suffix, 'uint bits = pack'+suffix+'('+input+');',
  'bits == '+packed+' && unpack'+suffix+'('+packed+') == '+unpacked);
validCase('half-signed-zero', '', 'packHalf2x16(vec2(0.0,-0.0)) == 0x80000000u && floatBitsToUint(unpackHalf2x16(0x80000000u).y) == 0x80000000u');

// All texture variants below have nonzero coordinates, projection divisors and signed offsets.
// LOD and gradients select distinct mip contents; the expected texel is computed independently here.
for (const textureKind of ['float2d','float3d','floatArray','int2d','uint2d','int3d','uint3d','intArray','uintArray'] as const) {
  const volume = textureKind.endsWith('3d'), array = textureKind.endsWith('Array');
  const integer = textureKind.startsWith('int') || textureKind.startsWith('uint');
  const prefix = textureKind.startsWith('uint') ? 'u' : textureKind.startsWith('int') ? 'i' : '';
  const header = 'uniform ' + prefix + 'sampler' + (volume ? '3D' : array ? '2DArray' : '2D') + ' bgt_t0;';
  const dim = volume ? 3 : 2, coord = volume || array ? 'vec3(0.375,0.375,0.75)' : 'vec2(0.375)';
  const offset = 'ivec' + dim + '(1,-1' + (volume ? ',-1' : '') + ')';
  for (const name of ['texture','textureLod','textureGrad','texelFetch','textureSize','textureOffset','textureLodOffset','textureGradOffset','texelFetchOffset',
    ...(!array ? ['textureProj','textureProjLod','textureProjGrad','textureProjOffset','textureProjLodOffset','textureProjGradOffset'] : [])]) {
    const projected = name.includes('Proj'), hasOffset = name.endsWith('Offset'), fetch = name.startsWith('texelFetch'), size = name === 'textureSize';
    const level = name.includes('Lod') || name.includes('Grad') || fetch || size ? 1 : 0;
    const uv = fetch ? 'ivec' + (volume || array ? 3 : 2) + '(0,0' + (volume || array ? ',0' : '') + ')' :
      projected ? (volume ? 'vec4(vec3(0.375,0.375,0.75)*2.0,2.0)' : 'vec4(0.75,0.75,9.0,2.0)') : coord;
    const args = size ? ['1'] : [uv];
    if (fetch || name.includes('Lod')) args.push(fetch ? '1' : '1.0');
    if (name.includes('Grad')) args.push('vec'+dim+'(0.5,0.0'+(volume?',0.0':'')+')', 'vec'+dim+'(0.0,0.5'+(volume?',0.0':'')+')');
    if (hasOffset) args.push(fetch && volume ? 'ivec3(1,-1,0)' : offset);
    let x = fetch ? 0 : level ? 0 : 1, y = x, z = fetch ? 0 : volume ? level ? 0 : 1 : array ? 1 : 0;
    if (hasOffset) { x++; y = Math.max(0,y-1); if (volume) z=Math.max(0,z-1); }
    // texelFetch out-of-range is undefined: use an in-range y before adding negative offsets.
    if (fetch && hasOffset) { args[0]='ivec'+(volume||array?3:2)+'(0,1'+(volume||array?',0':'')+')'; }
    const expected = [16+level*64+x*8,32+y*16,48+z*32,255];
    const sample = name+'(bgt_t0,'+args.join(',')+')';
    const check = size ? sample+' == ivec'+(array||volume?3:2)+'(2,2'+(array?',2':volume?',1':'')+')' :
      integer ? sample+' == '+prefix+'vec4('+expected.map(x=>x+(prefix==='u'?'u':''))+')' :
        'all(lessThan(abs('+sample+' - vec4('+expected.map(x=>x+'.0')+')/255.0), vec4(0.00001)))';
    validCase('texture-'+textureKind+'-'+name,'',check,{ header,texture:true,textureKind, sampler:[1,0,0,1,0,0,0,0,7,0,0x42000000] });
  }
}

for (const result of [1,2,3,4]) for (const input of ['float','vec2','vec3','vec4']) {
  const output = result === 1 ? 'float' : 'vec' + result;
  validCase('noise'+result+'-'+input,'', 'noise'+result+'('+input+'(1.25)) == '+output+'(0.0)');
}
for (const name of ['texture','textureProj','textureOffset','textureProjOffset','textureGrad','textureGradOffset','textureProjGrad','textureProjGradOffset','textureSize']) {
  for (const linear of [false,true]) {
    const projected=name.includes('Proj'), offset=name.endsWith('Offset'), grad=name.includes('Grad');
    const args=[projected ? 'vec4(0.75,0.75,1.0,2.0)' : 'vec3(0.375,0.375,0.5)'];
    if(grad)args.push('vec2(0.0)','vec2(0.0)');
    if(offset)args.push('ivec2(1,0)');
    const size=name==='textureSize';
    validCase('shadow-'+name+'-'+linear,'',size ? 'textureSize(bgt_t0,1) == ivec2(2)' :
      'abs('+name+'(bgt_t0,'+args.join(',')+') - '+(offset?'1.0':'0.0')+') < 0.00001',
      { header:'uniform sampler2DShadow bgt_t0;',texture:true,textureKind:'shadow',sampler:[1,Number(linear),Number(linear),0,0,0,0,1,1,0,0x42000000] });
  }
}

validCase('scalar-geometric', '', 'length(-3.0) == 3.0 && distance(-2.0,3.0) == 5.0 && dot(2.0,3.0) == 6.0 && normalize(-4.0) == -1.0 && faceforward(2.0,3.0,-1.0) == 2.0 && reflect(2.0,1.0) == -2.0 && refract(-1.0,1.0,0.5) == -1.0');
validCase('hyperbolic', '', 'abs(sinh(0.0)) < 0.00001 && abs(cosh(0.0)-1.0) < 0.00001 && abs(tanh(0.0)) < 0.00001 && abs(asinh(0.0)) < 0.00001 && abs(acosh(1.0)) < 0.00001 && abs(atanh(0.0)) < 0.00001');
validCase('modf-frexp-zero', 'float w; int e; float a = modf(0.0,w); float b = frexp(0.0,e);', 'a == 0.0 && w == 0.0 && b == 0.0 && e == 0 && ldexp(0.0,200) == 0.0');

validCase('pack-interior-bits', '', 'packUnorm2x16(vec2(0.25,0.75)) == 0xbfff4000u && packSnorm2x16(vec2(-0.25,0.75)) == 0x5fffe000u && packUnorm4x8(vec4(0.25,0.5,0.75,1.0)) == 0xffbf8040u && packSnorm4x8(vec4(-0.25,0.25,-0.75,0.75)) == 0x5fa120e0u');
validCase('unpack-snorm-minima', '', 'unpackSnorm2x16(0x80008000u) == vec2(-1.0) && unpackSnorm4x8(0x80808080u) == vec4(-1.0)');
validCase('half-subnormal', '', 'packHalf2x16(vec2(0.000000059604644775390625,0.00006103515625)) == 0x04000001u && unpackHalf2x16(0x04000001u) == vec2(0.000000059604644775390625,0.00006103515625)');
validCase('noise-evaluates-once','float n = noise1(value());','n == 0.0 && calls == 1', {header:'int calls=0; float value(){calls++; return 1.0;}'});

for(const name of ['texture','textureLod','textureGrad','texelFetch','textureSize','textureOffset','textureLodOffset','textureGradOffset','texelFetchOffset','textureProj','textureProjLod','textureProjGrad','textureProjOffset','textureProjLodOffset','textureProjGradOffset']) {
  const offset=name.endsWith('Offset'),fetch=name.startsWith('texelFetch'),size=name==='textureSize';
  const args=[fetch ? (offset?'ivec2(0,1)':'ivec2(0)') : name.includes('Proj')?'vec4(0.75,0.75,9.0,2.0)':'vec2(0.375)'];
  if(fetch||name.includes('Lod'))args.push(fetch?'1':'1.0');
  if(name.includes('Grad'))args.push('vec2(0.5,0.0)','vec2(0.0,0.5)');
  if(offset)args.push('ivec2(1,-1)');
  validCase('depth-color-'+name,'',size?'textureSize(bgt_t0,1) == ivec2(2)':name+'(bgt_t0,'+args.join(',')+') == vec4('+(offset && (fetch || name.includes('Lod') || name.includes('Grad'))?'0.75':'0.25')+',0.0,0.0,1.0)',
    {header:'uniform sampler2D bgt_t0;',texture:true,textureKind:'depthColor',sampler:[1,0,0,1,0,0,0,0,7,0,0x42000000]});
}
for(const textureKind of ['float2d','int2d','uint2d'] as const) for(const name of ['texture','textureProj','textureOffset','textureProjOffset']) {
  const prefix=textureKind==='int2d'?'i':textureKind==='uint2d'?'u':'';
  const args=[name.includes('Proj')?'vec4(uv*2.0,9.0,2.0)':'uv'];
  if(name.endsWith('Offset'))args.push('ivec2(1,-1)');args.push('1.0');
  const expected=name.endsWith('Offset')?[88,32,48,255]:[80,32,48,255];
  const sample=name+'(bgt_t0,'+args.join(',')+')';
  validCase('texture-bias-'+textureKind+'-'+name,'vec2 uv=vec2(0.375)+vec2((bgt_frag_coord.x-3.5)*0.25,0.0);',
    prefix?sample+' == '+prefix+'vec4('+expected.map(x=>x+(prefix==='u'?'u':''))+')':
      'all(lessThan(abs('+sample+'-vec4('+expected.map(x=>x+'.0')+')/255.0),vec4(0.00001)))',
    {header:'uniform '+prefix+'sampler2D bgt_t0;',texture:true,textureKind,sampler:[1,0,0,1,0,0,0,0,7,0,0x42000000]});
}

// Review regressions: sampler-clamped LOD controls min/mag selection before mip choice.
const f32word = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0];
for (const mip of [0,1,2]) {
  validCase('shadow-clamped-minfilter-'+mip, '',
    'abs(textureGradOffset(bgt_t0,vec3(0.5,0.5,0.5),vec2(0.125,0.0),vec2(0.0,0.125),ivec2(0)) - 0.5) < 0.00001',
    {header:'uniform sampler2DShadow bgt_t0;',texture:true,textureKind:'shadow',sampler:[1,1,0,mip,0,0,0,1,1,f32word(1),f32word(32)]});
  validCase('shadow-clamped-magfilter-'+mip, '',
    'abs(textureGradOffset(bgt_t0,vec3(0.5,0.5,0.5),vec2(0.5,0.0),vec2(0.0,0.5),ivec2(0)) - 0.5) < 0.00001',
    {header:'uniform sampler2DShadow bgt_t0;',texture:true,textureKind:'shadow',sampler:[1,0,1,mip,0,0,0,1,1,0,0]});
  validCase('depth-clamped-minfilter-'+mip, '',
    'abs(textureGradOffset(bgt_t0,vec2(0.5),vec2(0.125,0.0),vec2(0.0,0.125),ivec2(0)).x - 0.5) < 0.00001',
    {header:'uniform sampler2D bgt_t0;',texture:true,textureKind:'depthColor',sampler:[1,1,0,mip,0,0,0,0,7,f32word(1),f32word(32)]});
  for (const name of ['texture','textureOffset','textureLod','textureGrad']) {
    const tail = name === 'textureOffset' ? ',ivec2(0)' : name === 'textureLod' ? ',0.0' : name === 'textureGrad' ? ',vec2(0.125,0.0),vec2(0.0,0.125)' : '';
    validCase('depth-minlod-'+mip+'-'+name, '', name+'(bgt_t0,vec2(0.375,0.125)'+tail+') == vec4(0.25,0.0,0.0,1.0)',
      {header:'uniform sampler2D bgt_t0;',texture:true,textureKind:'depthColor',sampler:[1,0,0,mip,0,0,0,0,7,f32word(1),f32word(32)]});
  }
}
for (const prototype of [false,true]) {
  validCase('user-frexp-'+prototype, 'int e; float f=frexp(2.0,e);', 'f == 2.0 && e == 3',
    {header:(prototype?'float frexp(float x,out int e);\n':'')+'float frexp(float x,out int e){e=3;return x;}'});
  validCase('user-ldexp-'+prototype, '', 'ldexp(2.0,3) == 5.0',
    {header:(prototype?'float ldexp(float x,int e);\n':'')+'float ldexp(float x,int e){return x+float(e);}'});
}
for (const textureKind of ['int2d','uint2d','shadow','depthColor'] as const) {
  const shadow = textureKind === 'shadow', depth = textureKind === 'depthColor';
  const prefix = textureKind === 'int2d' ? 'i' : textureKind === 'uint2d' ? 'u' : '';
  const sample='textureGradOffset(bgt_t0,'+(shadow?'vec3(0.375,0.375,0.5)':'vec2(0.375)')+',vec2(0.0),vec2(0.0),ivec2(0))';
  validCase('zero-footprint-'+textureKind,'',shadow?sample+' == 0.0':depth?sample+' == vec4(0.25,0.0,0.0,1.0)':
    sample+' == '+prefix+'vec4(24,48,48,255)',
    {header:'uniform '+prefix+'sampler2D'+(shadow?'Shadow':'')+' bgt_t0;',texture:true,textureKind,sampler:[1,0,0,1,0,0,0,Number(shadow),shadow?1:7,0,f32word(32)]});
}
validCase('offset-constant-provenance','const ivec3 a=ivec3(1,-1,0); const int b=abs(-1);',
  'textureOffset(bgt_t0,vec2(0.375),a.xy*ivec2(b)) == ivec4(32,32,48,255)',
  {header:'uniform isampler2D bgt_t0;',texture:true,textureKind:'int2d',sampler:[1,0,0,0,0,0,0,0,7,0,f32word(32)]});

// Negative compile cases, followed by a legal draw in the native tests to detect context poisoning.
export const invalidOffsetRegressions: GlslRegression[] = [];
for (const sampler of ['sampler2D','isampler2D','sampler2DShadow']) {
  const shadow=sampler.endsWith('Shadow');
  for (const name of ['textureOffset','textureProjOffset','textureLodOffset','textureProjLodOffset','textureGradOffset','textureProjGradOffset','texelFetchOffset']) {
    if (shadow && (name.includes('Lod') || name.startsWith('texel'))) continue;
    const fetch=name.startsWith('texel'), proj=name.includes('Proj'), grad=name.includes('Grad');
    const coord=fetch?'ivec2(0)':proj?'vec4(0.75,0.75,1.0,2.0)':shadow?'vec3(0.375,0.375,0.5)':'vec2(0.375)';
    const tail=fetch?',0':name.includes('Lod')?',0.0':grad?',vec2(0.0),vec2(0.0)':'';
    invalidOffsetRegressions.push({name:'nonconstant-'+sampler+'-'+name,header:'uniform '+sampler+' bgt_t0;',
      body:'ivec2 delta=ivec2(int(bgt_frag_coord.x),0); '+name+'(bgt_t0,'+coord+tail+',delta); o=vec4(1.0);',
      expected:[],rejection:'constant expression'});
  }
}

// These seven newly-added depth cases exercise an explicit reviewer-approved WebGL approximation,
// not cross-backend linear-filter equality. Keep their raw values independently observable.
export const depthApproximationRegressions = builtinRegressions.filter(c=>
  c.name.startsWith('depth-clamped-minfilter-') || c.name.startsWith('depth-minlod-2-'));
for (const c of depthApproximationRegressions) {
  c.body = c.name.startsWith('depth-clamped') ?
    'o=textureGradOffset(bgt_t0,vec2(0.5),vec2(0.125,0.0),vec2(0.0,0.125),ivec2(0));' :
    'o='+c.body.match(/texture(?:Offset|Lod|Grad)?\(bgt_t0,.*?(?= ==)/)![0]+';';
  c.expected = [64,0,0,255];
  builtinRegressions.splice(builtinRegressions.indexOf(c),1);
}

// Follow-up edge controls: fixed NONE LOD is floored before filter selection; source prototypes
// must retain user return types and parameter qualifiers, not the portable-extra defaults.
validCase('shadow-none-fractional-minlod','',
  'textureGradOffset(bgt_t0,vec3(0.5,0.5,0.5),vec2(0.5,0.0),vec2(0.0,0.5),ivec2(0)) == 0.5',
  {header:'uniform sampler2DShadow bgt_t0;',texture:true,textureKind:'shadow',sampler:[1,0,1,0,0,0,0,1,1,f32word(0.75),f32word(32)]});
validCase('user-frexp-inout','int e=2; float x=frexp(4.0,e);','x == 4.0 && e == 5',
  {header:'float frexp(float x,inout int e){e+=3;return x;}'});
validCase('user-frexp-int-return','int e; int x=frexp(4.0,e);','x == 7 && e == 3',
  {header:'int frexp(float x,out int e){e=3;return 7;}'});
validCase('user-ldexp-int-return','','ldexp(2.0,3) == 7',
  {header:'int ldexp(float x,int e){return 7;}'});

// Legal non-literal constant offsets must reach native WGSL const-expression operands, not let/helper calls.
const constantOffsets = [
  ['float','const float k=1.0;','ivec2(int(k),-int(k))'],
  ['vector-float','const vec2 k=vec2(1.0,-1.0);','ivec2(k)'],
  ['swizzle-index','const ivec2 k=ivec2(-1,1);','ivec2(k.yx[0],k.yx[1])'],
  ['scalar-dot','','ivec2(int(dot(1.0,1.0)),-1)'],
  ['mod','','ivec2(int(mod(5.0,2.0)),-1)'],
  ['nested','','ivec2(int(mod(dot(5.0,1.0),2.0)),-1)'],
];
for (const c of builtinRegressions.filter(c=>/^texture-float2d-.*Offset$/.test(c.name))) {
  for (const [suffix,declaration,expression] of constantOffsets) builtinRegressions.push({
    ...c,name:c.name+'-const-'+suffix,body:declaration+' '+c.body.replace('ivec2(1,-1)',expression),
  });
}
