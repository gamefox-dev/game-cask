// Local, engine-independent GLSL 330/ES 300 frontend. Unsupported syntax is a compile error, never guessed.
// Native WebGPU validates the resulting WGSL; errors retain the original token/line where possible.
type Token = { text: string; line: number };
type Expr = { code: string; type: string };
const types: Record<string, string> = {
  void: 'void', float: 'f32', int: 'i32', uint: 'u32', bool: 'bool',
  vec2: 'vec2f', vec3: 'vec3f', vec4: 'vec4f', ivec2: 'vec2i', ivec3: 'vec3i', ivec4: 'vec4i',
  uvec2: 'vec2u', uvec3: 'vec3u', uvec4: 'vec4u', bvec2: 'vec2<bool>', bvec3: 'vec3<bool>', bvec4: 'vec4<bool>',
  mat2: 'mat2x2f', mat3: 'mat3x3f', mat4: 'mat4x4f',
};
const scalar = (t: string) => t.endsWith('u') || t === 'u32' ? 'u32' : t.endsWith('i') || t === 'i32' ? 'i32' : 'f32';
const vector = (n: number, t: string) => n === 1 ? scalar(t) : `vec${n}${scalar(t)[0]}`;
const reserved = /\bbgt_internal_\w*/;

function lex(source: string): Token[] {
  const result: Token[] = [];
  let line = 1;
  const re = new RegExp([
    String.raw`\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/`,
    String.raw`(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[uUfF]?|[A-Za-z_]\w*`,
    String.raw`<<=|>>=|\+\+|--|<=|>=|==|!=|&&|\|\||<<|>>|[+*/%&|^!-]=`,
    String.raw`[{}()[\].,;:?~+*/%&|^!<>=-]`,
  ].join('|'), 'gy');
  let offset = 0;
  while (offset < source.length) {
    re.lastIndex = offset;
    const m = re.exec(source);
    if (!m) throw new Error(`GLSL line ${line}: unexpected character ${JSON.stringify(source[offset])}`);
    const text = m[0];
    if (!/^\s|^\/\//.test(text) && !text.startsWith('/*')) result.push({ text, line });
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

  private varyings: string[];
  constructor(source: string, private stage: number, language: number, varyingNames?: string[],
    private depthSlots: ReadonlySet<number> = new Set()) {
    this.varyings = varyingNames ?? glslVaryings(source, stage);
    const version = language === 1 ? /^\s*#version\s+330\s+core\s*(?:\r?\n|$)/ :
      /^\s*#version\s+300\s+es\s*(?:\r?\n|$)/;
    const match = source.match(version);
    if (!match) throw new Error(`GLSL: expected ${language === 1 ? '#version 330 core' : '#version 300 es'}`);
    if (reserved.test(source)) throw new Error('GLSL: bgt_internal_ prefix is reserved');
    source = source.slice(match[0].length);
    if (/#/.test(source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')))
      throw new Error('GLSL: preprocessor directives other than #version are not supported');
    this.tokens = lex('\n' + source);
    this.variables.set('gl_Position', { code: 'bgt_internal_position', type: 'vec4f' });
    for (const n of ['bgt_vertex_index', 'bgt_instance_index']) this.variables.set(n, { code: n, type: 'u32' });
    for (const n of ['bgt_frag_coord', 'gl_FragCoord'])
      this.variables.set(n, { code: 'bgt_frag_coord', type: 'vec4f' });
    this.variables.set('gl_FrontFacing', { code: 'bgt_internal_front', type: 'bool' });
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
  private type(): string {
    while (['highp', 'mediump', 'lowp'].includes(this.peek())) this.take();
    const n = this.take(); if (!types[n]) this.fail(`unsupported type '${n}'`); return types[n];
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
        this.variables.set(name, { code: name, type });
        if (direction === 'in') {
          this.input.push(`${decoration}${name}: ${type}`); this.inputs.push(`${name} = bgt_internal_in.${name};`);
        } else {
          this.output.push(`${decoration}${name}: ${type}`); this.outputs.push(`bgt_internal_out.${name} = ${name};`);
        }
        continue;
      }
      const constant = this.eat('const'), type = this.type(), name = this.name();
      if (this.eat('(')) {
        const params: string[] = [];
        const saved = new Map(this.variables), savedLocals = this.locals, savedReturnType = this.returnType;
        this.locals = new Set(); this.returnType = type;
        if (!this.eat(')')) {
          if (this.peek() === 'void' && this.peek(1) === ')') { this.take(); this.take(); }
          else {
            do {
              if (this.peek() === 'in') this.take();
              if (['out', 'inout'].includes(this.peek())) this.fail('out/inout function parameters are unsupported');
              const t = this.type(), n = this.name();
              params.push(`${n}: ${t}`); this.variables.set(n, { code: n, type: t }); this.locals.add(n);
            } while (this.eat(','));
            this.need(')');
          }
        }
        this.functions.set(name, type);
        const body = this.block(); this.variables = saved;
        this.locals = savedLocals; this.returnType = savedReturnType;
        const signature = `fn ${name === 'main' ? 'bgt_internal_main' : name}(${params.join(', ')})`;
        bodies.push(`${signature}${type === 'void' ? '' : ` -> ${type}`} ${body}`);
      } else {
        const suffix = this.array(type); this.variables.set(name, { code: name, type: suffix });
        const init = this.eat('=') ? this.convert(this.expression(), suffix).code : undefined; this.need(';');
        if (constant && !init) this.fail('const requires initializer');
        this.declarations.push(`${constant ? 'const' : 'var<private>'} ${name}: ${suffix}${init ? ` = ${init}` : ''};`);
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
        'var<private> bgt_vertex_index: u32;', 'var<private> bgt_instance_index: u32;');
    } else {
      this.input.push('@builtin(position) bgt_frag_coord: vec4f', '@builtin(front_facing) bgt_internal_front: bool');
      this.inputs.push('bgt_frag_coord = bgt_internal_in.bgt_frag_coord;',
        'bgt_internal_front = bgt_internal_in.bgt_internal_front;');
      this.declarations.push('var<private> bgt_frag_coord: vec4f;', 'var<private> bgt_internal_front: bool;');
    }
    const entry = this.stage === 1 ? 'vertex' : 'fragment';
    return [...this.declarations,
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
    this.need('{'); const members: string[] = [], names: { name: string; type: string; matrix2: boolean }[] = [];
    while (!this.eat('}')) {
      const type = this.type(), n = this.name(), array = this.array(type); this.need(';');
      if (array !== type && !/vec4|mat[34]/.test(type))
        this.fail('std140 scalar/vec2/vec3 arrays require explicit vec4 padding');
      const alignment = /vec[34]|mat|array/.test(array) ? 16 : /vec2/.test(type) ? 8 : 4;
      members.push(`@align(${alignment}) ${n}: ${type === 'mat2x2f' ? 'mat2x4f' : array}`);
      names.push({ name: n, type: array, matrix2: type === 'mat2x2f' });
    }
    const instance = this.peek() === ';' ? `bgt_internal_${name}` : this.name(); this.need(';');
    this.declarations.push(`struct ${name} { ${members.join(', ')} };`,
      `@group(0) @binding(${slot[1]}) var<uniform> ${instance}: ${name};`);
    const read = (root: string, n: typeof names[number]) => n.matrix2 ?
      `mat2x2f(${root}.${n.name}[0].xy, ${root}.${n.name}[1].xy)` : `${root}.${n.name}`;
    if (instance.startsWith('bgt_internal_')) for (const n of names)
      this.variables.set(n.name, { code: read(instance, n), type: n.type });
    else {
      this.variables.set(instance, { code: instance, type: name });
      for (const n of names) this.variables.set(`${name}.${n.name}`, { code: read('$', n), type: n.type });
    }
  }

  private array(type: string): string {
    if (!this.eat('[')) return type;
    const n = Number(this.take());
    if (!Number.isInteger(n) || n < 1) this.fail('array requires positive constant length');
    this.need(']'); return `array<${type}, ${n}>`;
  }

  private block(): string {
    this.need('{'); const statements: string[] = [], saved = new Map(this.variables);
    const savedLocals = new Set(this.locals);
    while (!this.eat('}')) statements.push(this.statement());
    this.variables = saved; this.locals = savedLocals;
    return `{\n${statements.join('\n')}\n}`;
  }

  private statement(): string {
    if (this.peek() === '{') return this.block();
    if (this.eat(';')) return '';
    if (this.eat('if')) {
      this.need('('); const e = this.expression(); this.need(')'); const yes = this.statement();
      return `if (${e.code}) ${this.braces(yes)}${this.eat('else') ? ` else ${this.braces(this.statement())}` : ''}`;
    }
    if (this.eat('for')) {
      this.need('('); const init = this.statement(); const cond = this.expression(); this.need(';');
      const step = this.simple(false); this.need(')'); const body = this.statement();
      return `for (${init} ${cond.code}; ${step}) ${this.braces(body)}`;
    }
    if (this.eat('while')) {
      this.need('('); const cond = this.expression(); this.need(')');
      return `while (${cond.code}) ${this.braces(this.statement())}`;
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
    if (this.peek() === '++' || this.peek() === '--') {
      const op = this.take(), e = this.expression(); if (semicolon) this.need(';');
      return `${e.code}${op}${semicolon ? ';' : ''}`;
    }
    const constant = this.eat('const');
    let result: string;
    if (types[this.peek()] || ['highp', 'mediump', 'lowp'].includes(this.peek())) {
      const type = this.type(), n = this.name(), array = this.array(type);
      this.variables.set(n, { code: n, type: array });
      const init = this.eat('=') ? this.convert(this.expression(), array).code : undefined;
      this.locals.add(n);
      result = `${constant ? 'let' : 'var'} ${n}: ${array}${init ? ` = ${init}` : ''}`;
      if (this.peek() === ',') this.fail('split multiple variable declarations into separate statements');
    } else {
      const lhs = this.expression();
      if (['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='].includes(this.peek())) {
        const op = this.take(), rhs = this.convert(this.expression(), lhs.type);
        const swizzle = /^(.*)\.([xyzw]{2,4})$/.exec(lhs.code);
        if (swizzle) {
          if (new Set(swizzle[2]).size !== swizzle[2].length) this.fail('assignment repeats a swizzle component');
          const temp = `bgt_internal_swizzle_${this.temporary++}`;
          const assignments = [...swizzle[2]].map((c, i) =>
            `${swizzle[1]}.${c} ${op} ${temp}${/^vec/.test(rhs.type) ? `.${'xyzw'[i]}` : ''};`);
          result = `{ let ${temp} = ${rhs.code}; ${assignments.join(' ')} }`;
        } else result = `${lhs.code} ${op} ${rhs.code}`;
      } else if (this.eat('++')) result = `${lhs.code}++`;
      else if (this.eat('--')) result = `${lhs.code}--`;
      else result = lhs.code;
    }
    if (semicolon) this.need(';'); return result + (semicolon && !result.startsWith('{') ? ';' : '');
  }

  private convert(e: Expr, type: string): Expr {
    if (e.type === type) return e;
    if (/^(f32|i32|u32)$/.test(type) || (/^vec/.test(type) && /^vec/.test(e.type)))
      return { code: `${type}(${e.code})`, type };
    return e;
  }

  private expression(min = 0): Expr {
    let lhs: Expr;
    const n = this.take();
    if (['-', '+', '!', '~'].includes(n)) {
      const e = this.expression(12); lhs = { code: n === '+' ? e.code : `(${n}${e.code})`, type: e.type };
    } else if (n === '(') { lhs = this.expression(); this.need(')'); lhs.code = `(${lhs.code})`; }
    else if (/^(\d|\.)/.test(n)) {
      const type = /u$/i.test(n) ? 'u32' : /[.eEfF]/.test(n) ? 'f32' : 'i32';
      let code = n.replace(/[uUfF]$/, '');
      if (type === 'f32' && !/[.eE]/.test(code)) code += '.0';
      if (type === 'u32') code += 'u';
      if (type === 'i32') code += 'i';
      lhs = { code, type };
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
      if (n.startsWith('gl_') && !['gl_Position', 'gl_FragCoord', 'gl_FrontFacing'].includes(n))
        this.fail(`unsupported builtin ${n}`);
    }
    while (true) {
      if (this.eat('.')) {
        const member = this.name(), known = this.variables.get(`${lhs.type}.${member}`);
        const type = known?.type ?? vector(member.length, lhs.type);
        const swizzle = member.replace(/[rgba]/g, c => ({ r: 'x', g: 'y', b: 'z', a: 'w' })[c]!);
        lhs = { code: known ? known.code.replace(/\$/g, lhs.code) : `${lhs.code}.${swizzle}`, type }; continue;
      }
      if (this.eat('[')) {
        const index = this.expression(); this.need(']');
        const type = /^array<(.+),/.exec(lhs.type)?.[1] ??
          (/^mat\d+x(\d)f$/.test(lhs.type) ? `vec${/^mat\d+x(\d)f$/.exec(lhs.type)![1]}f` : scalar(lhs.type));
        lhs = { code: `${lhs.code}[${index.code}]`, type }; continue;
      }
      const op = this.peek(), precedence: Record<string, number> = {
        '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7,
        '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
      };
      const p = precedence[op]; if (!p || p < min) break;
      this.take(); let rhs = this.expression(p + 1);
      const promote = scalar(lhs.type) === 'f32' || scalar(rhs.type) === 'f32' ? 'f32' :
        scalar(lhs.type) === 'u32' || scalar(rhs.type) === 'u32' ? 'u32' : 'i32';
      const promoted = (e: Expr) => /^vec/.test(e.type) ? vector(Number(e.type[3]), promote) :
        /^(f32|i32|u32)$/.test(e.type) ? promote : e.type;
      if (op === '<<' || op === '>>') rhs = this.convert(rhs,
        /^vec/.test(rhs.type) ? vector(Number(rhs.type[3]), 'u32') : 'u32');
      else if (p > 2 && lhs.type !== 'bool' && rhs.type !== 'bool') {
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
      lhs = { code: `(${left} ${op} ${right})`, type };
    }
    if (min === 0 && this.eat('?')) {
      let yes = this.expression(); this.need(':'); let no = this.expression();
      if (yes.type !== no.type) {
        if (scalar(yes.type) === 'f32') no = this.convert(no, yes.type);
        else yes = this.convert(yes, no.type);
      }
      const name = `bgt_internal_cond_${this.temporary++}`;
      const locals = [...this.locals].map(n => [n, this.variables.get(n)!.type] as const);
      const parameters = locals.map(([n, t]) => `${n}: ${t}`);
      this.helpers.push(`fn ${name}(bgt_internal_condition: bool` +
        `${parameters.length ? ', ' + parameters.join(', ') : ''}) -> ${yes.type} {` +
        ` if (bgt_internal_condition) { return ${yes.code}; } return ${no.code}; }`);
      lhs = { code: `${name}(${[lhs.code, ...locals.map(([n]) => n)].join(', ')})`, type: yes.type };
    }
    return lhs;
  }

  private call(name: string): Expr {
    this.need('('); const args: Expr[] = [];
    if (!this.eat(')')) {
      do { args.push(this.expression()); } while (this.eat(',')); this.need(')');
    }
    if (types[name]) {
      const matrix = /^mat([234])$/.exec(name);
      if (matrix && args.length === 1) {
        const n = Number(matrix[1]), original = args[0], columns: string[] = [];
        const once = !/^(?:[A-Za-z_]\w*|[\d.]+[iu]?)$/.test(original.code);
        const a = { ...original, code: once ? 'bgt_internal_value' : original.code };
        for (let column = 0; column < n; column++) {
          const values = Array.from({ length: n }, (_, row) => /^mat/.test(a.type) ?
            column < Number(a.type[3]) && row < Number(a.type[5]) ? `${a.code}[${column}][${row}]` :
              row === column ? '1.0' : '0.0' : row === column ? `f32(${a.code})` : '0.0');
          columns.push(`vec${n}f(${values.join(', ')})`);
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
      if (!t || !['texture', 'depth', 'depthColor', 'texture3d', 'texture2darray'].includes(t.type)) {
        this.fail('texture requires bgt_tS');
      }
      if (t.type === 'texture3d') {
        if (name === 'textureSize') return { code: `vec3i(textureDimensions(${t.code}, ${uv.code}))`, type: 'vec3i' };
        if (name === 'texelFetch') return { code: `textureLoad(${t.code}, ${uv.code}, ${lod.code})`, type: 'vec4f' };
        const fn3 = name === 'textureLod' ? 'textureSampleLevel' : name === 'textureGrad' ? 'textureSampleGrad' : 'textureSample';
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
        this.helpers.push(`fn ${helper}(c: vec3f) -> vec4f {` +
          ` return textureSample(${t.code}, ${t.code}_sampler, c.xy, ${layer}); }`);
        return { code: `${helper}(${uv.code})`, type: 'vec4f' };
      }
      if (name === 'textureSize') return { code: `vec2i(textureDimensions(${t.code}, ${uv.code}))`, type: 'vec2i' };
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
        name === 'textureGrad' ? 'textureSampleGrad' : 'textureSample';
      const code = `${fn}(${t.code}, ${t.code}_sampler, ${args.slice(1).map(a => a.code).join(', ')})`;
      return { code: t.type === 'depthColor' ? `vec4f(${code}, 0.0, 0.0, 1.0)` : code, type: 'vec4f' };
    }
    if (['min', 'max', 'clamp', 'step', 'smoothstep', 'mod'].includes(name)) {
      const type = args.find(a => /^vec[234]/.test(a.type))?.type;
      if (type) for (const a of args) if (/^(f32|i32|u32)$/.test(a.type)) {
        a.code = `${type}(${a.code})`; a.type = type;
      }
    }
    const renamed: Record<string, string> = { dFdx: 'dpdx', dFdy: 'dpdy', inversesqrt: 'inverseSqrt',
      fract: 'fract', atan: args.length === 2 ? 'atan2' : 'atan', mod: 'bgt_internal_mod' };
    if (name === 'mod') {
      const helper = `bgt_internal_mod_${this.temporary++}`, type = args[0].type;
      this.helpers.push(`fn ${helper}(x: ${type}, y: ${args[1].type}) -> ${type} { return x - y * floor(x / y); }`);
      return { code: `${helper}(${args.map(a => a.code).join(', ')})`, type };
    }
    const builtins = ['abs', 'acos', 'asin', 'atan', 'ceil', 'clamp', 'cos', 'cross', 'degrees', 'distance', 'dot',
      'exp', 'exp2', 'floor', 'fract', 'fwidth', 'inversesqrt', 'length', 'log', 'log2', 'max', 'min', 'mix',
      'normalize', 'pow', 'radians', 'reflect', 'refract', 'round', 'sign', 'sin', 'smoothstep', 'sqrt', 'step',
      'tan', 'transpose', 'trunc', 'dFdx', 'dFdy', 'determinant', 'all', 'any'];
    const type = this.functions.get(name) ?? (builtins.includes(name) ?
      ['dot', 'distance', 'length', 'determinant'].includes(name) ? 'f32' :
        ['all', 'any'].includes(name) ? 'bool' : args[0]?.type : '');
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
  depthSlots?: ReadonlySet<number>): string {
  return validateWGSL(new GLSL(source, stage, language, varyingNames, depthSlots).compile(), stage, true);
}

export interface ShaderBinding {
  group: number; binding: number;
  type: 'uniform' | 'texture' | 'depth' | 'sampler' | 'comparison' | 'nonfiltering' | 'texture3d' | 'texture2darray';
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
      /^texture_3d\s*<\s*f32\s*>$/.test(m[3].trim()) ? 'texture3d' :
      /^texture_2d_array\s*<\s*f32\s*>$/.test(m[3].trim()) ? 'texture2darray' : m[3].trim() === 'sampler' ? 'sampler' :
      m[3].trim() === 'sampler_comparison' ? 'comparison' : undefined;
    if (!type || (g === 0 ? type !== 'uniform' || b > 7 : g !== 1 || b > 15 ||
      ((type === 'texture' || type === 'depth' || type === 'texture3d' || type === 'texture2darray') ? b % 2 !== 0 :
        (type === 'sampler' || type === 'comparison') ? b % 2 !== 1 : true)))
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
