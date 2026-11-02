// Original CC0-1.0 shader fixtures. Tests general vertex -> compute contracts, not target code.
import {describe,it,expect} from 'vitest';
import {feedbackLayout,feedbackVertices,validateFeedbackInterface} from '../../bgt/runtime/feedback';
import {lowerFeedback} from '../../bgt/renderers/webgpu/feedback';
import {feedbackShader} from '../../bgt/renderers/webgl2/feedback';
import {translateGLSL,glslName} from '../../bgt/renderers/webgpu/shaders';
import {feedbackExpressionSource,feedbackExpressionBytes} from '../support/glsl-feedback-regression';
describe('transform feedback layouts and compute lowering',()=>{
  it.each([1,2])('GLSL language %i retains K9a expression lowering in the compute capture body',language=>{
    const code=translateGLSL(feedbackExpressionSource(language),1,language);
    const layout=feedbackLayout('ref 12\nsignedValue 6\nvalues 3\n',false,3);
    const lowered=lowerFeedback(code,layout,[],0,4,2,0,0,undefined,0);
    // Capture removes only entry/IO annotations, never retranslates the function body or its helpers.
    expect(lowered.startsWith(code.replace(/@vertex\s+/g,'').replace(/@(?:location|builtin|interpolate)\([^)]*\)\s*/g,''))).toBe(true);
    expect(lowered).toContain('2147483648u');expect(lowered).toContain('4275878552u');
    expect(lowered).toContain('bgt_internal_equal_');expect(lowered).toContain('bgt_internal_argument_');
    expect(lowered).toContain('bgt_internal_conditional_');
    expect(lowered).toContain('u32(o.bgt_internal_glsl_ref.x)');expect(lowered).toContain('bitcast<u32>(o.signedValue.y)');
    expect(lowered).toContain('let o=vs_main(v)');
    expect(feedbackExpressionBytes(false)[0]).toHaveLength(320);
    expect(feedbackExpressionBytes(true).map(b=>b.length)).toEqual([128,64,128]);
  });
  it('exports the complete canonical identifier mapping for capture, including K9a keywords',()=>{
    for(const name of ['ref','ptr','shared'])expect(glslName(name)).toBe(`bgt_internal_glsl_${name}`);
    expect(glslName('ordinary')).toBe('ordinary');
  });
  it.each([0,1,2,3,4])('complete primitive assembly topology %i',topology=>{
    expect(feedbackVertices(topology,4)).toEqual([[0,1,2,3],[0,1,2,3],[0,1,1,2,2,3],[0,1,2],[0,1,2,2,1,3]][topology]);
    expect(feedbackVertices(topology,0)).toEqual([]);
  });
  it('interleaved/separate strides are tight, including vec3 and exact signed/unsigned scalar bits',()=>{
    expect(feedbackLayout('a 2\nb 5\nc 9\n',false,3).strides).toEqual([20]);
    expect(feedbackLayout('a 2\nb 5\nc 9\n',true,3).strides).toEqual([12,4,4]);
  });
  it.each(['','a 4\n','a 13\n','a 0\na 1\n','bgt_internal_x 3\n','a 3','a 3\ntrailing','x 3\ny 3\nz 3\nw 3\nv 3\n'])('malformed interface is rejected: %s',source=>{
    expect(()=>feedbackLayout(source,true,source.split('\n').length-1)).toThrow();
  });
  it('interface validation rejects missing, wrong-type and commented declarations without changing a valid layout',()=>{
    const layout=feedbackLayout('value 3\n',false,1);
    expect(()=>validateFeedbackInterface('out vec4 value;',layout)).not.toThrow();
    for(const source of ['out float value;','// out vec4 value;','/* out vec4 value; */','out vec4 missing;'])expect(()=>validateFeedbackInterface(source,layout)).toThrow();
  });
  it('native feedback preserves raw noperspective values without disturbing value*w raster proxies',()=>{
    const source='#version 330 core\nnoperspective out float ramp;void main(){ramp=7.0;gl_Position=vec4(0.0,0.0,0.0,2.0);}';
    const shader=feedbackShader(source,1,feedbackLayout('ramp 0\n',false,1));
    expect(shader.names).toEqual(['bgt_internal_tf_raw_0']);expect(shader.source).toContain('bgt_internal_tf_raw_0=ramp;');
    expect(shader.source).toContain('bgt_internal_np_ramp = ramp * gl_Position.w;');
    expect(feedbackShader(source,1,feedbackLayout('other 0\n',false,1)).specialized).toBe(false);
  });
  it('dispatch flattens the second dimension and byte fetch includes the containing-word remainder',()=>{
    const code=translateGLSL('#version 330 core\nlayout(location=0) in vec4 bytes;out vec4 result;void main(){result=bytes;gl_Position=vec4(0.0);}',1,1);
    const output=lowerFeedback(code,feedbackLayout('result 3\n',false,1),[{location:0,format:4,stride:8,step:0,offset:1}],4,1400000,1,0,0,undefined,0);
    expect(output).toContain('id.x+id.y*4194240u');expect(output).toContain('if(ordinal_id>=4199994u)');
    expect(output).toContain('((1u + vertex * 8u)+3u)/4u');expect(output).toContain(')%4u)*8u)');
  });
  it.each([1,2])('GLSL language %i invokes translated vertex body with IDs and typed fetches',lang=>{
    const code=translateGLSL(`${lang===1?'#version 330 core':'#version 300 es\nprecision highp float;precision highp int;'}\nlayout(location=0) in vec3 pos;out vec3 next;flat out uint tag;void main(){next=pos+vec3(float(bgt_instance_index));tag=bgt_vertex_index+19u;gl_Position=vec4(pos,1.0);}`,1,lang);
    const layout=feedbackLayout('next 2\ntag 9\n',false,2);
    const out=lowerFeedback(code,layout,[{location:0,format:2,stride:12,step:0,offset:16}],4,4,2,3,1,undefined,0);
    expect(out).toContain('@compute @workgroup_size(64)');expect(out).not.toContain('@vertex');expect(out).not.toContain('@location');
    expect(out).toContain('let o=vs_main(v)');expect(out).toContain('let vertex=3u+ordinal');expect(out).toContain('let instance=1u+ordinal_id/6u');
    expect(out).toContain('bgt_internal_tf_out[3u+ordinal_id*4u]=u32(o.tag)');expect(out).toContain('bitcast<u32>(o.next.z)');
    expect(()=>lowerFeedback(code,feedbackLayout('missing 3\n',false,1),[],0,1,1,0,0,undefined,0)).toThrow();
  });
});
