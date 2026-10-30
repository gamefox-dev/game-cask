// WebGPU depth textures cannot use filtering samplers for non-comparison sampling. Lower those
// samples to textureLoad with the immutable BGT sampler's wrap/filter/LOD rules (no precision loss).
export interface DepthSampling { binding: number; sampler: readonly number[] }

export function lowerDepthSampling(source: string, sampling: readonly DepthSampling[]): string {
  let helpers = '';
  for (const { binding, sampler: s } of sampling) {
    const declaration = new RegExp(
      `((?:@\\w+\\s*\\([^)]*\\)\\s*)+)var\\s+(\\w+)\\s*:\\s*texture_depth_2d\\s*;`, 'g');
    const found = [...source.matchAll(declaration)].find(m =>
      /@group\s*\(\s*1u?\s*\)/.test(m[1]) &&
      new RegExp(`@binding\\s*\\(\\s*${binding}u?\\s*\\)`).test(m[1]));
    if (!found) continue;
    const texture = found[2], name = `bgt_internal_depth_${binding}`;
    const wrap = (axis: string, mode: number) => mode === 0 ? `clamp(${axis}, 0, size - 1)` : mode === 1 ?
      `((${axis} % size) + size) % size` :
      `size - 1 - abs((((${axis} % (size * 2)) + size * 2) % (size * 2)) - size)`;
    // Mirror repeat's discrete sequence is 0,1,..,N-1,N-1,..,1,0 (including both edge texels).
    const mirrored = (axis: string, mode: number) => mode !== 2 ? wrap(axis, mode) :
      `min(((${axis} % (size * 2)) + size * 2) % (size * 2),
        size * 2 - 1 - (((${axis} % (size * 2)) + size * 2) % (size * 2)))`;
    helpers += `
fn ${name}_x(value: i32, size: i32) -> i32 { return ${mirrored('value', s[4])}; }
fn ${name}_y(value: i32, size: i32) -> i32 { return ${mirrored('value', s[5])}; }
fn ${name}_load(p: vec2i, level: i32) -> f32 {
  let size = vec2i(textureDimensions(${texture}, level));
  return textureLoad(${texture}, vec2i(${name}_x(p.x,size.x), ${name}_y(p.y,size.y)), level);
}
fn ${name}_level(uv: vec2f, level: i32, linear: bool) -> f32 {
  let p = uv * vec2f(textureDimensions(${texture}, level));
  if (!linear) { return ${name}_load(vec2i(floor(p)), level); }
  let base = vec2i(floor(p - vec2f(0.5))); let a = fract(p - vec2f(0.5));
  return mix(mix(${name}_load(base,level), ${name}_load(base+vec2i(1,0),level), a.x),
    mix(${name}_load(base+vec2i(0,1),level), ${name}_load(base+vec2i(1,1),level), a.x), a.y);
}
fn ${name}(uv: vec2f, lod: f32) -> f32 {
  let level = clamp(lod, 0.0, f32(textureNumLevels(${texture}) - 1u));
  let linear = select(${s[2] === 1}, ${s[1] === 1}, lod > 0.0);
  ${s[3] === 0 ? `return ${name}_level(uv,0,linear);` : s[3] === 1 ?
    `return ${name}_level(uv,i32(floor(level+0.5)),linear);` :
    `let low=i32(floor(level)); let high=min(low+1,i32(textureNumLevels(${texture}))-1);
     return mix(${name}_level(uv,low,linear),${name}_level(uv,high,linear),fract(level));`}
}
`;
    let implicit = false, bias = false;
    // Work from the original expressions, balancing nested calls rather than regex-replacing their arguments.
    const call = /\b(textureSample|textureSampleLevel|textureSampleBias|textureSampleGrad)\s*\(/g;
    let output = '', offset = 0, match: RegExpExecArray | null;
    while ((match = call.exec(source))) {
      const start = call.lastIndex, args: string[] = [];
      let depth = 1, argument = start, end = start;
      for (; end < source.length && depth; end++) {
        if (source[end] === '(' || source[end] === '[') depth++;
        if (source[end] === ')' || source[end] === ']') depth--;
        if ((source[end] === ',' && depth === 1) || depth === 0) {
          args.push(source.slice(argument, end).trim()); argument = end + 1;
        }
      }
      if (args[0] !== texture) continue;
      if (args.length !== (match[1] === 'textureSample' ? 3 : match[1] === 'textureSampleGrad' ? 5 : 4))
        throw new Error('WGSL: depth sample offsets must be flattened by the profile');
      const uv = args[2], size = `vec2f(textureDimensions(${texture},0))`;
      const dx = match[1] === 'textureSampleGrad' ? args[3] : `dpdx(${uv})`;
      const dy = match[1] === 'textureSampleGrad' ? args[4] : `dpdy(${uv})`;
      let lod = `log2(max(length((${dx})*${size}),length((${dy})*${size})))`;
      if (match[1] === 'textureSampleLevel') lod = args[3];
      let replacement = `${name}(${uv},${lod})`;
      if (match[1] === 'textureSample' || match[1] === 'textureSampleBias') {
        implicit = true;
        if (match[1] === 'textureSampleBias') bias = true;
        replacement = `${name}_${match[1] === 'textureSampleBias' ? 'bias' : 'implicit'}` +
          `(${uv}${match[1] === 'textureSampleBias' ? ', ' + args[3] : ''})`;
      }
      output += source.slice(offset, match.index) + replacement;
      offset = end; call.lastIndex = end;
    }
    source = output + source.slice(offset);
    if (implicit) helpers += `
fn ${name}_lod(uv: vec2f) -> f32 {
  let size = vec2f(textureDimensions(${texture},0));
  return log2(max(length(dpdx(uv)*size),length(dpdy(uv)*size)));
}
fn ${name}_implicit(uv: vec2f) -> f32 { return ${name}(uv,${name}_lod(uv)); }
`;
    if (bias) helpers += `
fn ${name}_bias(uv: vec2f, bias: f32) -> f32 { return ${name}(uv,${name}_lod(uv)+bias); }
`;
  }
  return source + helpers;
}
