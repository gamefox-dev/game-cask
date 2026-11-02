// SPDX-License-Identifier: CC0-1.0
// Original integration fixture: GLSL expression semantics must survive vertex -> compute capture.
export function feedbackExpressionSource(language: number): string {
  return `${language === 1 ? '#version 330 core' : '#version 300 es\nprecision highp float;\nprecision highp int;'}
flat out uvec4 ref;
flat out ivec2 signedValue;
out vec4 values;
struct Stamp { uvec2 bits; uint last; };
uint bump(inout uint value) { value += 0x11u; return value; }
uint advance(inout uint value) { return bump(value); }
vec2 adjust(inout vec2 value) { value += vec2(2.0, 4.0); return value; }
void main() {
  uint id = bgt_vertex_index;
  uint seed = 0x80000000U + id;
  uint picked = (uvec2(id, 7u) == uvec2(1u, 7u)) ? advance(seed) : 0x25u;
  bool skipped = (id == 3u) && (advance(seed) == 0u);
  bool guarded = (id != 2u) || (advance(seed) != 0u);
  uint slots[2] = uint[2](0x10u, 0x20u);
  int at = 0;
  uint moved = advance(slots[at++]);
  vec2 pair = vec2(2.0, 9.0);
  vec2 adjusted = adjust(pair.yx);
  Stamp a; a.bits = uvec2(0xFEDCBA98u, id); a.last = 5u;
  Stamp b = a; b.last += (id == 2u) ? 1u : 0u;
  bool same = a == b;
  ref = uvec4(seed, picked, slots[0], uint(at));
  signedValue = ivec2(-0x7fffffff, (same && guarded && !skipped) ? 19 : -19);
  values = vec4(pair.x, adjusted.x, float(moved + slots[1]), float(bgt_instance_index));
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}`;
}

/** Independent little-endian known answer, not shader execution or a translation-derived oracle. */
export function feedbackExpressionBytes(separate: boolean): number[][] {
  const fields: number[][] = [[], [], []];
  for (let instance = 0; instance < 2; instance++) {
    for (let vertex = 0; vertex < 4; vertex++) {
      const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
      view.setUint32(0, 0x80000000 + vertex + (vertex === 0 ? 0 : 17), true);
      view.setUint32(4, vertex === 1 ? 0x80000012 : 37, true);
      view.setUint32(8, 33, true); view.setUint32(12, 1, true);
      view.setInt32(16, -2147483647, true); view.setInt32(20, vertex === 2 ? -19 : 19, true);
      view.setFloat32(24, 6, true); view.setFloat32(28, 11, true);
      view.setFloat32(32, 65, true); view.setFloat32(36, instance, true);
      if (separate) {
        fields[0].push(...bytes.slice(0, 16)); fields[1].push(...bytes.slice(16, 24));
        fields[2].push(...bytes.slice(24));
      } else fields[0].push(...bytes);
    }
  }
  return separate ? fields : [fields[0]];
}
