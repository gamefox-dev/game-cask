// Local, engine-independent GLSL 330/ES 300 frontend. Unsupported syntax is a compile error, never guessed.
// Native WebGPU validates the resulting WGSL; errors retain the original token/line where possible.
import { integerLiteral, integerConstant, integerCode, type IntegerValue } from './glsl-integers';
type Token = { text: string; line: number };
type Expr = { code: string; type: string; view?: Field; place?: string; swizzle?: { root: string; components: string } };
type Parameter = { type: string; mode: string };
type Signature = { params: Parameter[]; type: string; name: string };
const types: Record<string, string> = {
  void: 'void', float: 'f32', int: 'i32', uint: 'u32', bool: 'bool',
  vec2: 'vec2f', vec3: 'vec3f', vec4: 'vec4f', ivec2: 'vec2i', ivec3: 'vec3i', ivec4: 'vec4i',
  uvec2: 'vec2u', uvec3: 'vec3u', uvec4: 'vec4u', bvec2: 'vec2<bool>', bvec3: 'vec3<bool>', bvec4: 'vec4<bool>',
  mat2: 'mat2x2f', mat3: 'mat3x3f', mat4: 'mat4x4f', mat2x2: 'mat2x2f', mat3x3: 'mat3x3f', mat4x4: 'mat4x4f',
  mat2x3: 'mat2x3f', mat2x4: 'mat2x4f', mat3x2: 'mat3x2f', mat3x4: 'mat3x4f', mat4x2: 'mat4x2f', mat4x3: 'mat4x3f',
};
// Block/struct member in std140 terms; `kind` says how the WGSL host-shareable form differs from the GLSL value.
type Field = { name: string; base: string; arr: number; kind: 'plain' | 'bool' | 'mat2' | 'struct' | 'pad'; comps: number };
interface StructInfo { name: string; fields: Field[]; host?: string }
const scalar = (t: string) => t === 'bool' || /^vec[234]<bool>$/.test(t) ? 'bool' :
  t.endsWith('u') || t === 'u32' ? 'u32' : t.endsWith('i') || t === 'i32' ? 'i32' : 'f32';
const vector = (n: number, t: string) => n === 1 ? scalar(t) :
  scalar(t) === 'bool' ? `vec${n}<bool>` : `vec${n}${scalar(t)[0]}`;
const reserved = /\bbgt_internal_\w*/;
export const glslName = (text: string) => ['ref', 'ptr', 'var', 'let', 'fn', 'alias', 'override', 'enable', 'requires', 'const_assert', 'bitcast', 'shared'].includes(text) ? `bgt_internal_glsl_${text}` : text;

function lex(source: string): Token[] {
  const result: Token[] = [];
  let line = 1;
  const re = new RegExp([
    String.raw`\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/`,
    String.raw`0[xX][\da-fA-F]+[uU]?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[uUfF]?|[A-Za-z_]\w*`,
    String.raw`<<=|>>=|\+\+|--|<=|>=|==|!=|&&|\|\||<<|>>|[+*/%&|^!-]=`,
    String.raw`[{}()[\].,;:?~+*/%&|^!<>=-]`,
  ].join('|'), 'gy');
  let offset = 0;
  while (offset < source.length) {
    re.lastIndex = offset;
    const m = re.exec(source);
    if (!m) throw new Error(`GLSL line ${line}: unexpected character ${JSON.stringify(source[offset])}`);
    const text = m[0];
    if (!/^\s|^\/\//.test(text) && !text.startsWith('/*')) {
      // These are legal GLSL names but WGSL keywords. Rename at token level, including member/function uses.
      result.push({ text: glslName(text), line });
    }
    line += (text.match(/\n/g) ?? []).length; offset = re.lastIndex;
  }
  return result;
}

class GLSL {
  private tokens: Token[];
  private i = 0;
  private variables = new Map<string, Expr>();
  private functions = new Map<string, string>();
  private declarations: string[] = [];
  private input: string[] = [];
  private output: string[] = [];
  private inputs: string[] = [];
  private outputs: string[] = [];
  private used = new Set<string>();
  private temporary = 0;
  private locals = new Set<string>();
  private helpers: string[] = [];
  private returnType = 'void';
  private structs = new Map<string, StructInfo>();
  private signatures = new Map<string, Signature[]>();
  private intConsts = new Map<string, IntegerValue>();
  private pending: string[] = [];
  private temp(prefix = 'value'): string { return `bgt_internal_${prefix}_${this.temporary++}`; }
  private save(e: Expr): Expr {
    if (/^(?:-?\d+[iu]|true|false|bgt_vertex_index|bgt_instance_index)$/.test(e.code)) return e;
    const code = this.temp(); this.pending.push(`let ${code} = ${e.code};`);
    return { code, type: e.type };
  }
  private capture<T>(fn: () => T): { value: T; before: string[] } {
    const saved = this.pending; this.pending = [];
    const value = fn(), before = this.pending; this.pending = saved;
    return { value, before };
  }

