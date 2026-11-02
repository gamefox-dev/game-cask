// SPDX-License-Identifier: CC0-1.0
// Opaque identities cannot be copied into WGSL function storage. Monomorphize sampler
// parameters against the actual uniform identity, including forwarding and numeric overloads.
// This changes neither reflection nor bindings and deliberately adds no texture storage types.
interface Token { text: string; a: number; b: number }
interface Parameter { type: string; name: string; text: string; opaque: boolean }
interface FunctionDecl { name: string; prefix: string; params: Parameter[]; body?: string; a: number; b: number }
const sampler = /^(?:[iu]?sampler)(?:1D|2D|3D|Cube|2DRect|Buffer|1DArray|2DArray|2DMS|2DMSArray)(?:Shadow)?$/;
const qualifiers = new Set(['const', 'in', 'out', 'inout', 'highp', 'mediump', 'lowp']);
function tokens(source: string): Token[] {
  return [...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|[A-Za-z_]\w*|0[xX][\da-fA-F]+[uU]?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[uUfF]?|\S/g)]
    .filter(m => !m[0].startsWith('/*') && !m[0].startsWith('//'))
    .map(m => ({ text: m[0], a: m.index!, b: m.index! + m[0].length }));
}
function closing(t: Token[], i: number, depth = 0): number {
  if (depth === 128) throw new Error('GLSL opaque helper: nesting limit (128)');
  const end = { '(': ')', '[': ']', '{': '}' }[t[i].text];
  if (!end) throw new Error('GLSL opaque helper: expected opening delimiter');
  for (let j = i + 1; j < t.length; j++) {
    if (t[j].text === end) return j;
    if (['(', '[', '{'].includes(t[j].text)) j = closing(t, j, depth + 1);
  }
  throw new Error('GLSL opaque helper: unbalanced delimiters');
}
function parts(t: Token[], a: number, b: number): [number, number][] {
  const result: [number, number][] = []; let start = a;
  for (let i = a; i < b; i++) {
    if (['(', '[', '{'].includes(t[i].text)) i = closing(t, i);
    else if (t[i].text === ',') { result.push([start, i]); start = i + 1; }
  }
  if (start < b) result.push([start, b]);
  return result;
}
export function specializeOpaqueSamplers(source: string): string {
  const t = tokens(source), declarations: FunctionDecl[] = [], uniforms = new Map<string, string>(), uniformArrays = new Set<string>();
  // Find top-level declarations without attempting to reinterpret expression syntax.
  for (let i = 0; i < t.length; i++) {
    if (t[i].text === 'uniform') {
      let ty = i + 1; while (qualifiers.has(t[ty]?.text)) ty++;
      if (sampler.test(t[ty]?.text)) for (let n = ty + 1; n < t.length && t[n].text !== ';'; n++) {
        if (n === ty + 1 || t[n - 1].text === ',') {
          uniforms.set(t[n].text, t[ty].text);
          if (t[n + 1]?.text === '[') uniformArrays.add(t[n].text);
        }
        if (['(', '[', '{'].includes(t[n].text)) n = closing(t, n);
      }
    }
    if (t[i].text === '{') { i = closing(t, i); continue; }
    if (t[i].text !== '(') continue;
    const end = closing(t, i), tail = t[end + 1]?.text;
    if (!['{', ';'].includes(tail) || !/^[A-Za-z_]\w*$/.test(t[i - 1]?.text) ||
      !/^[A-Za-z_]\w*$/.test(t[i - 2]?.text)) { i = end; continue; }
    const returnType = t[i - 2].text;
    if (sampler.test(returnType)) throw new Error('GLSL: functions cannot return opaque samplers');
    const params = parts(t, i + 1, end).filter(([a, b]) => b - a !== 1 || t[a].text !== 'void').map(([a, b]) => {
      const words = t.slice(a, b).map(p => p.text), plain = words.filter(w => !qualifiers.has(w));
      const opaque = sampler.test(plain[0]);
      if (opaque && words.some(w => w === 'out' || w === 'inout'))
        throw new Error('GLSL: opaque sampler parameters must be in (not out or inout)');
      if (opaque && words.includes('[')) throw new Error('GLSL: sampler-array parameters are unsupported; pass constant-indexed elements');
      return { type: plain[0], name: plain[1], text: source.slice(t[a].a, t[b - 1].b), opaque };
    });
    if (params.length > 32) throw new Error('GLSL opaque helper: parameter limit (32)');
    const last = tail === '{' ? closing(t, end + 1) : end + 1;
    let begin = i - 2; while (begin > 0 && ['highp', 'mediump', 'lowp'].includes(t[begin - 1].text)) begin--;
    declarations.push({ name: t[i - 1].text, prefix: source.slice(t[begin].a, t[i - 1].a), params,
      a: t[begin].a, b: t[last].b, body: tail === '{' ? source.slice(t[end + 1].b, t[last].a) : undefined });
    i = last;
  }
  const opaque = declarations.filter(d => d.params.some(p => p.opaque));
  if (!opaque.length) return source;
  const names = new Set(opaque.map(d => d.name));
  const typeNames = new Set(['void', 'float', 'int', 'uint', 'bool', ...uniforms.values(),
    ...t.filter((_, i) => t[i - 1]?.text === 'struct').map(t => t.text)]);
  const isType = (name: string) => typeNames.has(name) || /^(?:[iub]?vec[234]|mat[234](?:x[234])?)$/.test(name) || sampler.test(name);
  const statementEnd = (ts: Token[], i: number, depth = 0): number => {
    if (depth === 128) throw new Error('GLSL opaque helper: statement nesting limit (128)');
    if (ts[i]?.text === '{') return closing(ts, i) + 1;
    if (['if', 'for', 'while'].includes(ts[i]?.text)) {
      const end = statementEnd(ts, closing(ts, i + 1) + 1, depth + 1);
      return ts[i].text === 'if' && ts[end]?.text === 'else' ? statementEnd(ts, end + 1, depth + 1) : end;
    }
    for (let j = i; j < ts.length; j++) {
      if (ts[j].text === ';') return j + 1;
      if (['(', '[', '{'].includes(ts[j].text)) j = closing(ts, j);
    }
    return ts.length;
  };
  const instances: { decl: FunctionDecl; actuals: (string | undefined)[]; name: string; body?: string }[] = [];
  const used = new Set(t.map(p => p.text));
  let nextLocal = 0;
  const localName = () => { let n: string; do { n = `bgt_gl_local_${nextLocal++}`; } while (used.has(n)); used.add(n); return n; };
  const parameterNames = new Map<FunctionDecl, Map<string, string | undefined>>();
  for (const d of declarations) parameterNames.set(d, new Map(d.params.filter(p => !p.opaque).map(p => [p.name, uniforms.has(p.name) ? localName() : undefined])));
  const parameterText = (d: FunctionDecl, p: Parameter) => p.text.replace(/\b[A-Za-z_]\w*\b/g, name => parameterNames.get(d)?.get(name) ?? name);
  const rewrite = (text: string, env: Map<string, string | undefined>, validationOnly = false, opaqueParameters: ReadonlyMap<string, string> = new Map()): string => {
    const ts = tokens(text); let out = '', from = 0;
    const structRanges: [number, number][] = [];
    for (let i = 0; i < ts.length; i++) if (ts[i].text === 'struct' && ts[i + 1]?.text && ts[i + 2]?.text === '{')
      structRanges.push([i + 2, closing(ts, i + 2)]);
    const inStruct = (index: number) => structRanges.some(([a, b]) => index > a && index < b);
    const scopes: { end: number; env: Map<string, string | undefined> }[] = [];
    const locals = new Map<number, string>(), implicitScopes = new Map<number, number>();
    for (let i = 0; i < ts.length; i++) if (['if', 'for', 'while'].includes(ts[i].text) && ts[i + 1]?.text === '(') {
      const start = closing(ts, i + 1) + 1, end = statementEnd(ts, start);
      if (ts[start]?.text !== '{') implicitScopes.set(start, end);
      if (ts[i].text === 'if' && ts[end]?.text === 'else' && ts[end + 1]?.text !== '{')
        implicitScopes.set(end + 1, statementEnd(ts, end + 1));
    }
    for (let i = 0; i < ts.length - 1; i++) if (isType(ts[i].text) && /^[A-Za-z_]\w*$/.test(ts[i + 1].text)) {
      if (validationOnly && sampler.test(ts[i].text)) throw new Error('GLSL: opaque sampler local variables are forbidden');
      let j = i + 1; locals.set(j, ts[j].text);
      while (++j < ts.length && ts[j].text !== ';') {
        if (['(', '[', '{'].includes(ts[j].text)) j = closing(ts, j);
        else if (ts[j].text === ',' && /^[A-Za-z_]\w*$/.test(ts[j + 1]?.text)) { j++; locals.set(j, ts[j].text); }
      }
    }
    env = new Map(env);
    const identity = (a: number, b: number): string | undefined => {
      while (ts[a]?.text === '(' && closing(ts, a) === b - 1) { a++; b--; }
      if (b - a !== 1) return undefined;
      const name = ts[a].text, actual = env.has(name) ? env.get(name) : name;
      return actual !== undefined && (uniforms.has(actual) || validationOnly && opaqueParameters.has(actual)) ? actual : undefined;
    };
    for (let i = 0; i < ts.length; i++) {
      const token = ts[i];
      while (scopes.length && i >= scopes[scopes.length - 1].end) env = scopes.pop()!.env;
      if (implicitScopes.has(i)) scopes.push({ end: implicitScopes.get(i)!, env: new Map(env) });
      if (token.text === '{' || ['if', 'for', 'while'].includes(token.text)) scopes.push({ end: token.text === '{' ? closing(ts, i) + 1 : statementEnd(ts, i), env: new Map(env) });
      if (inStruct(i)) continue; // Member declarations never bind lexical variable identities.
      if (locals.has(i)) { const name = locals.get(i)!; env.set(name, uniforms.has(name) ? localName() : undefined); }
      if (ts[i - 1]?.text === '.') continue;
      const actual = env.has(token.text) ? env.get(token.text) : uniforms.has(token.text) ? token.text : undefined;
      const opaqueValue = actual !== undefined && (uniforms.has(actual) || opaqueParameters.has(actual));
      if (validationOnly && names.has(token.text) && ts[i + 1]?.text === '(') {
        const end = closing(ts, i + 1), args = parts(ts, i + 2, end);
        const matching = declarations.filter(d => d.name === token.text && d.params.length === args.length && d.params.every((p, k) => {
          const candidate = identity(...args[k]);
          const type = candidate ? (opaqueParameters.get(candidate) ?? uniforms.get(candidate)) : undefined;
          return p.opaque ? type === p.type : type === undefined;
        }));
        if (!matching.length) throw new Error(`GLSL: no matching opaque helper overload '${token.text}' (pass unmodified sampler identities with matching types and argument count)`);
      }
      if (validationOnly && opaqueValue) {
        if ((ts[i + 1]?.text === '[') !== (!opaqueParameters.has(actual!) && uniformArrays.has(actual!)))
          throw new Error('GLSL: opaque sampler scalar/array identity mismatch');
        let a = i, b = ts[i + 1]?.text === '[' ? closing(ts, i + 1) + 1 : i + 1;
        while (ts[a - 1]?.text === '(' && ts[b]?.text === ')' && closing(ts, a - 1) === b &&
          !/^[A-Za-z_]\w*$/.test(ts[a - 2]?.text ?? '')) { a--; b++; }
        const callStack: { name: string; arg: number; kind: string; open: number }[] = [];
        for (let p = 0; p < a; p++) {
          if (['(', '['].includes(ts[p].text)) callStack.push({ name: ts[p - 1]?.text ?? '', arg: 0, kind: ts[p].text, open: p });
          else if ([')', ']'].includes(ts[p].text)) callStack.pop();
          else if (ts[p].text === ',' && callStack.length) callStack[callStack.length - 1].arg++;
        }
        const call = callStack[callStack.length - 1];
        const builtin = call?.arg === 0 && /^(?:texture(?:Lod|Grad|Size|Proj|Offset|ProjLod|ProjGrad|ProjOffset|LodOffset|GradOffset|Gather|GatherOffset|QueryLod|QueryLevels|ProjLodOffset|ProjGradOffset|Samples)?|texelFetch(?:Offset)?)$/.test(call.name);
        if (builtin && ['texture', 'textureLod', 'textureGrad', 'texelFetch', 'textureSize'].includes(call.name)) {
          const args = parts(ts, call.open + 1, closing(ts, call.open));
          const count = call.name === 'texture' ? [2, 3] : [call.name === 'textureGrad' ? 4 : call.name === 'textureSize' ? 2 : 3];
          const type = opaqueParameters.get(actual!) ?? uniforms.get(actual!);
          if (/^(?:[iu]?sampler2D|sampler3D|sampler2DArray|sampler2DShadow)$/.test(type ?? '')) {
            if (!count.includes(args.length)) throw new Error('GLSL: invalid opaque texture builtin argument count');
            if (call.name !== 'textureSize') {
              const [ca, cb] = args[1], constructor = ts[ca]?.text;
              const expected = call.name === 'texelFetch' ? (type === 'sampler3D' || type === 'sampler2DArray' ? 'ivec3' : 'ivec2') :
                type === 'sampler3D' || type === 'sampler2DArray' || type === 'sampler2DShadow' ? 'vec3' : 'vec2';
              if (/^(?:[iub]?vec[234]|float|int|uint|bool|mat\w+)$/.test(constructor) && ts[ca + 1]?.text === '(' && closing(ts, ca + 1) === cb - 1 && constructor !== expected)
                throw new Error('GLSL: invalid opaque texture builtin coordinate type');
            }
          }
        }
        const parameter = call && declarations.some(d => d.name === call.name && d.params[call.arg]?.opaque);
        if (!['(', ','].includes(ts[a - 1]?.text) || ![')', ','].includes(ts[b]?.text) || call?.kind !== '(' || !builtin && !parameter)
          throw new Error('GLSL: opaque sampler arithmetic/assignment is forbidden; pass unmodified sampler identities to matching opaque parameters or texture builtins');
      }
      if (!validationOnly && names.has(token.text) && ts[i + 1]?.text === '(') {
        const end = closing(ts, i + 1), args = parts(ts, i + 2, end), actuals = args.map(([a, b]) => identity(a, b));
        const matching = declarations.filter(d => d.name === token.text && d.params.length === args.length &&
          d.params.every((p, k) => p.opaque ? !!actuals[k] && uniforms.get(actuals[k]!) === p.type : !actuals[k]));
        if (!matching.length) throw new Error(`GLSL: no matching opaque helper overload '${token.text}' (pass unmodified sampler identities with matching types and argument count)`);
        if (matching.some(d => !d.params.some(p => p.opaque))) continue;
        let family: string | undefined;
        for (const decl of matching.filter(d => d.body !== undefined)) {
          let inst = instances.find(s => s.decl === decl && s.actuals.every((a, k) => a === actuals[k]));
          if (!inst) {
            if (instances.length === 256) throw new Error('GLSL opaque helper: specialization limit (256)');
            family ??= instances.find(s => s.decl.name === decl.name && s.actuals.length === actuals.length &&
              s.actuals.every((a, k) => a === actuals[k]))?.name;
            if (!family) { let id = instances.length; do { family = `bgt_gl_opaque_${id++}`; } while (used.has(family)); used.add(family); }
            inst = { decl, actuals, name: family }; instances.push(inst);
          }
          family = inst.name;
        }
        if (!family) throw new Error(`GLSL opaque helper '${token.text}' has no definition`);
        out += text.slice(from, token.a) + family + '(' + args.flatMap(([a, b], k) => actuals[k] ? [] :
          [rewrite(text.slice(ts[a].a, ts[b - 1].b), env)]).join(',') + ')';
        from = ts[end].b; i = end;
      } else if (env.get(token.text) !== undefined) {
        out += text.slice(from, token.a) + env.get(token.text); from = token.b;
      }
    }
    const result = out + text.slice(from);
    if (result.length > 1048576) throw new Error('GLSL opaque helper expansion exceeds 1 MiB');
    return result;
  };
  for (const d of declarations) if (d.body !== undefined) {
    const env = new Map(parameterNames.get(d)), opaqueParameters = new Map<string, string>();
    for (const p of d.params) if (p.opaque) { env.set(p.name, p.name); opaqueParameters.set(p.name, p.type); }
    rewrite(d.body, env, true, opaqueParameters);
  }
  let original = '', pos = 0;
  for (const d of declarations) { original += source.slice(pos, d.a) + source.slice(d.a, d.b).replace(/[^\n]/g, ' '); pos = d.b; }
  original += source.slice(pos);
  // Hoist globals/struct types before forward declarations. Preserve ordinary function order;
  // definitions are rewritten in their parameter scope, not as untyped global text.
  const ordinary = declarations.filter(d => !d.params.some(p => p.opaque)).map(d => {
    const env = parameterNames.get(d)!;
    const signature = d.prefix + d.name + '(' + d.params.map(p => parameterText(d, p)).join(',') + ')';
    return d.body === undefined ? signature + ';' : signature + '{' + rewrite(d.body, env) + '}';
  }).join('\n');
  let expandedBytes = original.length + ordinary.length;
  for (let k = 0; k < instances.length; k++) {
    const inst = instances[k], env = new Map(parameterNames.get(inst.decl));
    inst.decl.params.forEach((p, i) => { if (p.opaque) env.set(p.name, inst.actuals[i]!); });
    inst.body = rewrite(inst.decl.body!, env);
    expandedBytes += inst.body.length;
    if (expandedBytes > 1048576) throw new Error('GLSL opaque helper expansion exceeds 1 MiB');
  }
  const signature = (s: typeof instances[number]) => `${s.decl.prefix}${s.name}(${s.decl.params.filter(p => !p.opaque).map(p => parameterText(s.decl, p)).join(',')})`;
  const prototypes = instances.map(s => signature(s) + ';').join('\n') + '\n';
  const definitions = instances.map(s => signature(s) + '{' + s.body + '}').join('\n') + '\n';
  const result = original + '\n' + prototypes + ordinary + '\n' + definitions;
  if (result.length > 1048576) throw new Error('GLSL opaque helper expansion exceeds 1 MiB');
  return result;
}
