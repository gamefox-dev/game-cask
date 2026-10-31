// Differential oracle: the same game built twice — lifted, and interpret-only — driven by the same
// deterministic input; the per-frame API-call trace hash (bgt_state_hash of pipeline games) must
// match frame by frame. The first divergent frame localises a lifting bug.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHeadless, ROOT, Headless } from '../support/headless';
/* LANE-GL: opt-in fixture recorder; no rendering is claimed by this oracle. */
import { glStream } from '../support/x64-gl-stream';
const streamOptions = (id: string) => ['x64-gl', 'x64-smoke'].includes(id.replace(/-interp$/, '')) ? glStream() : undefined;

export interface OracleStep { frame: number; pointer?: [number, number, number]; key?: [string, boolean] }
export interface OracleReport {
  game: string;
  frames: number;
  identical: boolean;
  firstDivergence: number | null;
  hashes: { lifted: string; interpreted: string };
  metrics: { lifted: unknown; interpreted: unknown };
  errors: { lifted: string | null; interpreted: string | null };
}

/** deterministic pseudo-random clicks and keys inside the logical surface */
export function defaultScript(frames: number, w: number, h: number, seed = 7): OracleStep[] {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 8) / 16777216;
  const out: OracleStep[] = [];
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'F2'];
  for (let f = 5; f < frames; f += 6) {
    const x = Math.floor(rnd() * w), y = Math.floor(rnd() * h);
    out.push({ frame: f, pointer: [x, y, 1] }, { frame: f + 2, pointer: [x, y, 0] });
    if (rnd() < 0.3) { const k = keys[Math.floor(rnd() * keys.length)]; out.push({ frame: f + 3, key: [k, true] }, { frame: f + 4, key: [k, false] }); }
  }
  return out;
}

async function run(id: string, frames: number, script: OracleStep[]): Promise<{ hashes: string[]; metrics: unknown; error: string | null }> {
  const stream = streamOptions(id);
  /* LANE-K1: deterministic entropy tape is TEST REPLAY ONLY, never used by real play. */
  let cursor = 0;
  const entropy = (bytes: Uint8Array) => { for (let i=0;i<bytes.length;i++) bytes[i] = ((cursor++ * 73 + 41) ^ (cursor >>> 8)) & 255; };
  const h: Headless = await loadHeadless(id, { storage: new Map(), ...stream, entropy });
  const hashes: string[] = [];
  let error: string | null = null;
  const byFrame = new Map<number, OracleStep[]>();
  for (const st of script) byFrame.set(st.frame, [...(byFrame.get(st.frame) ?? []), st]);
  try {
    // The smoke's measured 600-frame loop follows deterministic shader/file startup.
    // Recorder-only pre-roll is identical in both builds and remains part of the trace hash.
    const startup: string[] = [];
    if (id.replace(/-interp$/, '') === 'x64-smoke') for (let f=0;f<20;f++) {
      await h.stepAsync(1);
      if (h.host.commandErrorCount) throw new Error(JSON.stringify(h.host.commandErrors));
      startup.push((h.host.stateHash() ?? '') + ':' + stream!.frameHash());
    }
    for (let f = 0; f < frames; f++) {
      for (const st of byFrame.get(f) ?? []) {
        if (st.pointer) h.pointer(...st.pointer);
        if (st.key) h.key(...st.key);
      }
      await h.stepAsync(1); // settle external range I/O before advancing deterministic guest time
      /* LANE-GL: compare semantic GPU bytes too, not just the first four integer API arguments. */
      if (stream && h.host.commandErrorCount) throw new Error(JSON.stringify(h.host.commandErrors));
      hashes.push((f === 0 && startup.length ? startup.join('|') + '|' : '') +
        (h.host.stateHash() ?? '') + (stream ? ':' + stream.frameHash() : ''));
    }
  } catch (e) {
    error = (e as Error).message;
  }
  return { hashes, metrics: h.host.metrics(), error };
}

export async function oracle(id: string, frames = 300, script?: OracleStep[]): Promise<OracleReport> {
  const probe = await loadHeadless(id, streamOptions(id));
  await probe.stepAsync(1);
  const sc = script ?? defaultScript(frames, probe.host.logicalWidth, probe.host.logicalHeight);
  const a = await run(id, frames, sc);
  const b = await run(`${id}-interp`, frames, sc);
  let first: number | null = null;
  for (let i = 0; i < Math.max(a.hashes.length, b.hashes.length); i++) if (a.hashes[i] !== b.hashes[i]) { first = i; break; }
  const report: OracleReport = {
    game: id,
    frames,
    identical: first === null && !a.error && !b.error,
    firstDivergence: first,
    hashes: { lifted: a.hashes[a.hashes.length - 1] ?? '', interpreted: b.hashes[b.hashes.length - 1] ?? '' },
    metrics: { lifted: a.metrics, interpreted: b.metrics },
    errors: { lifted: a.error, interpreted: b.error },
  };
  mkdirSync(join(ROOT, 'reports'), { recursive: true });
  writeFileSync(join(ROOT, 'reports', `oracle-${id}.json`), JSON.stringify(report, null, 2) + '\n');
  return report;
}
