// Contain a native ANGLE failure before submitting GLSL. This is rejection, not emulation:
// dynamically indexing a multi-component vector swizzle passed to out/inout is outside the W2 subset.
export const indexedSwizzleDiagnostic = 'WebGL 2 native boundary: out/inout argument indexes a multi-component swizzle';
export function validateNativeLvalues(source: string): void {
  const fields = new Map<string, Map<string, string>>();
  for (const s of source.matchAll(/\bstruct\s+(\w+)\s*\{([^{}]*)\}/g)) {
    const members = new Map<string, string>();
    for (const m of s[2].matchAll(/\b(\w+)\s+(\w+)\s*(\[[^;]*?\])?\s*;/g)) members.set(m[2], m[1] + (m[3] ? '[]' : ''));
    fields.set(s[1], members);
  }
  // Resolve names at the call site, rather than guessing from a member's spelling: `s.rgba[i]`
  // can be a scalar-array struct member, and is not a vector swizzle.
  const scopes: { start: number; end: number; parent?: number }[] = [{ start: 0, end: source.length }], stack = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '{') { scopes.push({ start: i, end: source.length, parent: stack.at(-1) }); stack.push(scopes.length - 1); }
    else if (source[i] === '}') { const scope = stack.pop(); if (scope) scopes[scope].end = i; }
  }
  const declarations: { name: string; type: string; start: number; end: number }[] = [];
  const typePattern = '(?:[iub]?vec[234]|float|int|uint|bool|mat[234](?:x[234])?' + [...fields.keys()].map(n => '|' + n).join('') + ')';
  const vars = new RegExp(`\\b(${typePattern})\\s+(\\w+)\\s*(\\[[^;{}]*?\\])?`, 'g');
  for (const m of source.matchAll(vars)) {
    const pos = m.index!, after = pos + m[0].length;
    if (/^\s*\(/.test(source.slice(after))) continue; // function, not storage
    let scope = scopes.filter(s => s.start <= pos && pos <= s.end).at(-1)!;
    // Function parameters belong to their function body, not the enclosing global scope.
    const prefix = source.slice(0, pos), open = prefix.lastIndexOf('('), close = prefix.lastIndexOf(')');
    if (open > close) {
      const body = source.indexOf('{', after), semi = source.indexOf(';', after);
      if (body >= 0 && (semi < 0 || body < semi)) scope = scopes.find(s => s.start === body) ?? scope;
    }
    declarations.push({ name: m[2], type: m[1] + (m[3] ? '[]' : ''), start: pos, end: scope.end });
    // Include comma-separated storage declarations, skipping commas nested in constructor/array expressions.
    let depth = 0;
    for (let i = after; i < source.length; i++) {
      const c = source[i];
      if ((c === ';' || c === ')' || c === '{' || c === '}') && depth === 0) break;
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if (c === ',' && depth === 0) {
        const next = /^\s*(\w+)\s*(\[[^\]]*\])?/.exec(source.slice(i + 1));
        if (next) declarations.push({ name: next[1], type: m[1] + (next[2] ? '[]' : ''), start: i, end: scope.end });
      }
    }
  }
  const isVectorBase = (text: string, pos: number): boolean => {
    const tokens = text.match(/[A-Za-z_]\w*|\[[^\]]*\]|\./g); if (!tokens?.length) return false;
    let type = declarations.filter(d => d.name === tokens[0] && d.start < pos && d.end >= pos).at(-1)?.type;
    for (let i = 1; type && i < tokens.length; i++) {
      if (tokens[i] === '.') {
        const member = tokens[++i];
        type = fields.get(type)?.get(member) ?? (/^[iub]?vec[234]$/.test(type) ? `vec${member.length}` : undefined);
      } else if (tokens[i].startsWith('[')) type = type.endsWith('[]') ? type.slice(0, -2) : /^[iub]?vec[234]$/.test(type) ? 'float' : undefined;
    }
    return !!type && /^[iub]?vec[234]$/.test(type);
  };
  const outputs = new Map<string, Set<number>>();
  for (const m of source.matchAll(/\b\w+\s+(\w+)\s*\(([^()]*)\)\s*[;{]/g)) {
    const indices = outputs.get(m[1]) ?? new Set<number>();
    m[2].split(',').forEach((p, i) => { if (/\b(?:out|inout)\b/.test(p)) indices.add(i); });
    if (indices.size) outputs.set(m[1], indices);
  }
  for (const [name, indices] of outputs) for (const call of source.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
    let depth = 1, argument = 0, start = call.index! + call[0].length;
    for (let i = start; i < source.length && depth; i++) {
      const c = source[i];
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if ((c === ',' && depth === 1) || depth === 0) {
        const text = source.slice(start, i);
        if (indices.has(argument)) for (const m of text.matchAll(/((?:[A-Za-z_]\w*\s*(?:\[[^\]]*\]\s*)?\s*\.\s*)*[A-Za-z_]\w*\s*(?:\[[^\]]*\]\s*)?)\.\s*(?:[xyzw]{2,4}|[rgba]{2,4}|[stpq]{2,4})\s*\[([^\]]*)\]/g)) {
          if (!/^\s*\d+[uU]?\s*$/.test(m[2]) && isVectorBase(m[1], start)) throw new Error(indexedSwizzleDiagnostic);
        }
        start = i + 1; argument++;
      }
    }
  }
}
