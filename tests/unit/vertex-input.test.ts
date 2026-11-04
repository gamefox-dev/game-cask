// SPDX-License-Identifier: CC0-1.0
import { describe, expect, it } from 'vitest';
import { canonicalVertexType, vertexFormatScalar, vertexFormatWidth } from '../../bgt/renderers/vertex-input';
import { lowerFeedback } from '../../bgt/renderers/webgpu/feedback';
import { feedbackLayout } from '../../bgt/runtime/feedback';
import { translateGLSL } from '../../bgt/renderers/webgpu/shaders';
import { vertexComponentCases, componentShaders } from '../fixtures/vertex-components';

describe('vertex scalar class and component fill', () => {
  it.each(vertexComponentCases)('format $format preserves class and physical fetch size', c => {
    expect(vertexFormatWidth(c.format)).toBe(c.width);
    expect(vertexFormatScalar(c.format)).toBe(c.scalar === 'float' ? 'f32' : c.scalar === 'int' ? 'i32' : 'u32');
    for (const width of [1,2,3,4]) {
      const type = width === 1 ? vertexFormatScalar(c.format) : 'vec' + width + vertexFormatScalar(c.format)[0];
      expect(canonicalVertexType(type)).toEqual({ scalar:vertexFormatScalar(c.format), width });
      const shader = componentShaders(c.scalar, width);
      const code = translateGLSL(shader.vertex,1,1);
      const lowered = lowerFeedback(code,feedbackLayout('result '+shader.feedbackFormat+'\n',false,1),
        [{ location:0, format:c.format, stride:c.data.length, step:1, offset:0 }],3,3,1,0,0,undefined,0);
      const assignment = /v.value=([^;]+);/.exec(lowered)![1];
      expect(assignment.startsWith(type + '(')).toBe(true);
      if (width > c.width) {
        expect(assignment).toContain(width === 4 ? (c.scalar === 'float' ? ',1.0)' : c.scalar === 'int' ? ',1i)' : ',1u)') :
          c.scalar === 'float' ? ',0.0)' : c.scalar === 'int' ? ',0i)' : ',0u)');
      }
      // Truncation must not fetch a discarded component, especially across a bound range end.
      expect(assignment.split('bgt_internal_tf_in[').length - 1).toBe(Math.min(width,c.width));
    }
  });
  it('rejects class mismatches without changing transform-feedback output shape rules', () => {
    const shader=componentShaders('float',4), code=translateGLSL(shader.vertex,1,1);
    const input={location:0,format:6,stride:8,step:0,offset:0};
    expect(()=>lowerFeedback(code,feedbackLayout('result 3\n',false,1),[input],3,3,1,0,0,undefined,0)).toThrow('Feedback input type mismatch');
    expect(()=>lowerFeedback(code,feedbackLayout('result 1\n',false,1),[{...input,format:1}],3,3,1,0,0,undefined,0)).toThrow('Feedback output type mismatch');
    expect(canonicalVertexType('mat4x4f')).toBeUndefined();
    expect(canonicalVertexType('vec4<bool>')).toBeUndefined();
  });
});