  private varyings: string[];
  constructor(source: string, private stage: number, language: number, varyingNames?: string[],
    private depthSlots: ReadonlySet<number> = new Set(),
    private integerSamplers: ReadonlyMap<number, readonly number[]> = new Map()) {
    this.varyings = (varyingNames ?? glslVaryings(source, stage)).map(glslName);
    const version = language === 1 ? /^\s*#version\s+330\s+core\s*(?:\r?\n|$)/ :
      /^\s*#version\s+300\s+es\s*(?:\r?\n|$)/;
    const match = source.match(version);
    if (!match) throw new Error(`GLSL: expected ${language === 1 ? '#version 330 core' : '#version 300 es'}`);
    if (reserved.test(source)) throw new Error('GLSL: bgt_internal_ prefix is reserved');
    source = source.slice(match[0].length);
    if (/#/.test(source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')))
      throw new Error('GLSL: preprocessor directives other than #version are not supported');
    this.tokens = lex('\n' + source);
    this.variables.set('gl_Position', { code: 'bgt_internal_position', type: 'vec4f', place: 'bgt_internal_position' });
    for (const n of ['bgt_vertex_index', 'bgt_instance_index']) this.variables.set(n, { code: n, type: 'u32' });
    for (const n of ['bgt_frag_coord', 'gl_FragCoord'])
      this.variables.set(n, { code: 'bgt_frag_coord', type: 'vec4f' });
    this.variables.set('gl_FrontFacing', { code: 'bgt_internal_front', type: 'bool' });
    if (stage === 1) this.variables.set('gl_PointSize', { code: 'bgt_internal_point_size', type: 'f32', place: 'bgt_internal_point_size' }); // no point sprites in §13
  }

  private peek(n = 0): string { return this.tokens[this.i + n]?.text ?? ''; }
  private fail(message: string): never {
    throw new Error(`GLSL line ${this.tokens[this.i]?.line ?? 'EOF'}: ${message}`);
  }
  private take(): string { if (!this.peek()) this.fail('unexpected end of source'); return this.tokens[this.i++].text; }
  private eat(t: string): boolean { if (this.peek() !== t) return false; this.i++; return true; }
  private need(t: string): void { if (!this.eat(t)) this.fail(`expected '${t}', found '${this.peek()}'`); }
  private name(): string {
    const n = this.take(); if (!/^[A-Za-z_]\w*$/.test(n)) this.fail(`expected identifier, found '${n}'`); return n;
  }
  private isType(n: string): boolean { return !!types[n] || this.structs.has(n); }
  private type(): string {
    while (['highp', 'mediump', 'lowp'].includes(this.peek())) this.take();
    const n = this.take();
    if (this.structs.has(n)) return n;
    if (!types[n]) this.fail(`unsupported type '${n}'`);
    return types[n];
  }
  private layout(): Map<string, number> {
    const values = new Map<string, number>();
    if (this.eat('layout')) {
      this.need('(');
      do {
        const n = this.name(); let value = 1;
        if (this.eat('=')) {
          value = Number(this.take()); if (!Number.isInteger(value)) this.fail('integer layout required');
        }
        values.set(n, value);
      } while (this.eat(','));
      this.need(')');
    }
    return values;
  }

  compile(): string {
    const bodies: string[] = [];
    while (this.peek()) {
      if (this.eat('precision')) { this.take(); this.take(); this.need(';'); continue; }
      const layout = this.layout();
      let interpolation = '';
      if (['flat', 'smooth', 'noperspective'].includes(this.peek())) interpolation = this.take();
      if (this.eat('uniform')) { this.uniform(layout); continue; }
      if (this.peek() === 'in' || this.peek() === 'out') {
        const direction = this.take(), type = this.type(), name = this.name(); this.need(';');
        const explicit = layout.get('location');
        const varying = this.stage === 1 ? direction === 'out' : direction === 'in';
        // Stable name-derived locations allow separately compiled vertex/fragment modules to link.
        const location = explicit ?? (varying ? this.varyingLocation(name) : -1);
        if (location < 0 || location > 15) this.fail('attributes and fragment outputs require location 0..15');
        if (varying && explicit !== undefined) this.fail('GLSL330 varying locations are not supported; link by name');
        const key = `${direction}:${location}`;
        if (this.used.has(key)) this.fail(`duplicate/colliding ${direction} location ${location}`);
        this.used.add(key);
        if (varying && interpolation === '' && scalar(type) !== 'f32') interpolation = 'flat';
        const decoration = `@location(${location}) ${interpolation === 'flat' ? '@interpolate(flat) ' :
          interpolation === 'noperspective' ? '@interpolate(linear) ' : ''}`;
        this.declarations.push(`var<private> ${name}: ${type};`);
        this.variables.set(name, { code: name, type, place: direction === 'out' ? name : undefined });
        if (direction === 'in') {
          this.input.push(`${decoration}${name}: ${type}`); this.inputs.push(`${name} = bgt_internal_in.${name};`);
        } else {
          this.output.push(`${decoration}${name}: ${type}`); this.outputs.push(`bgt_internal_out.${name} = ${name};`);
        }
        continue;
      }
      if (this.peek() === 'struct') { this.structDecl(); continue; }
      const constant = this.eat('const'), type = this.type(), name = this.name();
      if (this.eat('(')) {
        const params: string[] = [], prologue: string[] = [], sig: { type: string; mode: string }[] = [];
        const saved = new Map(this.variables), savedLocals = this.locals, savedReturnType = this.returnType;
        const savedConsts = new Map(this.intConsts);
        this.locals = new Set(); this.returnType = type;
        if (!this.eat(')')) {
          if (this.peek() === 'void' && this.peek(1) === ')') { this.take(); this.take(); }
          else {
            do {
              this.eat('const');
              let mode = 'in';
              if (['in', 'out', 'inout'].includes(this.peek())) mode = this.take();
              const t = this.type(), n = this.name(), at = this.array(t);
              sig.push({ type: at, mode }); this.intConsts.delete(n);
              if (mode === 'in') {
                // GLSL `in` parameters are mutable copies; WGSL parameters are not.
                params.push(`bgt_internal_p_${n}: ${at}`); prologue.push(`var ${n}: ${at} = bgt_internal_p_${n};`);
                this.variables.set(n, { code: n, type: at, place: n });
              } else {
                // Every call supplies fresh storage: GLSL parameters are copy-in/copy-out, not aliases.
                params.push(`${n}: ptr<function, ${at}>`);
                this.variables.set(n, { code: `(*${n})`, type: at, place: `(*${n})` });
              }
              this.locals.add(n);
            } while (this.eat(','));
            this.need(')');
          }
        }
        const overloads = this.signatures.get(name) ?? [];
        let overload = overloads.find(s => s.params.length === sig.length && s.params.every((p, i) => p.type === sig[i].type));
        if (!overload) {
          overload = { params: sig, type, name: overloads.length ? this.temp('overload') : name };
          overloads.push(overload); this.signatures.set(name, overloads);
        } else if (overload.type !== type || overload.params.some((p, i) => p.mode !== sig[i].mode)) this.fail('inconsistent function declaration');
        this.functions.set(name, type);
        if (this.eat(';')) { // prototype: the definition supplies the WGSL function
          this.variables = saved; this.locals = savedLocals; this.returnType = savedReturnType; this.intConsts = savedConsts;
          continue;
        }
        const body = this.block(prologue); this.variables = saved;
        this.locals = savedLocals; this.returnType = savedReturnType; this.intConsts = savedConsts;
        const signature = `fn ${name === 'main' ? 'bgt_internal_main' : overload.name}(${params.join(', ')})`;
        bodies.push(`${signature}${type === 'void' ? '' : ` -> ${type}`} ${body}`);
      } else {
        let current = name;
        for (;;) {
          const suffix = this.array(type); this.variables.set(current, { code: current, type: suffix, place: constant ? undefined : current });
          const start = this.i;
          const init = this.eat('=') ? this.expression() : undefined;
          if (this.pending.length) this.fail('global initializer requires a constant expression');
          const code = init ? this.convert(init, suffix).code : undefined;
          if (constant && !code) this.fail('const requires initializer');
          if (constant && /^(i32|u32)$/.test(type) && init) {
            const value = this.constInt(this.tokens.slice(start + 1, this.i).map(t => t.text));
            if (value !== undefined) this.intConsts.set(current, { value: BigInt(value), unsigned: type === 'u32' });
          }
          this.declarations.push(`${constant ? 'const' : 'var<private>'} ${current}: ${suffix}${code ? ` = ${code}` : ''};`);
          if (this.eat(',')) { current = this.name(); continue; }
          this.need(';'); break;
        }
      }
    }
    if (!this.functions.has('main')) this.fail('missing main');
    if (this.stage === 1) {
      this.input.push('@builtin(vertex_index) bgt_vertex_index: u32',
        '@builtin(instance_index) bgt_instance_index: u32');
      this.inputs.push('bgt_vertex_index = bgt_internal_in.bgt_vertex_index;',
        'bgt_instance_index = bgt_internal_in.bgt_instance_index;');
      this.output.unshift('@builtin(position) bgt_internal_position: vec4f');
      this.outputs.unshift('bgt_internal_out.bgt_internal_position = bgt_internal_position;');
      this.declarations.push('var<private> bgt_internal_position: vec4f;',
        'var<private> bgt_vertex_index: u32;', 'var<private> bgt_instance_index: u32;',
        'var<private> bgt_internal_point_size: f32;');
    } else {
      this.input.push('@builtin(position) bgt_frag_coord: vec4f', '@builtin(front_facing) bgt_internal_front: bool');
      this.inputs.push('bgt_frag_coord = bgt_internal_in.bgt_frag_coord;',
        'bgt_internal_front = bgt_internal_in.bgt_internal_front;');
      this.declarations.push('var<private> bgt_frag_coord: vec4f;', 'var<private> bgt_internal_front: bool;');
    }
    const entry = this.stage === 1 ? 'vertex' : 'fragment';
    // GLSL permits implicit derivatives in divergent flow (results are undefined there). Do not turn
    // WGSL's stricter static uniformity diagnostic into rejection of otherwise legal GLSL programs.
    return ['diagnostic(off, derivative_uniformity);', ...this.declarations,
      `struct bgt_internal_Input { ${this.input.join(',\n')} };`,
      ...(this.output.length ? [`struct bgt_internal_Output { ${this.output.join(',\n')} };`] : []),
      ...bodies, ...this.helpers,
      `@${entry} fn ${this.stage === 1 ? 'vs_main' : 'fs_main'}(bgt_internal_in: bgt_internal_Input)` +
        `${this.output.length ? ' -> bgt_internal_Output' : ''} {`,
      ...this.inputs, 'bgt_internal_main();',
      ...(this.output.length ? ['var bgt_internal_out: bgt_internal_Output;',
        ...this.outputs, 'return bgt_internal_out;'] : []), '}',
    ].join('\n');
  }

  private varyingLocation(name: string): number {
    return this.varyings.indexOf(name);
  }

  private uniform(layout: Map<string, number>): void {
    if (layout.has('binding') || layout.has('set')) this.fail('native bindings are forbidden; use bgt_uS/bgt_tS');
    const name = this.name();
    if (name === 'sampler3D' || name === 'sampler2DArray') {
      const n = this.name(), slot = /^bgt_t([0-7])$/.exec(n); if (!slot) this.fail('sampler must be bgt_t0..bgt_t7');
      this.need(';'); const s = Number(slot[1]), volume = name === 'sampler3D';
      this.declarations.push(`@group(1) @binding(${2 * s}) var ${n}: ${volume ? 'texture_3d<f32>' : 'texture_2d_array<f32>'};`,
        `@group(1) @binding(${2 * s + 1}) var ${n}_sampler: sampler;`);
      this.variables.set(n, { code: n, type: volume ? 'texture3d' : 'texture2darray' }); return;
    }
    if (name === 'isampler2D' || name === 'usampler2D') {
      const n = this.name(), slot = /^bgt_t([0-7])$/.exec(n); if (!slot) this.fail('sampler must be bgt_t0..bgt_t7');
      this.need(';'); const s = Number(slot[1]), integer = name === 'isampler2D';
      this.declarations.push(`@group(1) @binding(${2 * s}) var ${n}: texture_2d<${integer ? 'i32' : 'u32'}>;`,
        `@group(1) @binding(${2 * s + 1}) var ${n}_sampler: sampler;`);
      this.variables.set(n, { code: n, type: integer ? 'textureI' : 'textureU' }); return;
    }
    if (name === 'sampler2D' || name === 'sampler2DShadow') {
      const n = this.name(), slot = /^bgt_t([0-7])$/.exec(n); if (!slot) this.fail('sampler must be bgt_t0..bgt_t7');
      this.need(';'); const s = Number(slot[1]), compare = name === 'sampler2DShadow';
      const depth = compare || this.depthSlots.has(s);
      const texture = depth ? 'texture_depth_2d' : 'texture_2d<f32>';
      this.declarations.push(`@group(1) @binding(${2 * s}) var ${n}: ${texture};`,
        `@group(1) @binding(${2 * s + 1}) var ${n}_sampler: ${compare ? 'sampler_comparison' : 'sampler'};`);
      this.variables.set(n, { code: n, type: compare ? 'depth' : depth ? 'depthColor' : 'texture' }); return;
    }
    const slot = /^bgt_u([0-7])$/.exec(name);
    if (!slot || !layout.has('std140')) this.fail('uniforms must be layout(std140) uniform bgt_u0..bgt_u7 blocks');
    this.need('{'); const fields: Field[] = [];
    while (!this.eat('}')) {
      while (['highp', 'mediump', 'lowp'].includes(this.peek())) this.take();
      const glsl = this.peek(), base = this.type();
      do { fields.push(this.field(this.name(), base, glsl, this.arrayLen())); } while (this.eat(','));
      this.need(';');
    }
    const members = fields.map(f => `@align(${this.alignment(f)}) ${f.name}: ${this.hostType(f)}`);
    const instance = this.peek() === ';' ? `bgt_internal_${name}` : this.name(); this.need(';');
    this.declarations.push(`struct ${name} { ${members.join(', ')} };`,
      `@group(0) @binding(${slot[1]}) var<uniform> ${instance}: ${name};`);
    if (instance.startsWith('bgt_internal_')) for (const f of fields) this.variables.set(f.name, this.fieldExpr(instance, f));
    else {
      this.variables.set(instance, { code: instance, type: name });
      for (const f of fields) this.variables.set(`${name}.${f.name}`, this.fieldExpr('$', f));
    }
  }

  // ---- std140 host-shareable forms. GLSL values and WGSL uniform storage differ for bool, mat2, scalar/vec2
  // arrays and structs, so each is stored in a padded form and converted when read.
  private field(name: string, base: string, glsl: string, arr: number): Field {
    const kind = glsl === 'bool' ? 'bool' : /^mat[234]x2f$/.test(base) ? 'mat2' : this.structs.has(base) ? 'struct' :
      arr && /^(f32|i32|u32|vec2[fiu])$/.test(base) ? 'pad' : 'plain';
    return { name, base, arr, kind, comps: /^vec2/.test(base) ? 2 : 1 };
  }
  private alignment(f: Field): number {
    return f.arr || f.kind === 'struct' || f.kind === 'mat2' || /vec[34]|mat/.test(f.base) ? 16 :
      /vec2/.test(f.base) ? 8 : 4;
  }
  private hostType(f: Field): string {
    const wrap = (t: string) => f.arr ? `array<${t}, ${f.arr}>` : t;
    switch (f.kind) {
      case 'bool': return f.arr ? `array<vec4<u32>, ${f.arr}>` : 'u32';
      case 'mat2': return wrap(f.base.replace('x2f', 'x4f'));
      case 'struct': return wrap(this.hostStruct(f.base));
      case 'pad': return `array<vec4<${scalar(f.base)}>, ${f.arr}>`;
      default:
        if (/bool/.test(f.base)) this.fail('bool vectors are not supported in uniform storage');
        return wrap(f.base);
    }
  }
  private element(code: string, f: Field): string {  // one element of a non-plain array, or the scalar form of a field
    switch (f.kind) {
      case 'bool': return `(${code}${f.arr ? '.x' : ''} != 0u)`;
      case 'mat2': return `${f.base}(${Array.from({ length: Number(f.base[3]) }, (_, i) => `${code}[${i}].xy`).join(', ')})`;
      case 'struct': return `bgt_internal_load_${f.base}(${code})`;
      case 'pad': return `${code}.${f.comps === 2 ? 'xy' : 'x'}`;
      default: return code;
    }
  }
  private fieldExpr(root: string, f: Field): Expr {
    const code = `${root}.${f.name}`, host = this.hostType(f);
    if (f.arr) return f.kind === 'plain' ? { code, type: host } : { code, type: host, view: f };
    return { code: f.kind === 'plain' ? code : this.element(code, f), type: f.kind === 'bool' ? 'bool' :
      f.base };
  }
  private hostStruct(name: string): string {
    const info = this.structs.get(name)!;
    if (info.host) return info.host;
    info.host = `${name}_u`;
    const members = info.fields.map((f, i) => `@align(${i === 0 ? 16 : this.alignment(f)}) ${f.name}: ${this.hostType(f)}`);
    const loads = info.fields.map(f => {
      if (!f.arr) return this.fieldExpr('x', f).code;
      if (f.kind === 'plain') return `x.${f.name}`;
      const items = Array.from({ length: f.arr }, (_, i) => this.element(`x.${f.name}[${i}]`, f));
      return `array<${f.kind === 'bool' ? 'bool' : f.base}, ${f.arr}>(${items.join(', ')})`;
    });
    this.declarations.push(`struct ${info.host} { ${members.join(', ')} };`,
      `fn bgt_internal_load_${name}(x: ${info.host}) -> ${name} { return ${name}(${loads.join(', ')}); }`);
    return info.host;
  }
  private structDecl(): void {
    this.need('struct'); const name = this.name(); this.need('{');
    if (this.structs.has(name) || types[name]) this.fail(`redefinition of '${name}'`);
    const fields: Field[] = [];
    while (!this.eat('}')) {
      while (['highp', 'mediump', 'lowp'].includes(this.peek())) this.take();
      const glsl = this.peek(), base = this.type();
      do { fields.push(this.field(this.name(), base, glsl, this.arrayLen())); } while (this.eat(','));
      this.need(';');
    }
    this.need(';');
    this.structs.set(name, { name, fields });
    this.declarations.push(`struct ${name} { ${fields.map(f => `${f.name}: ${f.arr ? `array<${f.base}, ${f.arr}>` : f.base}`).join(', ')} };`);
    for (const f of fields) this.variables.set(`${name}.${f.name}`,
      { code: `$.${f.name}`, type: f.arr ? `array<${f.base}, ${f.arr}>` : f.base });
  }

  private constInt(tokens: string[]): number | undefined { return integerConstant(tokens, this.intConsts); }
  private arrayLen(): number {
    if (!this.eat('[')) return 0;
    const tokens: string[] = [];
    while (this.peek() && this.peek() !== ']') tokens.push(this.take());
    const n = this.constInt(tokens); this.need(']');
    if (n === undefined || !Number.isInteger(n) || n < 1) this.fail('array requires positive constant length');
    return n;
  }

  private array(type: string): string {
    const n = this.arrayLen(); return n ? `array<${type}, ${n}>` : type;
  }

  private block(prologue: string[] = []): string {
    this.need('{'); const statements: string[] = [...prologue], saved = new Map(this.variables);
    const savedLocals = new Set(this.locals), savedConsts = new Map(this.intConsts);
    while (!this.eat('}')) statements.push(this.statement());
    this.variables = saved; this.locals = savedLocals; this.intConsts = savedConsts;
    return `{\n${statements.join('\n')}\n}`;
  }

  private statement(): string {
    const { value, before } = this.capture(() => this.statementInner());
    return [...before, value].join('\n');
  }
  private statementInner(): string {
    if (this.peek() === '{') return this.block();
    if (this.eat(';')) return '';
    if (this.eat('if')) {
      this.need('('); const e = this.expression(); this.need(')'); const yes = this.statement();
      return `if (${e.code}) ${this.braces(yes)}${this.eat('else') ? ` else ${this.braces(this.statement())}` : ''}`;
    }
    if (this.eat('for')) {
      this.need('('); const saved = new Map(this.variables), savedLocals = new Set(this.locals), savedConsts = new Map(this.intConsts);
      const init = this.statement(), cond = this.capture(() => this.peek() === ';' ? { code: 'true', type: 'bool' } : this.expression()); this.need(';');
      const step = this.capture(() => this.peek() === ')' ? '' : this.simple(false)); this.need(')');
      const body = this.statement(); this.variables = saved; this.locals = savedLocals; this.intConsts = savedConsts;
      if (!cond.before.length && !step.before.length && !init.includes('\n'))
        return `{ for (${init} ${cond.value.code}; ${step.value}) ${this.braces(body)} }`;
      return `{ ${init}\nloop { ${cond.before.join('\n')}\nif (!(${cond.value.code})) { break; }\n${body}\ncontinuing { ${step.before.join('\n')}\n${step.value}${step.value && !/[;}]$/.test(step.value) ? ';' : ''} } } }`;
    }
    if (this.eat('while')) {
      this.need('('); const cond = this.capture(() => this.expression()); this.need(')');
      const body = this.statement();
      return cond.before.length ? `loop { ${cond.before.join('\n')}\nif (!(${cond.value.code})) { break; }\n${body}\n}` :
        `while (${cond.value.code}) ${this.braces(body)}`;
    }
    if (this.eat('return')) {
      const e = this.peek() === ';' ? '' : ` ${this.convert(this.expression(), this.returnType).code}`;
      this.need(';'); return `return${e};`;
    }
    if (['discard', 'break', 'continue'].includes(this.peek())) {
      const n = this.take(); this.need(';'); return `${n};`;
    }
    return this.simple(true);
  }
  private braces(s: string): string { return s.startsWith('{') ? s : `{ ${s} }`; }
  private simple(semicolon: boolean): string {
    const constant = this.eat('const');
    let result: string;
    if (this.isType(this.peek()) || ['highp', 'mediump', 'lowp'].includes(this.peek())) {
      const type = this.type(), parts: string[] = [];
      do {
        const n = this.name(), array = this.array(type);
        const start = this.i;
        const init = this.eat('=') ? this.convert(this.expression(), array).code : undefined;
        this.variables.set(n, { code: n, type: array, place: constant ? undefined : n });
        this.intConsts.delete(n);
        if (constant && init && /^(i32|u32)$/.test(type)) {
          const v = this.constInt(this.tokens.slice(start + 1, this.i).map(t => t.text));
          if (v !== undefined) this.intConsts.set(n, { value: BigInt(v), unsigned: type === 'u32' });
        }
        this.locals.add(n);
        parts.push(...this.pending.splice(0), `${constant ? 'let' : 'var'} ${n}: ${array}${init ? ` = ${init}` : ''};`);
      } while (this.eat(','));
      result = parts.join('\n');
    } else {
      const lhs = this.expression();
      if (['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='].includes(this.peek())) {
        if (!lhs.place) this.fail('assignment requires mutable storage');
        const op = this.take(), rhs = this.convert(this.expression(), lhs.type);
        const swizzle = lhs.swizzle && lhs.swizzle.components.length > 1 ? [lhs.place, lhs.swizzle.root, lhs.swizzle.components] : undefined;
        if (swizzle) {
          if (new Set(swizzle[2]).size !== swizzle[2].length) this.fail('assignment repeats a swizzle component');
          const temp = `bgt_internal_swizzle_${this.temporary++}`;
          const assignments = [...swizzle[2]].map((c, i) =>
            `${swizzle[1]}.${c} ${op} ${temp}${/^vec/.test(rhs.type) ? `.${'xyzw'[i]}` : ''};`);
          result = `{ let ${temp} = ${rhs.code}; ${assignments.join(' ')} }`;
        } else result = `${lhs.place} ${op} ${rhs.code}`;
      } else result = lhs.code ? `_ = ${lhs.code}` : '';
    }
    if (semicolon) this.need(';'); return result + (semicolon && result && !/[;}]$/.test(result) ? ';' : '');
  }

