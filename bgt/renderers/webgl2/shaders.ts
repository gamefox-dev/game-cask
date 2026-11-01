// GLSL 3.30 and ES 3.00 share the portable §13 graphics subset. Unsupported desktop-only
// constructs fail compilation with a request log, rather than being silently reinterpreted.
// WGSL is WebGPU-only: no pinned, maintained translator is shipped with this kit.
function globalDeclarations(source: string): string[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ').replace(/^\s*#.*$/gm, '');
  const result: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}' && --depth === 0) start = i+1;
    else if (clean[i] === ';' && depth === 0) { result.push(clean.slice(start, i+1)); start = i+1; }
  }
  return result;
}

export function fragmentOutputs(source: string): { name: string; type: string; array: boolean }[] {
  const clean = globalDeclarations(source).join('\n');
  const result: { name: string; type: string; array: boolean }[] = [];
  const qualifiers = '(?:(?:layout\\s*\\([^;{}]*\\)|invariant|centroid|flat|smooth)\\s*)*';
  const declarations = new RegExp('^\\s*'+qualifiers+
    'out\\s+(?:(?:lowp|mediump|highp)\\s+)?(\\w+)\\s+([^;{}]+);', 'gm');
  for (const m of clean.matchAll(declarations)) {
    for (const declaration of m[2].split(',')) {
      const name = /^\s*([A-Za-z_]\w*)\s*(\[[^\]]+\])?\s*$/.exec(declaration);
      if (!name) throw new Error('Unsupported fragment output declaration');
      result.push({ name: name[1], type: m[1], array: !!name[2] });
    }
  }
  return result;
}

export function translateShader(source: string, stage: number, language: number): string {
  if (language !== 1 && language !== 2) throw new Error('WGSL requires WebGPU');
  const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, comment => comment.replace(/[^\n]/g, ' '));
  const version = language === 1 ? /^\s*#version[ \t]+330[ \t]+core[ \t]*(?:\r?\n|$)/ :
    /^\s*#version[ \t]+300[ \t]+es[ \t]*(?:\r?\n|$)/;
  if (!version.test(clean)) throw new Error('Shader version does not match declared language');
  if (language === 2 && !/\bprecision\s+(lowp|mediump|highp)\s+float\s*;/.test(clean)) {
    throw new Error('GLSL ES sources require float precision declarations');
  }
  if (/\bbgt_internal_\w*|\bgl_(VertexID|InstanceID|FragCoord)\b/.test(clean)) {
    throw new Error('Use portable BGT builtins, not native/private identifiers');
  }
  if (/layout\s*\([^)]*\bbinding\s*=/.test(clean)) throw new Error('Native binding decorations are forbidden');
  if (/^\s*#\s*define\b[^\n]*\b(in|out|uniform|layout)\b/m.test(clean)) {
    throw new Error('Portable interface declarations must not be hidden in macros');
  }
  const qualifiers = '(?:(?:layout\\s*\\([^)]*\\)|flat|smooth|centroid|invariant)\\s*)*';
  const declarations = new RegExp('^\\s*('+qualifiers+')'+
    '(in|out)\\s+(?:(?:lowp|mediump|highp)\\s+)?\\w+\\s+[^;{]+;', 'gm');
  for (const m of globalDeclarations(clean).join('\n').matchAll(declarations)) {
    if (m[2] === (stage === 1 ? 'in' : 'out') && !/location\s*=/.test(m[1])) {
      throw new Error('Vertex inputs and fragment outputs require explicit locations');
    }
  }
  const uniforms = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+([^;{]+);/g;
  for (const m of clean.matchAll(uniforms)) {
    if (!/^(sampler2D|sampler2DShadow|sampler3D|sampler2DArray)$/.test(m[1]) || !/^bgt_t[0-7]$/.test(m[2].trim())) {
      throw new Error(`Illegal non-block uniform ${m[2]}`);
    }
  }
  for (const m of clean.matchAll(/(?:layout\s*\(([^)]*)\)\s*)?uniform\s+(\w+)\s*\{/g)) {
    if (!/^bgt_u[0-7]$/.test(m[2]) || !/^\s*std140\s*$/.test(m[1] ?? '')) {
      throw new Error(`Illegal uniform block ${m[2]}`);
    }
  }
  if (stage === 2) fragmentOutputs(clean); // Reject forms we cannot reliably reflect, never ignore outputs.
  const body = clean.replace(/^\s*#version[^\n]*(?:\n|$)/, '')
    .replace(/\bmain\s*\(/g, 'bgt_internal_main(');
  const header = '#version 300 es\nprecision highp float;\nprecision highp int;\n'+
    'precision highp sampler2D;\nprecision highp sampler2DShadow;\nprecision highp usampler2D;\n'+
    'precision highp sampler3D;\nprecision highp sampler2DArray;\n';
  if (stage === 1) return header + `
uniform vec4 bgt_internal_view_transform;
out vec3 bgt_internal_clip;
uniform highp uint bgt_internal_instance;
uniform highp uint bgt_internal_vertex;
uniform bool bgt_internal_remap;
uniform highp usampler2D bgt_internal_ids;
uniform int bgt_internal_id_width;
#define bgt_vertex_index (bgt_internal_remap ? texelFetch(bgt_internal_ids, \
  ivec2(gl_VertexID % bgt_internal_id_width, gl_VertexID / bgt_internal_id_width), 0).r : \
  uint(gl_VertexID) + bgt_internal_vertex)
#define bgt_instance_index (uint(gl_InstanceID) + bgt_internal_instance)
${body}
void main() {
  bgt_internal_main();
  bgt_internal_clip = vec3(gl_Position.xy, gl_Position.w);
  gl_Position.z = 2.0 * gl_Position.z - gl_Position.w;
  gl_Position.y = -gl_Position.y;
  gl_Position.xy = gl_Position.xy * bgt_internal_view_transform.xy +
    gl_Position.w * bgt_internal_view_transform.zw;
  gl_PointSize = 1.0;
}\n`;
  return header + `in vec3 bgt_internal_clip;
#define bgt_frag_coord gl_FragCoord
${body}
void main() {
  // Preserve original clip planes after the fractional viewport transform, including points/lines
  // whose footprint overlaps the viewport although their centres are outside BGT clip space.
  if (any(greaterThan(abs(bgt_internal_clip.xy), vec2(bgt_internal_clip.z)))) discard;
  bgt_internal_main();
}\n`;
}
