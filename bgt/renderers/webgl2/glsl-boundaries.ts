// Contain a native ANGLE failure before submitting GLSL. This is rejection, not emulation:
// dynamically indexing a multi-component vector swizzle passed to out/inout is outside the W2 subset.
export const indexedSwizzleDiagnostic = 'WebGL 2 native boundary: out/inout argument indexes a multi-component swizzle';
type FunctionShape = { types: string[]; output: Set<number> };
export function validateNativeLvalues(source: string): void {
  const fields = new Map<string, Map<string, string>>();
  for (const s of source.matchAll(/\bstruct\s+(\w+)\s*\{([^{}]*)\}/g)) {
    const members = new Map<string, string>();
    for (const declaration of s[2].split(';')) {
      const m = /^\s*(\w+)\s+(.+)$/.exec(declaration); if (!m) continue;
      for (const part of m[2].split(',')) { const n = /^\s*(\w+)\s*(\[[^]]*\])?/.exec(part); if (n) members.set(n[1], m[1] + (n[2] ? '[]' : '')); }
    }
    fields.set(s[1], members);
  }
  const scopes: { start: number; end: number }[] = [{ start: 0, end: source.length }], stack = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '{') { scopes.push({ start: i, end: source.length }); stack.push(scopes.length - 1); }
    else if (source[i] === '}') { const scope = stack.pop(); if (scope !== undefined) scopes[scope].end = i; }
  }
  const declarations: { name: string; type: string; start: number; end: number }[] = [];
  const typePattern = '(?:[iub]?vec[234]|float|int|uint|bool|mat[234](?:x[234])?' + [...fields.keys()].map(n => '|' + n).join('') + ')';
  const vars = new RegExp(`\\b(${typePattern})\\s+([^;{}]+)`, 'g');
  for (const m of source.matchAll(vars)) {
    const pos = m.index!, scope = scopes.filter(s => s.start <= pos && pos <= s.end).at(-1)!;
    for (const part of m[2].split(',')) { const n = /^\s*(\w+)\s*(\[[^\]]*\])?/.exec(part); if (n) declarations.push({ name: n[1], type: m[1] + (n[2] ? '[]' : ''), start: pos, end: scope.end }); }
  }
  const storageType = (text: string, pos: number): string | undefined => {
    if (/^\s*-?\d+[uU]\s*$/.test(text)) return 'uint';
    if (/^\s*-?\d+\s*$/.test(text)) return 'int';
    if (/^\s*-?\d+\.\d*\s*$/.test(text)) return 'float';
    const tokens = text.replace(/[()]/g, '').match(/[A-Za-z_]\w*|\[[^\]]*\]|\./g); if (!tokens?.length) return undefined;
    let type = declarations.filter(d => d.name === tokens[0] && d.start < pos && d.end >= pos).at(-1)?.type;
    for (let i = 1; type && i < tokens.length; i++) {
      if (tokens[i] === '.') { const member = tokens[++i]; type = fields.get(type)?.get(member) ?? (/^[iub]?vec[234]$/.test(type) ? `vec${member.length}` : undefined); }
      else if (tokens[i].startsWith('[')) type = type.endsWith('[]') ? type.slice(0, -2) : /^[iub]?vec[234]$/.test(type) ?
        type.startsWith('i') ? 'int' : type.startsWith('u') ? 'uint' : type.startsWith('b') ? 'bool' : 'float' : undefined;
    }
    return type;
  };
  const functions = new Map<string, FunctionShape[]>();
  for (const m of source.matchAll(/\b\w+\s+(\w+)\s*\(([^()]*)\)\s*(?:;|\{)/g)) {
    const output = new Set<number>();
    m[2].split(',').forEach((p, i) => { if (/\b(?:out|inout)\b/.test(p)) output.add(i); });
    const params = m[2].trim() ? m[2].split(',') : [];
    const types = params.map(p => p.trim().split(/\s+/).find(t => !['const', 'in', 'out', 'inout', 'highp', 'mediump', 'lowp'].includes(t)) ?? '');
    const list = functions.get(m[1]) ?? []; list.push({ types, output }); functions.set(m[1], list);
  }
  for (const [name, shapes] of functions) for (const call of source.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
    let depth = 1, start = call.index! + call[0].length;
    const args: { text: string; start: number }[] = [];
    for (let i = start; i < source.length && depth; i++) {
      const c = source[i]; if (c === '(' || c === '[') depth++; if (c === ')' || c === ']') depth--;
      if ((c === ',' && depth === 1) || depth === 0) { args.push({ text: source.slice(start, i), start }); start = i + 1; }
    }
    const shape = shapes.find(s => s.types.length === args.length && s.types.every((t, i) => {
      const actual = storageType(args[i].text, args[i].start); return !actual || actual === t;
    }));
    args.forEach(({ text, start }, argument) => {
      if (shape?.output.has(argument)) for (const m of text.matchAll(/(.+?)\.\s*(?:[xyzw]{2,4}|[rgba]{2,4}|[stpq]{2,4})\s*\[([^\]]*)\]/g))
        if (!/^\s*\d+[uU]?\s*$/.test(m[2]) && /^[iub]?vec[234]$/.test(storageType(m[1], start) ?? '')) throw new Error(indexedSwizzleDiagnostic);
    });
  }
}