  private convert(e: Expr, type: string): Expr {
    if (e.type === type) return e;
    if (/^(f32|i32|u32)$/.test(type) || (/^vec/.test(type) && /^vec/.test(e.type)))
      return { code: `${type}(${e.code})`, type };
    return e;
  }

  private expression(min = 0): Expr {
    const start = this.i, pendingStart = this.pending.length;
    let lhs: Expr;
    const n = this.take();
    if (n === '++' || n === '--') {
      const e = this.expression(12);
      if (!e.place) this.fail('increment requires mutable storage');
      this.pending.push(`${e.place}${n};`); lhs = this.save(e);
    } else
    if (['-', '+', '!', '~'].includes(n)) {
      const e = this.expression(12); lhs = { code: n === '+' ? e.code : `(${n}${e.code})`, type: e.type };
    } else if (n === '(') { lhs = this.expression(); this.need(')'); lhs.code = `(${lhs.code})`; }
    else if (/^(\d|\.)/.test(n)) {
      const integer = integerLiteral(n);
      if (integer) lhs = { code: integer.code, type: integer.unsigned ? 'u32' : 'i32' };
      else {
        if (/^0[xX]|^\d+[uU]?$/.test(n)) this.fail(`invalid integer literal '${n}'`);
        let code = n.replace(/[fF]$/, '');
        if (!/[.eE]/.test(code)) code += '.0';
        lhs = { code, type: 'f32' };
      }
    } else if (n === 'true' || n === 'false') lhs = { code: n, type: 'bool' };
    else if (types[n] && this.peek() === '[') {
      const type = this.array(types[n]), count = Number(/, (\d+)>$/.exec(type)![1]);
      this.need('('); const args: Expr[] = [];
      if (!this.eat(')')) {
        do { args.push(this.convert(this.expression(), types[n])); } while (this.eat(',')); this.need(')');
      }
      if (args.length !== count) this.fail(`array constructor requires ${count} elements`);
      lhs = { code: `${type}(${args.map(a => a.code).join(', ')})`, type };
    }
    else if (this.peek() === '(') lhs = this.call(n);
    else {
      const v = this.variables.get(n); if (!v) this.fail(`unknown identifier '${n}'`); lhs = { ...v };
      if (n.startsWith('gl_') && !['gl_Position', 'gl_FragCoord', 'gl_FrontFacing', 'gl_PointSize'].includes(n))
        this.fail(`unsupported builtin ${n}`);
    }
    while (true) {
      if (this.peek() === '++' || this.peek() === '--') {
        const op = this.take();
        if (!lhs.place) this.fail('increment requires mutable storage');
        const value = this.save(lhs); this.pending.push(`${lhs.place}${op};`); lhs = value; continue;
      }
      if (this.eat('.')) {
        const member = this.name();
        if (member === 'length' && this.peek() === '(') {
          this.take(); this.need(')');
          const n = lhs.view?.arr ?? Number(/, (\d+)>$/.exec(lhs.type)?.[1]);
          if (!n) this.fail('length() requires an array'); lhs = { code: `${n}i`, type: 'i32' }; continue;
        }
        const known = this.variables.get(`${lhs.type}.${member}`);
        const type = known?.type ?? vector(member.length, lhs.type);
        if (known) {
          lhs = { code: known.code.replace(/\$/g, lhs.code), type, view: known.view,
            place: lhs.place ? `${lhs.place}.${member}` : undefined }; continue;
        }
        if (!/^vec/.test(lhs.type)) this.fail(`unknown member '${member}'`);
        const swizzle = member.replace(/[rgba]/g, c => ({ r: 'x', g: 'y', b: 'z', a: 'w' })[c]!);
        const components = lhs.swizzle ? [...swizzle].map(c => lhs.swizzle!.components['xyzw'.indexOf(c)]).join('') : swizzle;
        const root = lhs.swizzle?.root ?? lhs.code;
        lhs = { code: `${root}.${components}`, type, swizzle: { root, components },
          place: lhs.place ? `${root}.${components}` : undefined }; continue;
      }
      if (this.eat('[')) {
        let index = this.expression(); this.need(']');
        if (lhs.place && !/^-?\d+[iu]$/.test(index.code)) index = this.save(index);
        if (lhs.view) {
          const f = lhs.view, item = `${lhs.code}[${index.code}]`;
          lhs = { code: this.element(item, f), type: f.kind === 'bool' ? 'bool' : f.base };
          continue;
        }
        if (lhs.swizzle) {
          const indices = [...lhs.swizzle.components].map(c => `${'xyzw'.indexOf(c)}u`);
          const mapped = this.save({ code: `array<u32, ${indices.length}>(${indices.join(', ')})[${index.code}]`, type: 'u32' });
          const code = `${lhs.swizzle.root}[${mapped.code}]`;
          lhs = { code, type: scalar(lhs.type), place: lhs.place ? code : undefined }; continue;
        }
        const type = /^array<(.+),/.exec(lhs.type)?.[1] ??
          (/^mat\d+x(\d)f$/.test(lhs.type) ? `vec${/^mat\d+x(\d)f$/.exec(lhs.type)![1]}f` : scalar(lhs.type));
        lhs = { code: `${lhs.code}[${index.code}]`, type, place: lhs.place ? `${lhs.place}[${index.code}]` : undefined }; continue;
      }
      const op = this.peek(), precedence: Record<string, number> = {
        '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
        '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
      };
      const p = precedence[op]; if (!p || p < min) break;
      this.take(); const tail = this.capture(() => this.expression(p + 1)); let rhs = tail.value;
      if (tail.before.length) {
        if (op === '&&' || op === '||') {
          const temp = this.temp('logical');
          this.pending.push(`var ${temp}: bool = ${lhs.code};`,
            `if (${op === '||' ? '!' : ''}${temp}) { ${tail.before.join('\n')}\n${temp} = ${rhs.code}; }`);
          lhs = { code: temp, type: 'bool' }; continue;
        }
        lhs = this.save(lhs); this.pending.push(...tail.before);
      }
      const promote = scalar(lhs.type) === 'f32' || scalar(rhs.type) === 'f32' ? 'f32' :
        scalar(lhs.type) === 'u32' || scalar(rhs.type) === 'u32' ? 'u32' : 'i32';
      const promoted = (e: Expr) => /^vec/.test(e.type) ? vector(Number(e.type[3]), promote) :
        /^(f32|i32|u32)$/.test(e.type) ? promote : e.type;
      if (op === '<<' || op === '>>') rhs = this.convert(rhs,
        /^vec/.test(rhs.type) ? vector(Number(rhs.type[3]), 'u32') : 'u32');
      else if (p > 2 && scalar(lhs.type) !== 'bool' && scalar(rhs.type) !== 'bool') {
        lhs = this.convert(lhs, promoted(lhs)); rhs = this.convert(rhs, promoted(rhs));
      }
      let left = lhs.code, right = rhs.code;
      const lv = /^vec[234]/.test(lhs.type), rv = /^vec[234]/.test(rhs.type);
      if (['+', '-', '/', '%'].includes(op) && lv !== rv) {
        if (lv && /^(f32|i32|u32)$/.test(rhs.type)) right = `${lhs.type}(${right})`;
        if (rv && /^(f32|i32|u32)$/.test(lhs.type)) left = `${rhs.type}(${left})`;
      }
      const type = p <= 2 || (p >= 6 && p <= 7) ? 'bool' :
        /^mat/.test(lhs.type) && rv ? rhs.type : rv && !lv ? rhs.type : lhs.type;
      lhs = { code: op === '==' || op === '!=' ? this.equality(lhs.type, left, right, op === '!=') :
        `(${left} ${op} ${right})`, type };
    }
    if (min === 0 && this.eat('?')) {
      const condition = this.save(lhs);
      const yesBranch = this.capture(() => this.expression()); this.need(':');
      const noBranch = this.capture(() => this.expression());
      let yes = yesBranch.value, no = noBranch.value;
      if (yes.type !== no.type) {
        if (scalar(yes.type) === 'f32') no = this.convert(no, yes.type);
        else yes = this.convert(yes, no.type);
      }
      const result = this.temp('conditional');
      this.pending.push(`var ${result}: ${yes.type};`,
        `if (${condition.code}) { ${yesBranch.before.join('\n')}\n${result} = ${yes.code}; } else { ${noBranch.before.join('\n')}\n${result} = ${no.code}; }`);
      lhs = { code: result, type: yes.type };
    }
    const constantTokens = this.tokens.slice(start, this.i).map(t => t.text);
    if (lhs.type === 'u32' || lhs.type === 'i32') {
      const value = this.constInt(constantTokens);
      if (value !== undefined && (lhs.type === 'u32' || constantTokens.includes('?') || value === -2147483648)) {
        this.pending.splice(pendingStart);
        lhs = { code: integerCode(BigInt(value), lhs.type === 'u32'), type: lhs.type };
      }
    }
    return lhs;
  }

