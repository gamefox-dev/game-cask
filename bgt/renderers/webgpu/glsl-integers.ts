// GLSL 3.30 / ES 3.00 integers: exactly 32 bits, not JavaScript number/bitwise coercions.
export interface IntegerValue { value: bigint; unsigned: boolean }
export function integerCode(value: bigint, unsigned: boolean): string {
  if (unsigned) return `${BigInt.asUintN(32, value)}u`;
  const signed = BigInt.asIntN(32, value);
  return signed === -2147483648n ? '(-2147483647i - 1i)' : `${signed}i`;
}
export function integerLiteral(token: string): (IntegerValue & { code: string }) | undefined {
  if (!/^(?:0[xX][\da-fA-F]+|0[0-7]*|[1-9]\d*)[uU]?$/.test(token)) return undefined;
  const unsigned = /[uU]$/.test(token), digits = token.replace(/[uU]$/, '');
  const value = BigInt(/^0[0-7]+$/.test(digits) ? '0o' + digits.slice(1) : digits);
  if (value > 0xffffffffn) throw new Error('GLSL: integer literal exceeds 32 bits');
  const signed = unsigned ? value : BigInt.asIntN(32, value);
  return { value: signed, unsigned, code: integerCode(signed, unsigned) };
}

// Scalar integer constant expressions, also used for array extents. Inactive operands are parsed but
// not evaluated (including divide-by-zero); uint wins arithmetic promotion, shifts retain the left type.
export function integerConstant(tokens: string[], names: ReadonlyMap<string, number | IntegerValue>): number | undefined {
  let i = 0;
  const precedence: Record<string, number> = { '||': 1, '^^': 2, '&&': 3, '|': 4, '^': 5, '&': 6,
    '==': 7, '!=': 7, '<': 8, '<=': 8, '>': 8, '>=': 8, '<<': 9, '>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11 };
  const wrap = (value: bigint, unsigned = false): IntegerValue => ({ value: unsigned ? BigInt.asUintN(32, value) : BigInt.asIntN(32, value), unsigned });
  const bool = (value: boolean) => wrap(value ? 1n : 0n);
  const expr = (min = 0, active = true): IntegerValue | undefined => {
    const token = tokens[i++]; let a: IntegerValue | undefined;
    if (token === '(') { a = expr(0, active); if (tokens[i++] !== ')') return undefined; }
    else if (['+', '-', '~', '!'].includes(token)) {
      a = expr(12, active);
      if (a) a = token === '!' ? bool(a.value === 0n) : wrap(token === '-' ? -a.value : token === '~' ? ~a.value : a.value, a.unsigned);
    } else if (['int', 'uint', 'i32', 'u32', 'bool'].includes(token) && tokens[i] === '(') {
      i++; a = expr(0, active); if (!a || tokens[i++] !== ')') return undefined;
      a = token === 'bool' ? bool(a.value !== 0n) : wrap(a.value, token === 'uint' || token === 'u32');
    } else {
      const named = names.get(token);
      a = token === 'true' ? bool(true) : token === 'false' ? bool(false) : integerLiteral(token ?? '') ??
        (typeof named === 'number' ? wrap(BigInt(named)) : named);
    }
    while (a && precedence[tokens[i]] >= min && precedence[tokens[i]]) {
      const op = tokens[i++], selected = active && !(op === '&&' && a.value === 0n) && !(op === '||' && a.value !== 0n);
      const b = expr(precedence[op] + 1, selected); if (!b) return undefined;
      if (!selected && op !== '||' && op !== '&&') { a = wrap(0n); continue; }
      const unsigned = a.unsigned || b.unsigned, l = wrap(a.value, unsigned).value, r = wrap(b.value, unsigned).value;
      if ((op === '/' || op === '%') && r === 0n && active) return undefined;
      if ((op === '<<' || op === '>>') && (b.value < 0n || b.value > 31n) && active) return undefined;
      if (['<', '>', '<=', '>=', '==', '!=', '&&', '||', '^^'].includes(op)) {
        a = bool(op === '<' ? l < r : op === '>' ? l > r : op === '<=' ? l <= r : op === '>=' ? l >= r :
          op === '==' ? l === r : op === '!=' ? l !== r : op === '&&' ? l !== 0n && r !== 0n :
            op === '||' ? l !== 0n || r !== 0n : (l !== 0n) !== (r !== 0n));
      } else {
        const v = op === '+' ? l + r : op === '-' ? l - r : op === '*' ? l * r : op === '/' ? l / r :
          op === '%' ? l % r : op === '&' ? l & r : op === '|' ? l | r : op === '^' ? l ^ r :
            op === '<<' ? a.value << b.value : a.value >> b.value;
        a = wrap(v, op === '<<' || op === '>>' ? a.unsigned : unsigned);
      }
    }
    if (min === 0 && a && tokens[i] === '?') {
      i++; const yes = expr(0, active && a.value !== 0n); if (tokens[i++] !== ':') return undefined;
      const no = expr(0, active && a.value === 0n); if (!yes || !no) return undefined;
      a = wrap(a.value !== 0n ? yes.value : no.value, yes.unsigned || no.unsigned);
    }
    return a;
  };
  const value = expr(); return value && i === tokens.length ? Number(value.value) : undefined;
}
