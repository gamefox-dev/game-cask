// Static PE resource reader (read-only, no execution): decodes the text of STRINGTABLE, MENU (incl. MENUEX) and
// DIALOG (incl. DIALOGEX) resources. Used by `npm run inspect -- --strings` (stdout only, never written to reports).
//
//   peResources(buf) -> { strings: [{ id, lang, text }], menus: [{ id, items }], dialogs: [{ id, title, font, controls }] }
//   or null when the buffer is not a PE image with a resource directory.

const RT_MENU = 4, RT_DIALOG = 5, RT_STRING = 6;
const CLASS_NAMES = { 0x80: 'button', 0x81: 'edit', 0x82: 'static', 0x83: 'listbox', 0x84: 'scrollbar', 0x85: 'combobox' };

function sections(b) {
  if (b.length < 0x40 || b.toString('latin1', 0, 2) !== 'MZ') return null;
  const nt = b.readUInt32LE(0x3c);
  if (nt + 24 > b.length || b.toString('latin1', nt, nt + 4) !== 'PE\0\0') return null;
  const opt = nt + 24, magic = b.readUInt16LE(opt), nsec = b.readUInt16LE(nt + 6), optsz = b.readUInt16LE(nt + 20);
  const ddOff = opt + (magic === 0x20b ? 112 : 96);
  const secs = [];
  for (let i = 0; i < nsec; i++) {
    const o = opt + optsz + 40 * i;
    if (o + 40 > b.length) break;
    secs.push({ va: b.readUInt32LE(o + 12), vsize: b.readUInt32LE(o + 8), raw: b.readUInt32LE(o + 20), rawsize: b.readUInt32LE(o + 16) });
  }
  return { secs, rsrcRva: ddOff + 24 <= b.length ? b.readUInt32LE(ddOff + 16) : 0 };
}