  private equality(type: string, left: string, right: string, different: boolean): string {
    if (/^vec/.test(type)) return `${different ? 'any' : 'all'}(${left} ${different ? '!=' : '=='} ${right})`;
    const matrix = /^mat([234])x([234])f$/.exec(type), array = /^array<(.+), (\d+)>$/.exec(type), info = this.structs.get(type);
    if (!matrix && !array && !info) return `(${left} ${different ? '!=' : '=='} ${right})`;
    // Function arguments evaluate each operand once, even for nested arrays/structures/matrices.
    const name = this.temp('equal'), parts: string[] = [];
    if (info) for (const f of info.fields) parts.push(this.equality(f.arr ? `array<${f.base}, ${f.arr}>` : f.base, `a.${f.name}`, `b.${f.name}`, false));
    else for (let i = 0; i < Number(matrix?.[1] ?? array![2]); i++)
      parts.push(this.equality(matrix ? `vec${matrix[2]}f` : array![1], `a[${i}]`, `b[${i}]`, false));
    this.helpers.push(`fn ${name}(a: ${type}, b: ${type}) -> bool { return ${parts.join(' && ')}; }`);
    return `${different ? '!' : ''}${name}(${left}, ${right})`;
  }

  private copyOut(target: Expr, value: string): string {
    const swizzle = target.swizzle;
    if (!swizzle || swizzle.components.length === 1) return `${target.place} = ${value};`;
    if (new Set(swizzle.components).size !== swizzle.components.length) this.fail('out/inout repeats a swizzle component');
    return [...swizzle.components].map((c, i) => `${swizzle.root}.${c} = ${value}.${'xyzw'[i]};`).join('\n');
  }

