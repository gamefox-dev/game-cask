// SPDX-License-Identifier: CC0-1.0. K62: the OpenGL 3.3 core implementation-dependent values (GL 3.3 core spec,
// Tables 6.38-6.47) with their minimums, and the WGL profile's documented exceptions. Every value the fixture
// x64-gl-raster logs must meet its minimum or match its documented exception exactly (so a change is noticed).
export interface Gl33Limit { name: string; min?: number[]; max?: number[] }
export const GL33_LIMITS: Record<number, Gl33Limit> = {
  0x0d32: { name: 'MAX_CLIP_DISTANCES', min: [8] }, 0x0d50: { name: 'SUBPIXEL_BITS', min: [4] },
  0x8073: { name: 'MAX_3D_TEXTURE_SIZE', min: [256] }, 0x0d33: { name: 'MAX_TEXTURE_SIZE', min: [1024] },
  0x88ff: { name: 'MAX_ARRAY_TEXTURE_LAYERS', min: [256] }, 0x84fd: { name: 'MAX_TEXTURE_LOD_BIAS', min: [2] },
  0x851c: { name: 'MAX_CUBE_MAP_TEXTURE_SIZE', min: [1024] }, 0x84e8: { name: 'MAX_RENDERBUFFER_SIZE', min: [1024] },
  // §2.13.1: at least the largest renderbuffer (and the display).
  0x0d3a: { name: 'MAX_VIEWPORT_DIMS', min: [4096, 4096] },
  0x0b12: { name: 'POINT_SIZE_RANGE', min: [1, 1] }, 0x846e: { name: 'ALIASED_LINE_WIDTH_RANGE', min: [1, 1] },
  0x0b22: { name: 'SMOOTH_LINE_WIDTH_RANGE', min: [1, 1] },
  0x86a2: { name: 'NUM_COMPRESSED_TEXTURE_FORMATS', min: [4] }, 0x8c2b: { name: 'MAX_TEXTURE_BUFFER_SIZE', min: [65536] },
  0x84f8: { name: 'MAX_RECTANGLE_TEXTURE_SIZE', min: [1024] }, 0x821b: { name: 'MAJOR_VERSION', min: [3] },
  0x821c: { name: 'MINOR_VERSION', min: [3] },
  0x8869: { name: 'MAX_VERTEX_ATTRIBS', min: [16] }, 0x8b4a: { name: 'MAX_VERTEX_UNIFORM_COMPONENTS', min: [1024] },
  0x8a2b: { name: 'MAX_VERTEX_UNIFORM_BLOCKS', min: [12] }, 0x9122: { name: 'MAX_VERTEX_OUTPUT_COMPONENTS', min: [64] },
  0x8b4c: { name: 'MAX_VERTEX_TEXTURE_IMAGE_UNITS', min: [16] },
  0x8a2c: { name: 'MAX_GEOMETRY_UNIFORM_BLOCKS', min: [12] }, 0x9123: { name: 'MAX_GEOMETRY_INPUT_COMPONENTS', min: [64] },
  0x9124: { name: 'MAX_GEOMETRY_OUTPUT_COMPONENTS', min: [128] }, 0x8de0: { name: 'MAX_GEOMETRY_OUTPUT_VERTICES', min: [256] },
  0x8de1: { name: 'MAX_GEOMETRY_TOTAL_OUTPUT_COMPONENTS', min: [1024] }, 0x8c29: { name: 'MAX_GEOMETRY_TEXTURE_IMAGE_UNITS', min: [16] },
  0x8ddf: { name: 'MAX_GEOMETRY_UNIFORM_COMPONENTS', min: [1024] },
  0x8b49: { name: 'MAX_FRAGMENT_UNIFORM_COMPONENTS', min: [1024] }, 0x8a2d: { name: 'MAX_FRAGMENT_UNIFORM_BLOCKS', min: [12] },
  0x9125: { name: 'MAX_FRAGMENT_INPUT_COMPONENTS', min: [128] }, 0x8872: { name: 'MAX_TEXTURE_IMAGE_UNITS', min: [16] },
  0x8904: { name: 'MIN_PROGRAM_TEXEL_OFFSET', max: [-8] }, 0x8905: { name: 'MAX_PROGRAM_TEXEL_OFFSET', min: [7] },
  0x8a2f: { name: 'MAX_UNIFORM_BUFFER_BINDINGS', min: [36] }, 0x8a30: { name: 'MAX_UNIFORM_BLOCK_SIZE', min: [16384] },
  0x8a34: { name: 'UNIFORM_BUFFER_OFFSET_ALIGNMENT', min: [1] }, 0x8a2e: { name: 'MAX_COMBINED_UNIFORM_BLOCKS', min: [36] },
  // † minimum MAX_stage_UNIFORM_BLOCKS x MAX_UNIFORM_BLOCK_SIZE / 4 + MAX_stage_UNIFORM_COMPONENTS (checked below).
  0x8a31: { name: 'MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS' }, 0x8a32: { name: 'MAX_COMBINED_GEOMETRY_UNIFORM_COMPONENTS' },
  0x8a33: { name: 'MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS' },
  0x8b4b: { name: 'MAX_VARYING_COMPONENTS', min: [60] }, 0x8b4d: { name: 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', min: [48] },
  0x8e59: { name: 'MAX_SAMPLE_MASK_WORDS', min: [1] }, 0x910e: { name: 'MAX_COLOR_TEXTURE_SAMPLES', min: [1] },
  0x910f: { name: 'MAX_DEPTH_TEXTURE_SAMPLES', min: [1] }, 0x9110: { name: 'MAX_INTEGER_SAMPLES', min: [1] },
  0x9111: { name: 'MAX_SERVER_WAIT_TIMEOUT', min: [0] },
  0x8c8a: { name: 'MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS', min: [64] },
  0x8c8b: { name: 'MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS', min: [4] },
  0x8c80: { name: 'MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS', min: [4] },
  0x8824: { name: 'MAX_DRAW_BUFFERS', min: [8] }, 0x88fc: { name: 'MAX_DUAL_SOURCE_DRAW_BUFFERS', min: [1] },
  0x8cdf: { name: 'MAX_COLOR_ATTACHMENTS', min: [8] }, 0x8d57: { name: 'MAX_SAMPLES', min: [4] },
  0x80e8: { name: 'MAX_ELEMENTS_VERTICES' }, 0x80e9: { name: 'MAX_ELEMENTS_INDICES' },
};
const GEOMETRY = 'geometry shaders are not implemented (no geometry stage in §13): GL_INVALID_ENUM';
/** Documented exceptions: the exact value reported (or 'error 0x500') and why (docs/handoff/K62.md, iteration notes). */
export function gl33Exceptions(o: { varyings: number }): Record<number, { value: string; why: string }> {
  const result: Record<number, { value: string; why: string }> = {
    0x84fd: { value: '0', why: 'no sampler LOD bias: WebGPU/WebGL 2 samplers have none (needs a shader-side bias)' },
    0x851c: { value: '0', why: 'cube-map textures are not implemented (no §13 cube dimension)' },
    0x84f8: { value: '0', why: 'rectangle textures are not implemented (sampler2DRect untranslated)' },
    0x86a2: { value: '0', why: 'compressed texture formats are not implemented (RGTC decode needed)' },
    0x8c2b: { value: '0', why: 'buffer textures are not implemented (glTexBuffer is a stub)' },
    0x8a2b: { value: '7', why: '§13 has 8 uniform slots per pipeline, one holds the default block' },
    0x8a2d: { value: '7', why: '§13 has 8 uniform slots per pipeline, one holds the default block' },
    0x8a2e: { value: '7', why: '§13 has 8 uniform slots per pipeline, one holds the default block' },
    0x8b4c: { value: '8', why: '§13 has 8 texture slots per pipeline' },
    0x8872: { value: '8', why: '§13 has 8 texture slots per pipeline' },
    0x9125: { value: String(o.varyings + 4), why: 'fragment inputs are the varyings (MAX_VARYING_COMPONENTS) + gl_FragCoord' },
    0x8904: { value: '0', why: 'texel-offset lookups are not translated (compile error)' },
    0x8905: { value: '0', why: 'texel-offset lookups are not translated (compile error)' },
    0x8e59: { value: '0', why: 'single-sampled only (no multisample textures or sample masks)' },
    0x910e: { value: '0', why: 'single-sampled only' }, 0x910f: { value: '0', why: 'single-sampled only' },
    0x9110: { value: '0', why: 'single-sampled only' }, 0x8d57: { value: '0', why: 'single-sampled only (no multisample renderbuffers)' },
    0x8824: { value: '4', why: '§13 passes have at most 4 colour attachments' },
    0x8cdf: { value: '4', why: '§13 passes have at most 4 colour attachments' },
    0x88fc: { value: '0', why: 'no dual-source blending in §13' },
    ...Object.fromEntries([0x8a2c, 0x9123, 0x9124, 0x8de0, 0x8de1, 0x8c29, 0x8ddf, 0x8a32].map(e => [e, { value: 'error 0x500', why: GEOMETRY }])),
  };
  // A WebGPU adapter with only 16 inter-stage locations guarantees 58 packed components (4 * 16 - 6).
  if (o.varyings < 60) result[0x8b4b] = { value: String(o.varyings), why: 'device inter-stage locations below 17' };
  return result;
}
/** Problems with the logged values (`limit 0x.... <values>` -> map), [] when all meet GL 3.3 or match an exception. */
export function checkGl33Limits(logged: ReadonlyMap<number, string>, o: { varyings: number; uniformBlock: number }): string[] {
  const problems: string[] = [], exceptions = gl33Exceptions(o);
  for (const [key, spec] of Object.entries(GL33_LIMITS)) {
    const e = Number(key), got = logged.get(e), name = `${spec.name} (0x${e.toString(16)})`;
    if (got === undefined) { problems.push(`${name}: not logged`); continue; }
    const exception = exceptions[e];
    if (exception) { if (got !== exception.value) problems.push(`${name}: ${got}, documented ${exception.value} (${exception.why})`); continue; }
    if (got.startsWith('error')) { problems.push(`${name}: ${got}`); continue; }
    const v = got.split(' ').map(Number);
    spec.min?.forEach((m, i) => { if (!(v[i] >= m)) problems.push(`${name}: ${got} below GL 3.3 minimum ${spec.min!.join(',')}`); });
    spec.max?.forEach((m, i) => { if (!(v[i] <= m)) problems.push(`${name}: ${got} above GL 3.3 maximum ${spec.max!.join(',')}`); });
  }
  const num = (e: number) => Number(logged.get(e)), blockSize = num(0x8a30);
  for (const [combined, blocks, comps] of [[0x8a31, 0x8a2b, 0x8b4a], [0x8a33, 0x8a2d, 0x8b49]])
    if (!(num(combined) >= num(blocks) * blockSize / 4 + num(comps))) problems.push(`combined uniform components 0x${combined.toString(16)}: ${num(combined)}`);
  if (blockSize !== Math.min(o.uniformBlock, 65536)) problems.push(`MAX_UNIFORM_BLOCK_SIZE ${blockSize}, device ${o.uniformBlock}`);
  if (num(0x8b4b) !== o.varyings) problems.push(`MAX_VARYING_COMPONENTS ${num(0x8b4b)}, device ${o.varyings}`);
  if (num(0x9122) !== o.varyings + 4) problems.push(`MAX_VERTEX_OUTPUT_COMPONENTS ${num(0x9122)}, device ${o.varyings} + 4`);
  return problems;
}
