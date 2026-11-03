// Engine-independent GLSL 3.30 / ES 3.00 texture builtins for existing ABI storage classes.
import type { BuiltinExpr as Expr } from './glsl-builtins';
interface Context {
  stage: number;
  save(value: Expr): Expr;
  helper(source: string): void;
  temp(prefix: string): string;
  fail(message: string): never;
  samplers: ReadonlyMap<number, readonly number[]>;
}
const names = /^(?:texture(?:Size|Proj|Lod|Offset|ProjOffset|ProjLod|LodOffset|ProjLodOffset|Grad|GradOffset|ProjGrad|ProjGradOffset)?|texelFetch(?:Offset)?)$/;
const literal = (x: number) => Number.isInteger(x) ? x + '.0' : String(x);
const float = (x: number) => new Float32Array(new Uint32Array([x]).buffer)[0];
export function textureBuiltin(original: string, actuals: Expr[], ctx: Context): Expr | undefined {
  if (!names.test(original)) return undefined;
  const args = [...actuals], t = args[0];
  if (!t || !/^(?:texture[IU]?(?:3d|2darray)?|depth|depthColor)$/.test(t.type)) ctx.fail(original + ': requires supported bgt_tS sampler');
  let name = original;
  const volume = t.type.endsWith('3d'), array = t.type.endsWith('2darray'), shadow = t.type === 'depth';
  const integer = /^texture[IU]/.test(t.type);
  const dim = volume ? 3 : 2, coordDim = array || volume || shadow ? 3 : 2;
  const result = shadow ? 'f32' : t.type.startsWith('textureI') ? 'vec4i' : t.type.startsWith('textureU') ? 'vec4u' : 'vec4f';
  const projected = name.includes('Proj'), hasOffset = name.endsWith('Offset');
  name = name.replace('Proj', '').replace('Offset', '');
  const counts = name === 'texture' ? [2,3] : [name === 'textureGrad' ? 4 : name === 'textureSize' ? 2 : 3];
  if (!counts.includes(args.length - Number(hasOffset))) ctx.fail(original + ': invalid argument count');
  let offset: Expr | undefined;
  if (hasOffset) offset = args.splice(name === 'texture' ? 2 : name === 'textureGrad' ? 4 : 3, 1)[0];
  if (offset && offset.type !== 'vec' + dim + 'i') ctx.fail(original + ': offset must have matching integer dimensions');
  if (offset && !offset.constant) ctx.fail(original + ': offset must be a constant expression');
  if (projected) {
    if (array || !args[1] || !(volume || shadow ? args[1].type === 'vec4f' : /^vec[34]f$/.test(args[1].type)))
      ctx.fail(original + ': invalid projective coordinates/sampler');
    const p = ctx.save(args[1]), divisor = p.type === 'vec4f' ? 'w' : 'z';
    args[1] = { code: '(' + p.code + (volume || shadow ? '.xyz' : '.xy') + ' / ' + p.code + '.' + divisor + ')', type: 'vec' + coordDim + 'f' };
  }
  if (name === 'textureSize') {
    if (args[1].type !== 'i32') ctx.fail(original + ': level must be int');
    return { code: array ? 'vec3i(vec2i(textureDimensions(' + t.code + ', ' + args[1].code + ')), i32(textureNumLayers(' + t.code + ')))' :
      'vec' + dim + 'i(textureDimensions(' + t.code + ', ' + args[1].code + '))', type: 'vec' + (array ? 3 : dim) + 'i' };
  }
  const fetch = name === 'texelFetch';
  if (args[1].type !== 'vec' + (fetch && shadow ? 2 : coordDim) + (fetch ? 'i' : 'f')) ctx.fail(original + ': invalid coordinate type');
  if (fetch && shadow) ctx.fail(original + ': shadow samplers do not support texelFetch');
  if (fetch && args[2].type !== 'i32' || name === 'textureLod' && args[2].type !== 'f32' ||
    name === 'texture' && args[2] && args[2].type !== 'f32') ctx.fail(original + ': invalid LOD/bias type');
  if (name === 'textureGrad' && args.slice(2).some(a => a.type !== 'vec' + dim + 'f')) ctx.fail(original + ': invalid gradient type');
  if (ctx.stage === 1 && name === 'texture' && args.length !== 2) ctx.fail('texture bias is only available in fragment shaders');
  const uv = ctx.save(args[1]);
  const wrapResult = (code: string): Expr => ({ code: t.type === 'depthColor' ? 'vec4f(' + code + ', 0.0, 0.0, 1.0)' : code, type: result });
  if (fetch) {
    const p = offset ? '(' + uv.code + ' + ' + (array ? 'vec3i(' + offset.code + ', 0)' : offset.code) + ')' : uv.code;
    return wrapResult('textureLoad(' + t.code + ', ' + p + (array ? '.xy, ' + uv.code + '.z' : '') + ', ' + args[2].code + ')');
  }
  const layer = array ? ', clamp(i32(floor(' + uv.code + '.z + 0.5)), 0, i32(textureNumLayers(' + t.code + ')) - 1)' : '';
  if (integer) return integerSample(t, uv, name, args, offset, ctx);
  if (shadow) {
    // Implicit comparison (with optional bias) needs sampler-exact mip choice. No explicit-level
    // comparison builtin exists in WGSL except fixed level zero; use compare-before-filter helpers.
    if (name === 'texture' && args.length === 2 && !offset) return { code:
      (ctx.stage === 1 ? 'textureSampleCompareLevel' : 'textureSampleCompare') + '(' + t.code + ', ' + t.code + '_sampler, ' + uv.code + '.xy, ' + uv.code + '.z)', type: 'f32' };
    return shadowSample(t, uv, name, args, offset, ctx);
  }
  const fn = name === 'textureLod' || ctx.stage === 1 && name === 'texture' ? 'textureSampleLevel' :
    name === 'textureGrad' ? 'textureSampleGrad' : args.length === 3 ? 'textureSampleBias' : 'textureSample';
  const tail = args.slice(2).map(a => a.code);
  if (ctx.stage === 1 && name === 'texture') tail.push('0.0');
  if (offset) tail.push(offset.code);
  return wrapResult(fn + '(' + t.code + ', ' + t.code + '_sampler, ' + uv.code + (array ? '.xy' : '') + layer +
    (tail.length ? ', ' + tail.join(', ') : '') + ')');
}
function sampler(t: Expr, ctx: Context) {
  return ctx.samplers.get(Number(t.code.match(/bgt_t([0-7])/)![1])) ?? [0,0,0,0,0,0,0,0,7,0,0x42000000];
}
function lodExpression(t: Expr, uv: Expr, name: string, args: Expr[], ctx: Context) {
  if (name === 'textureLod') return args[2].code;
  if (ctx.stage === 1 && name === 'texture') return '0.0';
  const dim = t.type.endsWith('3d') ? 3 : 2;
  const size = 'vec' + dim + 'f(textureDimensions(' + t.code + ', 0))';
  const dx = name === 'textureGrad' ? args[2].code : 'dpdx(' + uv.code + (dim === 3 ? '' : '.xy') + ')';
  const dy = name === 'textureGrad' ? args[3].code : 'dpdy(' + uv.code + (dim === 3 ? '' : '.xy') + ')';
  // A zero footprint is defined magnification, not WGSL log2(0). The smallest normal
  // positive f32 keeps the logarithm finite (and below the ABI's nonnegative minimum LOD).
  return '(log2(max(1.17549435e-38, max(length(' + dx + ' * ' + size + '), length(' + dy + ' * ' + size + '))))' +
    (name === 'texture' && args[2] ? ' + ' + args[2].code : '') + ')';
}
function integerSample(t: Expr, uv: Expr, name: string, args: Expr[], offset: Expr | undefined, ctx: Context): Expr {
  const s = sampler(t, ctx), type = t.type.startsWith('textureI') ? 'vec4i' : 'vec4u', helper = ctx.temp('integer_sample');
  const dim = t.type.endsWith('3d') ? 3 : 2, array = t.type.endsWith('2darray'), coords = array ? 'c.xy' : 'c';
  const lo = float(s[9]), hi = float(s[10]);
  const level = s[3] === 0 ? 'min(' + Math.floor(lo) + ', i32(textureNumLevels(' + t.code + ')) - 1)' :
    'i32(clamp(floor(clamp(l, ' + literal(lo) + ', ' + literal(hi) + ') + 0.5), 0.0, f32(textureNumLevels(' + t.code + ') - 1u)))';
  const wrap = (c: string, mode: number) => mode === 0 ? 'clamp(p.' + c + ', 0, size.' + c + ' - 1)' :
    mode === 1 ? '((p.' + c + ' % size.' + c + ') + size.' + c + ') % size.' + c :
      'min(((p.' + c + ' % (size.' + c + '*2))+size.' + c + '*2)%(size.' + c + '*2), size.' + c + '*2-1-(((p.' + c + '%(size.' + c + '*2))+size.' + c + '*2)%(size.' + c + '*2)))';
  ctx.helper('fn ' + helper + '(c: vec' + (array ? 3 : dim) + 'f, l: f32, o: vec' + dim + 'i) -> ' + type + ' { let level = ' + level +
    '; let size = vec' + dim + 'i(textureDimensions(' + t.code + ', level)); let p = vec' + dim + 'i(floor(' + coords + ' * vec' + dim + 'f(size))) + o;' +
    ' return textureLoad(' + t.code + ', vec' + dim + 'i(' + wrap('x',s[4]) + ', ' + wrap('y',s[5]) + (dim === 3 ? ', ' + wrap('z',s[6]) : '') + ')' +
    (array ? ', clamp(i32(floor(c.z + 0.5)),0,i32(textureNumLayers(' + t.code + '))-1)' : '') + ', level); }');
  return { code: helper + '(' + uv.code + ', ' + (s[3] ? lodExpression(t,uv,name,args,ctx) : '0.0') + ', ' + (offset?.code ?? 'vec' + dim + 'i(0)') + ')', type };
}
function shadowSample(t: Expr, uv: Expr, name: string, args: Expr[], offset: Expr | undefined, ctx: Context): Expr {
  const s = sampler(t,ctx), helper = ctx.temp('shadow_sample');
  const lo = s[3] === 0 ? Math.floor(float(s[9])) : float(s[9]);
  const hi = s[3] === 0 ? lo : float(s[10]);
  const compare = ['false','r < d','r == d','r <= d','r > d','r != d','r >= d','true'][s[8]];
  const wrap = (mode: number) => mode === 0 ? 'clamp(p,0,n-1)' : mode === 1 ? '((p%n)+n)%n' : 'min(((p%(n*2))+n*2)%(n*2),n*2-1-(((p%(n*2))+n*2)%(n*2)))';
  ctx.helper('fn ' + helper + '_x(p:i32,n:i32)->i32{return ' + wrap(s[4]) + ';}\n' +
    'fn ' + helper + '_y(p:i32,n:i32)->i32{return ' + wrap(s[5]) + ';}\n' +
    'fn ' + helper + '_load(p:vec2i,l:i32,r:f32)->f32 { let size=vec2i(textureDimensions(' + t.code + ',l)); let d=textureLoad(' + t.code + ',vec2i(' + helper + '_x(p.x,size.x),' + helper + '_y(p.y,size.y)),l); return select(0.0,1.0,' + compare + '); }\n' +
    'fn ' + helper + '_level(c:vec3f,l:i32,o:vec2i,linear:bool)->f32 { let p=c.xy*vec2f(textureDimensions(' + t.code + ',l)); if(!linear){return ' + helper + '_load(vec2i(floor(p))+o,l,c.z);} let b=vec2i(floor(p-vec2f(0.5)))+o; let a=fract(p-vec2f(0.5)); return mix(mix(' + helper + '_load(b,l,c.z),' + helper + '_load(b+vec2i(1,0),l,c.z),a.x),mix(' + helper + '_load(b+vec2i(0,1),l,c.z),' + helper + '_load(b+vec2i(1,1),l,c.z),a.x),a.y); }\n' +
    'fn ' + helper + '(c:vec3f,l:f32,o:vec2i)->f32 { let effective=clamp(l,' + literal(lo) + ',' + literal(hi) + ');' +
    'let linear=select(' + (s[2]===1) + ',' + (s[1]===1) + ',effective>0.0);' +
    'let level=clamp(' + (s[3]===0 ? literal(Math.floor(float(s[9]))) : 'effective') + ',0.0,f32(textureNumLevels(' + t.code + ')-1u));' +
    (s[3]===0 ? 'return ' + helper + '_level(c,i32(level),o,linear);' :
      (s[3]===1 ? 'return ' + helper + '_level(c,i32(floor(level+0.5)),o,linear);' :
        'let low=i32(floor(level)); let high=min(low+1,i32(textureNumLevels(' + t.code + '))-1); return mix(' + helper + '_level(c,low,o,linear),' + helper + '_level(c,high,o,linear),fract(level));')) + ' }');
  return { code: helper + '(' + uv.code + ', ' + lodExpression(t,uv,name,args,ctx) + ', ' + (offset?.code ?? 'vec2i(0)') + ')', type:'f32' };
}
