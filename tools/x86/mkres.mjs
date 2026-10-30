#!/usr/bin/env node
// Minimal deterministic Win32 resource compiler: JSON spec -> .res (linked by lld like rc.exe output).
// Used to build the kit's own Win32 fixtures/examples without a platform resource compiler.
//
//   node tools/x86/mkres.mjs spec.json out.res
//
// spec: { "bitmaps": {"101": "tiles.bmp"},
//         "menus": {"102": [{"popup": "&Game", "items": [{"text": "&New\tF2", "id": 201}, {"separator": true}]}]},
//         "accelerators": {"103": [{"key": 113, "id": 201, "virt": true, "shift": false, "ctrl": false, "alt": false}]},
//         "strings": {"1": "text", "17": "..."},                     STRINGTABLE (UTF-16, blocks of 16)
//         "dialogs": {"104": {"title": "Options", "x": 0, "y": 0, "w": 160, "h": 90, "style": 2160592960,
//                             "font": {"size": 8, "face": "MS Shell Dlg"},
//                             "controls": [{"class": "button", "text": "OK", "id": 1, "x": 10, "y": 70, "w": 50, "h": 14, "style": 1342242817}]}} }
//         (DLGTEMPLATE, dialog units; class names button/edit/static/listbox/scrollbar/combobox use their ordinals)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const RT_BITMAP = 2, RT_MENU = 4, RT_DIALOG = 5, RT_STRING = 6, RT_ACCELERATOR = 9;
const CLASS_ORD = { button: 0x80, edit: 0x81, static: 0x82, listbox: 0x83, scrollbar: 0x84, combobox: 0x85 };

function utf16z(s) {
  const b = Buffer.alloc((s.length + 1) * 2);
  for (let i = 0; i < s.length; i++) b.writeUInt16LE(s.charCodeAt(i), i * 2);
  return b;
}
const pad4 = (n) => (4 - (n % 4)) % 4;

function entry(type, id, data) {
  const hdr = Buffer.alloc(32);
  hdr.writeUInt32LE(data.length, 0);
  hdr.writeUInt32LE(32, 4);
  hdr.writeUInt16LE(0xffff, 8); hdr.writeUInt16LE(type, 10);
  hdr.writeUInt16LE(0xffff, 12); hdr.writeUInt16LE(id, 14);
  hdr.writeUInt32LE(0, 16);            // DataVersion
  hdr.writeUInt16LE(0x1030, 20);       // MOVEABLE | PURE | DISCARDABLE
  hdr.writeUInt16LE(0x0409, 22);       // en-US
  return Buffer.concat([hdr, data, Buffer.alloc(pad4(data.length))]);
}

function menu(items) {
  const parts = [Buffer.from([0, 0, 0, 0])]; // MENUHEADER: version 0, header size 0
  const emit = (list) => {
    list.forEach((it, i) => {
      const last = i === list.length - 1 ? 0x80 : 0;
      const w = Buffer.alloc(2);
      if (it.popup !== undefined) {
        w.writeUInt16LE(0x10 | last);
        parts.push(w, utf16z(it.popup));
        emit(it.items ?? []);
      } else {
        w.writeUInt16LE(last);
        const id = Buffer.alloc(2);
        id.writeUInt16LE(it.separator ? 0 : it.id);
        parts.push(w, id, utf16z(it.separator ? '' : it.text));
      }
    });
  };
  emit(items);
  return Buffer.concat(parts);
}

function accelerators(list) {
  const b = Buffer.alloc(8 * list.length);
  list.forEach((a, i) => {
    const f = (a.virt ? 1 : 0) | (a.shift ? 4 : 0) | (a.ctrl ? 8 : 0) | (a.alt ? 0x10 : 0) | (i === list.length - 1 ? 0x80 : 0);
    b.writeUInt16LE(f, 8 * i); b.writeUInt16LE(a.key, 8 * i + 2); b.writeUInt16LE(a.id, 8 * i + 4);
  });
  return b;
}

function u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); return b; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }

function stringBlocks(strings) {
  const blocks = new Map();
  for (const [id, text] of Object.entries(strings)) {
    const n = Number(id), blk = (n >> 4) + 1;
    if (!blocks.has(blk)) blocks.set(blk, new Array(16).fill(''));
    blocks.get(blk)[n & 15] = text;
  }
  return [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([blk, list]) => {
    const parts = [];
    for (const t of list) {
      parts.push(u16(t.length));
      const w = Buffer.alloc(t.length * 2);
      for (let i = 0; i < t.length; i++) w.writeUInt16LE(t.charCodeAt(i), i * 2);
      parts.push(w);
    }
    return [blk, Buffer.concat(parts)];
  });
}

function dialog(d) {
  const parts = [];
  let len = 0;
  const push = (b) => { parts.push(b); len += b.length; };
  const align4 = () => { if (len % 4) push(Buffer.alloc(4 - (len % 4))); };
  const DS_SETFONT = 0x40;
  const style = (d.style ?? 0x80c80080) | (d.font ? DS_SETFONT : 0);
  const controls = d.controls ?? [];
  push(u32(style)); push(u32(d.exstyle ?? 0)); push(u16(controls.length));
  for (const v of [d.x ?? 0, d.y ?? 0, d.w, d.h]) push(u16(v));
  push(u16(0)); push(u16(0)); push(utf16z(d.title ?? '')); /* no menu, default class, title */
  if (d.font) { push(u16(d.font.size)); push(utf16z(d.font.face)); }
  for (const c of controls) {
    align4();
    push(u32(c.style)); push(u32(c.exstyle ?? 0));
    for (const v of [c.x, c.y, c.w, c.h]) push(u16(v));
    push(u16(c.id));
    const ord = CLASS_ORD[String(c.class).toLowerCase()];
    if (ord) { push(u16(0xffff)); push(u16(ord)); } else push(utf16z(c.class));
    push(utf16z(c.text ?? ''));
    push(u16(0)); /* no creation data */
  }
  return Buffer.concat(parts);
}

export function buildRes(spec, baseDir) {
  const out = [Buffer.concat([Buffer.alloc(4), Buffer.from([0x20, 0, 0, 0, 0xff, 0xff, 0, 0, 0xff, 0xff, 0, 0]), Buffer.alloc(16)])];
  for (const [id, file] of Object.entries(spec.bitmaps ?? {})) {
    const bmp = readFileSync(join(baseDir, file));
    if (bmp.toString('latin1', 0, 2) !== 'BM') throw new Error(`${file}: not a BMP`);
    out.push(entry(RT_BITMAP, Number(id), bmp.subarray(14))); // packed DIB: drop BITMAPFILEHEADER
  }
  for (const [id, items] of Object.entries(spec.menus ?? {})) out.push(entry(RT_MENU, Number(id), menu(items)));
  for (const [id, list] of Object.entries(spec.accelerators ?? {})) out.push(entry(RT_ACCELERATOR, Number(id), accelerators(list)));
  for (const [id, d] of Object.entries(spec.dialogs ?? {})) out.push(entry(RT_DIALOG, Number(id), dialog(d)));
  for (const [blk, data] of stringBlocks(spec.strings ?? {})) out.push(entry(RT_STRING, blk, data));
  return Buffer.concat(out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [spec, out] = process.argv.slice(2);
  if (!spec || !out) { console.error('usage: mkres.mjs spec.json out.res'); process.exit(1); }
  writeFileSync(out, buildRes(JSON.parse(readFileSync(spec, 'utf8')), dirname(spec)));
}
