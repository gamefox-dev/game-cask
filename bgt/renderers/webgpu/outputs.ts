// Fragment interface reflection, not a scan of every @location in a module (which includes inputs).
// Native WGSL and translated GLSL share this path. Native compilation remains the syntax/type authority.
export function fragmentOutputs(source: string): ReadonlySet<number> {
  // WGSL permits nested block comments. Keep token separators so comments cannot create or
  // impersonate identifiers, entry points, constants or interface members.
  let clean = '', commentDepth = 0, lineComment = false;
  for (let i = 0; i < source.length; i++) {
    const pair = source.slice(i, i + 2);
    if (lineComment) { if (source[i] === '\n') { lineComment = false; clean += '\n'; } continue; }
    if (commentDepth) {
      if (pair === '/*') { commentDepth++; i++; }
      else if (pair === '*/') { commentDepth--; i++; }
      else if (source[i] === '\n') clean += '\n';
    } else if (pair === '//') { lineComment = true; clean += ' '; i++; }
    else if (pair === '/*') { commentDepth = 1; clean += ' '; i++; }
    else clean += source[i];
  }
  if (commentDepth) throw new Error('Fragment reflection: unterminated block comment');
  const entry = /\bfn\s+fs_main\s*\(/g.exec(clean);
  if (!entry) throw new Error('Fragment reflection: missing fs_main');
  let end = entry.index + entry[0].length, depth = 1;
  while (end < clean.length && depth) {
    if (clean[end] === '(') depth++;
    if (clean[end] === ')') depth--;
    end++;
  }
  const result = new Set<number>();
  // Identifiers are case-sensitive, and entry-point attributes see module scope only. A helper's
  // local literal with the same spelling must never impersonate the actual module constant.
  const constants = new Map<string, string>();
  let scope = 0;
  for (const m of clean.matchAll(/[{}]|\bconst\s+(\w+)\s*(?::\s*[iu]32\s*)?=\s*(0x[\da-fA-F]+|\d+)[iu]?\s*;/g)) {
    if (m[0] === '{') scope++;
    else if (m[0] === '}') scope--;
    else if (!scope) constants.set(m[1], m[2]);
  }
  const locations = (text: string) => {
    for (const m of text.matchAll(/@location\s*\(([^)]*)\)/g)) {
      let value = m[1].trim();
      if (/^\w+$/.test(value) && !/^\d/.test(value)) {
        value = constants.get(value) ?? value;
      }
      if (!/^(?:0x[\da-f]+|\d+)[iu]?$/i.test(value))
        throw new Error(`Fragment reflection: location requires a literal or literal integer constant (${m[1]})`);
      result.add(Number(value.replace(/[iu]$/i, '')));
    }
  };
  const ret = clean.slice(end, clean.indexOf('{', end)).trim();
  if (!ret) return result; // no color outputs (depth-only/discard/feedback)
  if (!ret.startsWith('->')) throw new Error('Fragment reflection: malformed return type');
  if (ret.includes('@')) { locations(ret); return result; } // scalar/vector or builtin depth
  let type = ret.slice(2).trim();
  const seen = new Set<string>();
  for (;;) {
    if (!/^\w+$/.test(type)) throw new Error('Fragment reflection: unsupported return type');
    if (seen.has(type)) throw new Error('Fragment reflection: cyclic return alias');
    seen.add(type);
    const alias = new RegExp(`\\balias\\s+${type}\\s*=\\s*(\\w+)\\s*;`).exec(clean);
    if (!alias) break;
    type = alias[1];
  }
  if (!/^\w+$/.test(type)) throw new Error('Fragment reflection: unsupported return type');
  const struct = new RegExp(`\\bstruct\\s+${type}\\s*\\{([^}]*)\\}`).exec(clean);
  if (!struct) throw new Error(`Fragment reflection: missing return structure ${type}`);
  locations(struct[1]);
  return result;
}