export function peResources(b) {
  const pe = sections(b);
  if (!pe || !pe.rsrcRva) return null;
  const off = (rva) => {
    for (const s of pe.secs) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawsize)) return s.raw + (rva - s.va);
    return -1;
  };
  const root = off(pe.rsrcRva);
  if (root < 0) return null;
  const u16 = (o) => (o >= 0 && o + 2 <= b.length ? b.readUInt16LE(o) : 0);
  const u32 = (o) => (o >= 0 && o + 4 <= b.length ? b.readUInt32LE(o) : 0);
  const dir = (o) => {
    const n = u16(o + 12) + u16(o + 14), out = [];
    for (let i = 0; i < n && i < 4096; i++) {
      const name = u32(o + 16 + 8 * i), target = u32(o + 20 + 8 * i);
      let id = name & 0x7fffffff, label = null;
      if (name & 0x80000000) {
        const so = root + (name & 0x7fffffff), len = u16(so);
        label = wstr(so + 2, len);
        id = null;
      }
      out.push({ id, label, sub: (target & 0x80000000) !== 0, at: root + (target & 0x7fffffff) });
    }
    return out;
  };
  const wstr = (o, n) => {
    let s = '';
    for (let i = 0; i < n && o + 2 * i + 2 <= b.length; i++) s += String.fromCharCode(b.readUInt16LE(o + 2 * i));
    return s;
  };
  const wsz = (o) => { // NUL-terminated UTF-16 at o -> [text, next offset]
    let s = '', p = o;
    while (p + 2 <= b.length && b.readUInt16LE(p) !== 0 && s.length < 4096) { s += String.fromCharCode(b.readUInt16LE(p)); p += 2; }
    return [s, p + 2];
  };
  const szOrOrd = (o) => { // sz_Or_Ord: 0x0000 none, 0xFFFF ordinal, else string
    const c = u16(o);
    if (c === 0) return [null, o + 2];
    if (c === 0xffff) return [u16(o + 2), o + 4];
    return wsz(o);
  };
  const leaves = (type) => {
    const t = dir(root).find((e) => e.id === type && e.sub);
    if (!t) return [];
    const out = [];
    for (const name of dir(t.at)) {
      if (!name.sub) continue;
      for (const lang of dir(name.at)) {
        if (lang.sub) continue;
        const rva = u32(lang.at), size = u32(lang.at + 4), o = off(rva);
        if (o >= 0 && o + size <= b.length) out.push({ id: name.id ?? name.label, lang: lang.id, o, size });
      }
    }
    return out;
  };

  const strings = [];
  for (const r of leaves(RT_STRING)) {
    let p = r.o;
    for (let i = 0; i < 16 && p + 2 <= r.o + r.size; i++) {
      const n = u16(p);
      p += 2;
      if (n) strings.push({ id: ((Number(r.id) - 1) << 4) + i, lang: r.lang, text: wstr(p, n) });
      p += 2 * n;
    }
  }

  const menus = [];
  for (const r of leaves(RT_MENU)) {
    const end = r.o + r.size;
    const version = u16(r.o);
    if (version === 1) { // MENUEX
      let p = r.o + 4 + u16(r.o + 2);
      const parse = () => {
        const items = [];
        while (p + 14 <= end) {
          const type = u32(p), id = u32(p + 8), flags = u16(p + 12);
          const [text, q] = wsz(p + 14);
          p = (q + 3) & ~3;
          const it = { text, id, separator: (type & 0x800) !== 0 };
          if (flags & 1) { p += 4; it.items = parse(); }
          items.push(it);
          if (flags & 0x80) break;
        }
        return items;
      };
      menus.push({ id: r.id, ex: true, items: parse() });
    } else {
      let p = r.o + 4 + u16(r.o + 2);
      const parse = () => {
        const items = [];
        while (p + 2 <= end) {
          const flags = u16(p);
          p += 2;
          let it;
          if (flags & 0x10) {
            const [text, q] = wsz(p);
            p = q;
            it = { text, items: parse() };
          } else {
            const id = u16(p);
            const [text, q] = wsz(p + 2);
            p = q;
            it = { text, id, separator: (flags & 0x800) !== 0 || (id === 0 && text === '') };
          }
          items.push(it);
          if (flags & 0x80) break;
        }
        return items;
      };
      menus.push({ id: r.id, items: parse() });
    }
  }

  const dialogs = [];
  for (const r of leaves(RT_DIALOG)) {
    const t = r.o, ex = u16(t) === 1 && u16(t + 2) === 0xffff;
    let p, style, cdit;
    if (ex) { style = u32(t + 12); cdit = u16(t + 16); p = t + 26; } else { style = u32(t); cdit = u16(t + 8); p = t + 18; }
    let menu, cls, title;
    [menu, p] = szOrOrd(p);
    [cls, p] = szOrOrd(p);
    [title, p] = wsz(p);
    let font = null;
    if (style & 0x40) {
      const size = u16(p);
      p += ex ? 6 : 2;
      let face;
      [face, p] = wsz(p);
      font = { size, face };
    }
    const controls = [];
    for (let i = 0; i < cdit && p < r.o + r.size; i++) {
      p = t + ((p - t + 3) & ~3);
      let cstyle, id;
      if (ex) { cstyle = u32(p + 8); id = u32(p + 20); p += 24; } else { cstyle = u32(p); id = u16(p + 16); p += 18; }
      let c, text;
      [c, p] = szOrOrd(p);
      [text, p] = szOrOrd(p);
      p += 2 + u16(p);
      controls.push({ id, class: typeof c === 'number' ? (CLASS_NAMES[c] ?? `#${c}`) : c, text: typeof text === 'number' ? `#${text}` : (text ?? ''), style: cstyle });
    }
    dialogs.push({ id: r.id, title, style, font, menu, class: cls, controls });
  }
  return { strings, menus, dialogs };
}

/** Flatten a menu tree into printable lines. */
export function menuLines(items, depth = 0) {
  const out = [];
  for (const it of items) {
    out.push(`${'  '.repeat(depth)}${it.separator ? '----' : JSON.stringify(it.text)}${it.id !== undefined && !it.separator ? ` (id ${it.id})` : ''}`);
    if (it.items) out.push(...menuLines(it.items, depth + 1));
  }
  return out;
}
