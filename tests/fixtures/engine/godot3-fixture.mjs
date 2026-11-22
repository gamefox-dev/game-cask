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
// K59 variants (CC0): tone = a 440 Hz sine through AudioStreamGenerator (audio-output evidence); duplicateSignal = the
// script connects the same signal to the same method twice, which Godot reports as an engine ERROR line (allowlist tests).
// Observed on the official 3.5.3 web runtime (followed by an indented "   at: connect (core/object.cpp:…)" line).
export const DUPLICATE_SIGNAL_ERROR = "ERROR: Signal 'tree_entered' is already connected to given method '_noop' in that object.";
// physics (K59 Q7): a jumping box integrated in _physics_process (state depends on delta and on the frame of each
// ui_accept press); it prints "state <physics frame> <x> <y>" every physics frame and draws the box.
export const physicsScript = 'extends Node2D\nvar pos = Vector2(40, 140)\nvar vel = Vector2(60, 0)\n' +
  'func _physics_process(delta):\n    vel.y += 400.0 * delta\n    if Input.is_action_just_pressed("ui_accept") and pos.y >= 140.0:\n        vel.y = -220.0\n' +
  '    pos += vel * delta\n    if pos.y > 140.0:\n        pos.y = 140.0\n        vel.y = 0.0\n    if pos.x > 300.0:\n        pos.x = 20.0\n' +
  '    print("state ", Engine.get_physics_frames(), " ", pos.x, " ", pos.y)\n    update()\n' +
  'func _draw():\n    draw_rect(Rect2(0, 0, 320, 180), Color(0.1, 0.1, 0.2, 1))\n    draw_rect(Rect2(pos.x - 8, pos.y - 16, 16, 16), Color(1, 0.8, 0, 1))\n';
// clock (K59 Q8): a box whose x follows the main-thread clock (OS.get_ticks_usec reads performance.now); prints
// "clock <frames drawn> <ticks usec>" every frame. With --fixed-fps alone it still depends on wall time.
export const clockScript = 'extends Node2D\nvar x = 0.0\nfunc _process(_delta):\n    var us = OS.get_ticks_usec()\n' +
  '    x = fmod(us / 10000.0, 300.0)\n    print("clock ", Engine.get_frames_drawn(), " ", us)\n    update()\n' +
  'func _draw():\n    draw_rect(Rect2(0, 0, 320, 180), Color(0.1, 0.2, 0.1, 1))\n    draw_rect(Rect2(x, 80, 16, 16), Color(1, 1, 1, 1))\n';
export function variantScript({ tone = false, duplicateSignal = false, physics = false, clock = false } = {}) {
  if (physics || clock) { if (tone || duplicateSignal || (physics && clock)) throw new Error('physics/clock fixture variants are exclusive'); return physics ? physicsScript : clockScript; }
  if (!tone && !duplicateSignal) return script;
  const lines = script.split('\n'), ready = lines.indexOf('func _ready():'), process = lines.indexOf('func _process(_delta):');
  const head = ['var playback = null', 'var phase = 0.0'], readyBody = [], processBody = [], extra = [];
  if (duplicateSignal) { readyBody.push('    connect("tree_entered", self, "_noop")', '    connect("tree_entered", self, "_noop")'); extra.push('func _noop():', '    pass'); }
  if (tone) {
    readyBody.push('    var player = AudioStreamPlayer.new()', '    var generator = AudioStreamGenerator.new()', '    generator.mix_rate = 44100.0',
      '    generator.buffer_length = 0.25', '    player.stream = generator', '    add_child(player)', '    player.play()', '    playback = player.get_stream_playback()');
    processBody.push('    if playback != null:', '        for _i in range(playback.get_frames_available()):',
      '            playback.push_frame(Vector2.ONE * sin(phase * TAU) * 0.5)', '            phase = fmod(phase + 440.0 / 44100.0, 1.0)');
  }
  const out = [...lines.slice(0, 1), ...lines.slice(1, ready), ...head, lines[ready], ...readyBody, ...lines.slice(ready + 1, process + 1), ...processBody, ...lines.slice(process + 1)];
  return out.join('\n').replace(/\n$/, '') + '\n' + (extra.length ? extra.join('\n') + '\n' : '');
}
export function fixtureFiles(options = {}) { return { 'project.binary': projectBinary(), 'main.tscn': Buffer.from(scene), 'main.gd': Buffer.from(variantScript(options)) }; }
export function makePack({ files, version = [3, 5, 3], embeddedBase = 0, tone = false, duplicateSignal = false, physics = false, clock = false } = {}) {
  files ??= fixtureFiles({ tone, duplicateSignal, physics, clock });
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
/** mono: a Mono build's signature ("<version>.stable.mono.official"). */
export function makeRunner(extra = '', { version = '3.5.3', build = '6c814135b69d4e703956bacc2073b4b179ff5a00', mono = false } = {}) {
  const b = Buffer.alloc(512); b.write('MZ'); b.writeUInt32LE(128, 60); b.write('PE\0\0', 128);
  b.write('Godot Engine\0' + version + (mono ? '.stable.mono.official\0' : '.stable.official\0') + build + '\0' + extra, 160);
  return b;
}
/** options.version: [3, x, y]; options.build: release commit for the runner signature. */
export function embeddedFixture({ build, ...options } = {}) {
  const v = options.version ?? [3, 5, 3], name = v[2] ? v.join('.') : v.slice(0, 2).join('.');
  const runner = makeRunner('', { version: name, ...(build ? { build } : {}) }), pack = makePack({ ...options, embeddedBase: runner.length });
  return Buffer.concat([runner, pack, u64(pack.length), Buffer.from('GDPC')]);
}
