// SPDX-License-Identifier: CC0-1.0
// Original synthetic pack/runner writer. No Godot executable/editor needed.
import { createHash } from 'node:crypto';
const u32 = x => { const b = Buffer.alloc(4); b.writeUInt32LE(x); return b; };
const u64 = x => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(x)); return b; };
const align = n => (n + 3) & ~3;
function variant(value) {
  if (typeof value === 'number') return Buffer.concat([u32(2), u32(value)]);
  const raw = Buffer.from(value), padded = Buffer.alloc(align(raw.length)); raw.copy(padded);
  return Buffer.concat([u32(4), u32(raw.length), padded]);
}
export function projectBinary() {
  const settings = {
    'application/config/name': 'Game Cask CC0 engine fixture',
    'application/run/main_scene': 'res://main.tscn',
    'display/window/size/width': 320,
    'display/window/size/height': 180,
    'rendering/quality/driver/driver_name': 'GLES3',
  };
  return Buffer.concat([Buffer.from('ECFG'), u32(Object.keys(settings).length), ...Object.entries(settings).flatMap(([k, v]) => {
    const key = Buffer.from(k), value = variant(v);
    return [u32(key.length), key, u32(value.length), value];
  })]);
}
export const scene = '[gd_scene load_steps=2 format=2]\n\n[ext_resource path="res://main.gd" type="Script" id=1]\n\n[node name="Main" type="Node2D"]\nscript = ExtResource( 1 )\n';
export const script = 'extends Node2D\nvar changed = false\nfunc _ready():\n    update()\nfunc _process(_delta):\n    if Input.is_action_just_pressed("ui_accept"):\n        changed = not changed\n        update()\nfunc _draw():\n    var color = Color(1, 0, 0, 1)\n    if changed:\n        color = Color(0, 1, 1, 1)\n    draw_rect(Rect2(0, 0, 320, 180), color)\n';
export function fixtureFiles() { return { 'project.binary': projectBinary(), 'main.tscn': Buffer.from(scene), 'main.gd': Buffer.from(script) }; }
export function makePack({ files = fixtureFiles(), version = [3, 5, 3], embeddedBase = 0 } = {}) {
  const header = Buffer.alloc(88); header.write('GDPC'); header.writeUInt32LE(1, 4);
  version.forEach((x, i) => header.writeUInt32LE(x, 8 + i * 4));
  header.writeUInt32LE(Object.keys(files).length, 84);
  const dirSize = Object.keys(files).reduce((n, name) => n + 4 + align(Buffer.byteLength('res://' + name)) + 32, 0);
  let offset = header.length + dirSize;
  const directory = [], contents = [];
  for (const [name, value] of Object.entries(files)) {
    const raw = Buffer.from('res://' + name), padded = Buffer.alloc(align(raw.length)); raw.copy(padded);
    const data = Buffer.from(value);
    directory.push(u32(padded.length), padded, u64(offset + embeddedBase), u64(data.length), createHash('md5').update(data).digest());
    contents.push(data); offset += data.length;
  }
  return Buffer.concat([header, ...directory, ...contents]);
}
export function makeRunner(extra = '') {
  const b = Buffer.alloc(512); b.write('MZ'); b.writeUInt32LE(128, 60); b.write('PE\0\0', 128);
  b.write('Godot Engine\0' + '3.5.3.stable.official\0' + '6c814135b69d4e703956bacc2073b4b179ff5a00\0' + extra, 160);
  return b;
}
export function embeddedFixture(options = {}) {
  const runner = makeRunner(), pack = makePack({ ...options, embeddedBase: runner.length });
  return Buffer.concat([runner, pack, u64(pack.length), Buffer.from('GDPC')]);
}