  private call(name: string): Expr {
    this.need('('); const args: Expr[] = [];
    const evaluated: { value: Expr; before: string[] }[] = [];
    if (!this.eat(')')) {
      do { evaluated.push(this.capture(() => this.expression())); } while (this.eat(',')); this.need(')');
    }
    const overloads = this.signatures.get(name);
    const exact = overloads?.find(s => s.params.length === evaluated.length && s.params.every((p, i) => p.type === evaluated[i].value.type));
    const compatible = (a: string, b: string) => a === b || a === 'f32' && /^(i32|u32)$/.test(b) || a === 'u32' && b === 'i32';
    // A scalar user overload cannot intercept a different built-in shape (e.g. vector mix).
    const signature = exact ?? overloads?.find(s => s.params.length === evaluated.length && s.params.every((p, i) =>
      p.mode === 'in' ? compatible(p.type, evaluated[i].value.type) : p.type === evaluated[i].value.type));
    const writes: string[] = [];
    for (let i = 0; i < evaluated.length; i++) {
      const { value: a, before } = evaluated[i]; this.pending.push(...before);
      const param = signature?.params[i];
      if (param && param.mode !== 'in') {
        if (!a.place) this.fail('out/inout argument requires matching mutable storage');
        const temp = this.temp('argument');
        this.pending.push(`var ${temp}: ${param.type}${param.mode === 'inout' ? ` = ${a.code}` : ''};`);
        writes.push(this.copyOut(a, temp)); args.push({ code: `&${temp}`, type: a.type });
      } else args.push(signature ? this.save(this.convert(a, param!.type)) :
        evaluated.slice(i + 1).some(e => e.before.length) && !a.type.startsWith('texture') && a.type !== 'depth' && a.type !== 'depthColor' ? this.save(a) : a);
    }
    if (signature) {
      const type = signature.type, call = `${signature.name}(${args.map(a => a.code).join(', ')})`;
      const result = type === 'void' ? { code: '', type } : this.save({ code: call, type });
      if (type === 'void') this.pending.push(`${call};`);
      this.pending.push(...writes); return result;
    }
    const info = this.structs.get(name);
    if (info) {
      if (args.length !== info.fields.length) this.fail(`structure constructor '${name}' requires ${info.fields.length} arguments`);
      const converted = args.map((a, i) => this.convert(a, info.fields[i].arr ?
        `array<${info.fields[i].base}, ${info.fields[i].arr}>` : info.fields[i].base));
      return { code: `${name}(${converted.map(a => a.code).join(', ')})`, type: name };
    }
    if (types[name]) {
      const matrix = /^mat([234])(?:x([234]))?$/.exec(name);
      if (matrix && args.length === 1) {
        const n = Number(matrix[1]), rows = Number(matrix[2] ?? matrix[1]), original = args[0], columns: string[] = [];
        const once = !/^(?:[A-Za-z_]\w*|[\d.]+[iu]?)$/.test(original.code);
        const a = { ...original, code: once ? 'bgt_internal_value' : original.code };
        for (let column = 0; column < n; column++) {
          const values = Array.from({ length: rows }, (_, row) => /^mat/.test(a.type) ?
            column < Number(a.type[3]) && row < Number(a.type[5]) ? `${a.code}[${column}][${row}]` :
              row === column ? '1.0' : '0.0' : row === column ? `f32(${a.code})` : '0.0');
          columns.push(`vec${rows}f(${values.join(', ')})`);
        }
        const result = `${types[name]}(${columns.join(', ')})`;
        if (!once) return { code: result, type: types[name] };
        const helper = `bgt_internal_matrix_${this.temporary++}`;
        this.helpers.push(`fn ${helper}(bgt_internal_value: ${a.type}) -> ${types[name]} { return ${result}; }`);
        return { code: `${helper}(${original.code})`, type: types[name] };
      }
      const converted = args.map(a => /^(f32|i32|u32)$/.test(a.type) ?
        this.convert(a, scalar(types[name])) : a);
      return { code: `${types[name]}(${converted.map(a => a.code).join(', ')})`, type: types[name] };
    }
    if (['texture', 'textureLod', 'textureGrad', 'texelFetch', 'textureSize'].includes(name)) {
      const [t, uv, lod] = args;
      if (!t || !['texture', 'textureI', 'textureU', 'depth', 'depthColor', 'texture3d', 'texture2darray'].includes(t.type)) {
        this.fail('texture requires bgt_tS');
      }
      if (t.type === 'texture3d') {
        if (name === 'textureSize') return { code: `vec3i(textureDimensions(${t.code}, ${uv.code}))`, type: 'vec3i' };
        if (name === 'texelFetch') return { code: `textureLoad(${t.code}, ${uv.code}, ${lod.code})`, type: 'vec4f' };
        const fn3 = name === 'textureLod' ? 'textureSampleLevel' : name === 'textureGrad' ? 'textureSampleGrad' :
          args.length === 3 ? 'textureSampleBias' : 'textureSample';
        return { code: `${fn3}(${t.code}, ${t.code}_sampler, ${args.slice(1).map(a => a.code).join(', ')})`, type: 'vec4f' };
      }
      if (t.type === 'texture2darray') {
        const helper = `bgt_internal_array_${this.temporary++}`, layer = `clamp(i32(floor(c.z + 0.5)), 0, i32(textureNumLayers(${t.code})) - 1)`;
        if (name === 'textureSize') return { code: `vec3i(vec2i(textureDimensions(${t.code}, ${uv.code})), i32(textureNumLayers(${t.code})))`, type: 'vec3i' };
        if (name === 'texelFetch') {
          this.helpers.push(`fn ${helper}(p: vec3i, l: i32) -> vec4f { return textureLoad(${t.code}, p.xy, p.z, l); }`);
          return { code: `${helper}(${uv.code}, ${lod.code})`, type: 'vec4f' };
        }
        if (name === 'textureGrad') {
          this.helpers.push(`fn ${helper}(c: vec3f, dx: vec2f, dy: vec2f) -> vec4f {` +
            ` return textureSampleGrad(${t.code}, ${t.code}_sampler, c.xy, ${layer}, dx, dy); }`);
          return { code: `${helper}(${args.slice(1).map(a => a.code).join(', ')})`, type: 'vec4f' };
        }
        if (name === 'textureLod') {
          this.helpers.push(`fn ${helper}(c: vec3f, l: f32) -> vec4f {` +
            ` return textureSampleLevel(${t.code}, ${t.code}_sampler, c.xy, ${layer}, l); }`);
          return { code: `${helper}(${uv.code}, ${lod.code})`, type: 'vec4f' };
        }
        const biased = args.length === 3;
        this.helpers.push(`fn ${helper}(c: vec3f${biased ? ', b: f32' : ''}) -> vec4f {` +
          ` return ${biased ? 'textureSampleBias' : 'textureSample'}(${t.code}, ${t.code}_sampler, c.xy, ${layer}${biased ? ', b' : ''}); }`);
        return { code: `${helper}(${args.slice(1).map(a => a.code).join(', ')})`, type: 'vec4f' };
      }
      if (name === 'textureSize') return { code: `vec2i(textureDimensions(${t.code}, ${uv.code}))`, type: 'vec2i' };
      if (t.type === 'textureI' || t.type === 'textureU') {
        const result = t.type === 'textureI' ? 'vec4i' : 'vec4u';
        if (name === 'texelFetch') return { code: `textureLoad(${t.code}, ${uv.code}, ${lod.code})`, type: result };
        const slot = Number(t.code.match(/bgt_t([0-7])/)![1]);
        const s = this.integerSamplers.get(slot) ?? [0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0];
        const f = (n: number) => new Float32Array(new Uint32Array([n]).buffer)[0];
        const literal = (n: number) => Number.isInteger(n) ? `${n}.0` : String(n);
        const helper = `bgt_internal_integer_sample_${this.temporary++}`;
        const wrap = (axis: string, mode: number) => mode === 0 ? `clamp(p.${axis},0,size.${axis}-1)` : mode === 1 ?
          `((p.${axis}%size.${axis})+size.${axis})%size.${axis}` :
          `min(((p.${axis}%(size.${axis}*2))+size.${axis}*2)%(size.${axis}*2),size.${axis}*2-1-(((p.${axis}%(size.${axis}*2))+size.${axis}*2)%(size.${axis}*2)))`;
        this.helpers.push(`fn ${helper}(c:vec2f,l:f32)->${result} { let level=${s[3] === 0 ? `min(${Math.floor(f(s[9]))},i32(textureNumLevels(${t.code}))-1)` : `i32(clamp(floor(clamp(l,${literal(f(s[9]))},${literal(f(s[10]))})+0.5),0.0,f32(textureNumLevels(${t.code})-1u)))`}; let size=vec2i(textureDimensions(${t.code},level)); let p=vec2i(floor(c*vec2f(size))); return textureLoad(${t.code},vec2i(${wrap('x',s[4])},${wrap('y',s[5])}),level); }`.replace(/(\d+)\.0\.0/g, '$1.0'));
        let lodExpr = '0.0';
        if (name === 'textureLod') lodExpr = args[2].code;
        else if (name === 'textureGrad') lodExpr = `log2(max(length(${args[2].code}*vec2f(textureDimensions(${t.code}))),length(${args[3].code}*vec2f(textureDimensions(${t.code})))))`;
        else if (this.stage === 2) lodExpr = `log2(max(length(dpdx(${uv.code})*vec2f(textureDimensions(${t.code}))),length(dpdy(${uv.code})*vec2f(textureDimensions(${t.code})))))`;
        if (name === 'texture' && args.length === 3) lodExpr = `(${lodExpr}+${args[2].code})`;
        if (!s[3]) lodExpr = `${Math.floor(f(s[9]))}.0`;
        return { code: `${helper}(${uv.code},${lodExpr})`, type: result };
      }
      if (name === 'texelFetch') {
        const code = `textureLoad(${t.code}, ${uv.code}, ${lod.code})`;
        return { code: t.type === 'depthColor' ? `vec4f(${code}, 0.0, 0.0, 1.0)` : code, type: 'vec4f' };
      }
      if (t.type === 'depth') {
        if (name !== 'texture') this.fail('shadow sampling supports texture() only');
        const helper = `bgt_internal_shadow_${this.temporary++}`;
        this.helpers.push(`fn ${helper}(uv: vec3f) -> f32 {` +
          ` return textureSampleCompare(${t.code}, ${t.code}_sampler, uv.xy, uv.z); }`);
        return { code: `${helper}(${uv.code})`, type: 'f32' };
      }
      const fn = name === 'textureLod' ? 'textureSampleLevel' :
        name === 'textureGrad' ? 'textureSampleGrad' : args.length === 3 ? 'textureSampleBias' : 'textureSample';
      const code = `${fn}(${t.code}, ${t.code}_sampler, ${args.slice(1).map(a => a.code).join(', ')})`;
      return { code: t.type === 'depthColor' ? `vec4f(${code}, 0.0, 0.0, 1.0)` : code, type: 'vec4f' };
    }
    if (name === 'mix' && args.length === 3 && scalar(args[2].type) === 'bool') {
      const [x, y, condition] = args;
      // GLSL's selector overload copies y where true and x where false; it is not interpolation.
      // Keep exact integer/bool types (not f32, which loses uint precision), and preserve unselected NaNs.
      const shape = /^vec[234]/.test(x.type) ? vector(Number(x.type[3]), 'bool') : 'bool';
      if (x.type !== y.type || condition.type !== shape ||
        !/^(f32|i32|u32|bool|vec[234](?:[fiu]|<bool>))$/.test(x.type)) {
        this.fail('mix boolean selector requires matching scalar/vector operand and selector shapes');
      }
      return { code: `select(${x.code}, ${y.code}, ${condition.code})`, type: x.type };
    }
    if (['min', 'max', 'clamp', 'step', 'smoothstep', 'mod'].includes(name)) {
      const type = args.find(a => /^vec[234]/.test(a.type))?.type;
      if (type) for (const a of args) if (/^(f32|i32|u32)$/.test(a.type)) {
        a.code = `${type}(${a.code})`; a.type = type;
      }
    }
    const renamed: Record<string, string> = { dFdx: 'dpdx', dFdy: 'dpdy', inversesqrt: 'inverseSqrt',
      fract: 'fract', atan: args.length === 2 ? 'atan2' : 'atan', mod: 'bgt_internal_mod', roundEven: 'round',
      faceforward: 'faceForward' };
    const relational: Record<string, string> = { lessThan: '<', lessThanEqual: '<=', greaterThan: '>',
      greaterThanEqual: '>=', equal: '==', notEqual: '!=' };
    if (relational[name] && args.length === 2) {
      return { code: `(${args[0].code} ${relational[name]} ${args[1].code})`, type: `vec${args[0].type[3]}<bool>` };
    }
    if (name === 'not' && args.length === 1) return { code: `(!${args[0].code})`, type: args[0].type };
    if (name === 'mod') {
      const helper = `bgt_internal_mod_${this.temporary++}`, type = args[0].type;
      this.helpers.push(`fn ${helper}(x: ${type}, y: ${args[1].type}) -> ${type} { return x - y * floor(x / y); }`);
      return { code: `${helper}(${args.map(a => a.code).join(', ')})`, type };
    }
    const builtins = ['abs', 'acos', 'asin', 'atan', 'ceil', 'clamp', 'cos', 'cross', 'degrees', 'distance', 'dot',
      'exp', 'exp2', 'floor', 'fract', 'fwidth', 'inversesqrt', 'length', 'log', 'log2', 'max', 'min', 'mix',
      'normalize', 'pow', 'radians', 'reflect', 'refract', 'round', 'sign', 'sin', 'smoothstep', 'sqrt', 'step',
      'tan', 'transpose', 'trunc', 'dFdx', 'dFdy', 'determinant', 'all', 'any', 'sinh', 'cosh', 'tanh', 'asinh',
      'acosh', 'atanh', 'roundEven', 'faceforward'];
    const type = builtins.includes(name) ?
      ['dot', 'distance', 'length', 'determinant'].includes(name) ? 'f32' :
        ['all', 'any'].includes(name) ? 'bool' : args[0]?.type : '';
    if (!type) this.fail(`unsupported function '${name}'`);
    return { code: `${renamed[name] ?? name}(${args.map(a => a.code).join(', ')})`, type };
  }
}

