// SPDX-License-Identifier: CC0-1.0
// Original known answers, independent of any captured shader or engine.
export const vertexComponentCases = Array.from({ length: 13 }, (_, format) => {
  const scalar = format < 5 ? 'float' : format < 9 ? 'int' : 'uint';
  const width = format < 4 ? format + 1 : format === 4 ? 4 : format < 9 ? format - 4 : format - 8;
  const values = scalar === 'float' ? (format === 4 ? [0, 128 / 255, 1, 64 / 255] : [.25, .5, .75, .5]) :
    scalar === 'int' ? [-2, 4, 6, 0] : [2, 4, 6, 0];
  const all = format === 4 ? new Uint8Array([0, 128, 255, 64]) : scalar === 'float' ? new Float32Array(values) :
    scalar === 'int' ? new Int32Array(values) : new Uint32Array(values);
  return { format, scalar, width, values: values.slice(0, width), data: [...new Uint8Array(all.buffer).slice(0, format === 4 ? 4 : width * 4)] };
});
export function componentShaders(scalar: string, width: number, language = 1) {
  const type = width === 1 ? scalar : (scalar === 'float' ? 'vec' : scalar === 'int' ? 'ivec' : 'uvec') + width;
  const fill = width === 4 ? 'value' : width === 3 ? 'value, 1' : width === 2 ? 'value, 0, 1' : 'value, 0, 0, 1';
  const paint = scalar === 'float' ? 'vec4(' + fill + ')' : 'vec4(' + (scalar === 'int' ? 'ivec4' : 'uvec4') + '(' + fill + '))';
  const version = language === 1 ? '#version 330 core' : '#version 300 es\nprecision highp float;\nprecision highp int;';
  return {
    vertex: version + '\nlayout(location=0) in ' + type + ' value; flat out ' + type + ' result; flat out vec4 paint;\n' +
      'void main(){ result=value; paint=' + paint + (scalar === 'float' ? '' : '/vec4(8.0,8.0,8.0,1.0)') + ';' +
      'uint id=bgt_vertex_index; gl_Position=vec4(id==1u?3.0:-1.0,id==2u?3.0:-1.0,0.0,1.0);}',
    fragment: version + '\nflat in vec4 paint;layout(location=0) out vec4 color;void main(){color=paint;}',
    feedbackFormat: (scalar === 'float' ? 0 : scalar === 'int' ? 5 : 9) + width - 1,
  };
}
