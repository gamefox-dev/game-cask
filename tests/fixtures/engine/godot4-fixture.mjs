// SPDX-License-Identifier: CC0-1.0
// Original synthetic Godot 4 pack/runner writer (PCK format 2, as in the public engine source). No Godot
// executable/editor needed. The scene draws a full-viewport rectangle: red, cyan after ui_accept (Enter).
import { createHash } from 'node:crypto';
const u32 = x => { const b = Buffer.alloc(4); b.writeUInt32LE(x); return b; };
const u64 = x => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(x)); return b; };
const pad = (n, a) => (a - (n % a)) % a;
const str = s => { const raw = Buffer.from(s); return Buffer.concat([u32(raw.length), raw, Buffer.alloc(pad(raw.length, 4))]); };
function variant(value) {
  if (typeof value === 'number') return Buffer.concat([u32(2), u32(value)]);
  if (Array.isArray(value)) return Buffer.concat([u32(34), u32(value.length), ...value.map(str)]); // PACKED_STRING_ARRAY
  return Buffer.concat([u32(4), str(value)]);
}
export function projectBinary({ version = '4.3', settings = {} } = {}) {
  const all = {
    'application/config/name': 'Game Cask CC0 Godot 4 fixture',
    'application/run/main_scene': 'res://main.tscn',
    'application/config/features': [version.split('.').slice(0, 2).join('.'), 'GL Compatibility'],
    'display/window/size/viewport_width': 320,
    'display/window/size/viewport_height': 180,
    'rendering/renderer/rendering_method': 'gl_compatibility',
    ...settings,
  };
  return Buffer.concat([Buffer.from('ECFG'), u32(Object.keys(all).length), ...Object.entries(all).flatMap(([k, v]) => {
    const key = Buffer.from(k), value = variant(v);
    return [u32(key.length), key, u32(value.length), value];
  })]);
}
export const scene = '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://main.gd" id="1"]\n\n[node name="Main" type="Node2D"]\nscript = ExtResource("1")\n';
export const script = 'extends Node2D\n\nvar changed = false\n\nfunc _ready():\n\tqueue_redraw()\n\nfunc _process(_delta):\n\tif Input.is_action_just_pressed("ui_accept"):\n\t\tchanged = not changed\n\t\tqueue_redraw()\n\nfunc _draw():\n\tvar color = Color(1, 0, 0, 1)\n\tif changed:\n\t\tcolor = Color(0, 1, 1, 1)\n\tdraw_rect(Rect2(0, 0, 320, 180), color)\n';
// Exports always carry the (here empty) global script class cache; release templates report its absence.
export function fixtureFiles(version = '4.3') { return { 'project.binary': projectBinary({ version }), '.godot/global_script_class_cache.cfg': Buffer.from('list=[]\n'), 'main.tscn': Buffer.from(scene), 'main.gd': Buffer.from(script) }; }
/**
 * version: "4.x[.y]"; flags: PACK_DIR_ENCRYPTED=1, PACK_REL_FILEBASE=2; packStart: absolute offset when embedded
 * WITHOUT PACK_REL_FILEBASE (Godot 4.0-4.2 style absolute file base). Paths keep res:// before 4.4, as exporters did.
 */
export function makePack({ version = '4.3', files, flags = 0, packStart = 0, fileFlags = {} } = {}) {
  files ??= fixtureFiles(version);
  const [major, minor, patch = 0] = version.split('.').map(Number), prefix = major === 4 && minor >= 4 ? '' : 'res://';
  const header = Buffer.alloc(100); header.write('GDPC'); header.writeUInt32LE(2, 4);
  [major, minor, patch].forEach((x, i) => header.writeUInt32LE(x, 8 + i * 4));
  header.writeUInt32LE(flags, 20); header.writeUInt32LE(Object.keys(files).length, 96);
  const dirSize = Object.keys(files).reduce((n, name) => { const l = Buffer.byteLength(prefix + name); return n + 4 + l + pad(l, 4) + 36; }, 0);
  const headerPad = pad(100 + dirSize, 32), fileBase = 100 + dirSize + headerPad;
  header.writeBigUInt64LE(BigInt(fileBase + ((flags & 2) ? 0 : packStart)), 24);
  const directory = [], contents = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const data = Buffer.from(value), p = Buffer.from(prefix + name);
    directory.push(u32(p.length + pad(p.length, 4)), p, Buffer.alloc(pad(p.length, 4)), u64(offset), u64(data.length), createHash('md5').update(data).digest(), u32(fileFlags[name] ?? 0));
    const padded = Buffer.concat([data, Buffer.alloc(pad(data.length, 32))]);
    contents.push(padded); offset += padded.length;
  }
  return Buffer.concat([header, ...directory, Buffer.alloc(headerPad), ...contents]);
}
/** mono: a .NET build's signature ("<version>.stable.mono.official"). */
export function makeRunner({ version = '4.3', build = '77dcf97d82cbfe4e4615475fa52ca03da645dbd8', extra = '', mono = false } = {}) {
  const b = Buffer.alloc(512); b.write('MZ'); b.writeUInt32LE(128, 60); b.write('PE\0\0', 128);
  b.write('Godot Engine\0' + version + (mono ? '.stable.mono.official\0' : '.stable.official\0') + build + '\0' + extra, 160);
  return b;
}
/** Runner + 8-byte aligned pack + u64 size + "GDPC" (editor export layout). relative=false: 4.0-4.2 absolute base. */
export function embeddedFixture({ version = '4.3', build, relative = true, files } = {}) {
  const runner = makeRunner({ version, build }), start = runner.length;
  const pack = makePack({ version, files, flags: relative ? 2 : 0, packStart: start });
  const tail = Buffer.alloc(pad(pack.length + 12, 8));
  const body = Buffer.concat([pack, tail]);
  return Buffer.concat([runner, body, u64(body.length), Buffer.from('GDPC')]);
}