export function glslVaryings(source: string, stage: number): string[] {
  const clean = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(`\\b${stage === 1 ? 'out' : 'in'}\\s+(?:(?:highp|mediump|lowp)\\s+)?\\w+\\s+(\\w+)\\s*;`, 'g');
  return [...new Set([...clean.matchAll(re)].map(m => m[1]))].sort();
}

export function translateGLSL(source: string, stage: number, language: number, varyingNames?: string[],
  depthSlots?: ReadonlySet<number>, integerSamplers?: ReadonlyMap<number, readonly number[]>): string {
  return validateWGSL(new GLSL(source, stage, language, varyingNames, depthSlots, integerSamplers).compile(), stage, true);
}

export interface ShaderBinding {
  group: number; binding: number;
  type: 'uniform' | 'texture' | 'textureI' | 'textureU' | 'depth' | 'sampler' | 'comparison' | 'nonfiltering' | 'texture3d' | 'texture2darray';
}
export function shaderBindings(source: string, activeOnly = false): ShaderBinding[] {
  const clean = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const result: ShaderBinding[] = [];
  const re = /((?:@\w+\s*\([^)]*\)\s*)+)var\s*(?:<([^>]+)>\s*)?\w+\s*:\s*([^;]+);/g;
  for (const m of clean.matchAll(re)) {
    if (!/@(?:group|binding)\b/.test(m[1])) continue;
    const group = /@group\s*\(\s*(0x[\da-f]+|\d+)u?\s*\)/i.exec(m[1]);
    const binding = /@binding\s*\(\s*(0x[\da-f]+|\d+)u?\s*\)/i.exec(m[1]);
    if (!group || !binding) throw new Error('WGSL: reflection requires literal @group and @binding numbers');
    const g = Number(group[1]), b = Number(binding[1]);
    const type = m[2]?.trim() === 'uniform' ? 'uniform' : m[3].trim() === 'texture_depth_2d' ? 'depth' :
      /^texture_2d\s*<\s*f32\s*>$/.test(m[3].trim()) ? 'texture' :
      /^texture_2d\s*<\s*i32\s*>$/.test(m[3].trim()) ? 'textureI' :
      /^texture_2d\s*<\s*u32\s*>$/.test(m[3].trim()) ? 'textureU' :
      /^texture_3d\s*<\s*f32\s*>$/.test(m[3].trim()) ? 'texture3d' :
      /^texture_2d_array\s*<\s*f32\s*>$/.test(m[3].trim()) ? 'texture2darray' : m[3].trim() === 'sampler' ? 'sampler' :
      m[3].trim() === 'sampler_comparison' ? 'comparison' : undefined;
    if (!type || (g === 0 ? type !== 'uniform' || b > 7 : g !== 1 || b > 15 ||
      ((type === 'texture' || type === 'textureI' || type === 'textureU' || type === 'depth' || type === 'texture3d' || type === 'texture2darray') ? b % 2 !== 0 :        (type === 'sampler' || type === 'comparison') ? b % 2 !== 1 : true)))
      throw new Error(`WGSL binding @group(${g}) @binding(${b}) violates §13.5`);
    const name = /var\s*(?:<[^>]+>\s*)?(\w+)/.exec(m[0])![1];
    if (!activeOnly || new RegExp(`\\b${name}\\b`).test(clean.replace(m[0], '')))
      result.push({ group: g, binding: b, type });
  }
  return result;
}

export function validateWGSL(source: string, stage: number, internal = false): string {
  if (!internal && reserved.test(source)) throw new Error('WGSL: bgt_internal_ prefix is reserved');
  shaderBindings(source);
  const clean = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  for (const [bit, name, attr] of [[1, 'vs_main', 'vertex'], [2, 'fs_main', 'fragment']] as const)
    if ((stage & bit) && !new RegExp(`@${attr}\\b[\\s\\S]*?fn\\s+${name}\\s*\\(`).test(clean))
      throw new Error(`WGSL: missing @${attr} fn ${name}`);
  if (stage !== 3 && new RegExp(`@${stage === 1 ? 'fragment' : 'vertex'}\\b`).test(clean))
    throw new Error('WGSL: module contains an entry point outside its declared stage');
  if (/@compute\b|var\s*<\s*(storage|workgroup)\b/.test(clean)) throw new Error('WGSL: compute/storage is outside §13');
  return source;
}
