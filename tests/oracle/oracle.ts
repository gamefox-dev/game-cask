// Differential oracle: the same game built twice — lifted, and interpret-only — driven by the same
// deterministic input; the per-frame API-call trace hash (bgt_state_hash of pipeline games) must
// match frame by frame. The first divergent frame localises a lifting bug.
// vK72: by default each frame also compares a guest-state hash (CPU of every guest thread incl. flags, and every
// mapped guest page): a wrong lifted result that changes registers or RAM but no API argument diverges here.
// BGT_ORACLE_STATE=off or a list of cpu, flags, current, memory (or the `state` option). Default: every thread's CPU
// with flags, and memory; for liftMode "fast" builds the running thread's CPU without flags, and memory: fast mode
// keeps EFLAGS dead across calls (Win64 ABI; K75: exact only where the profile stores them, lift64_eflags.h, so not at an
// arbitrary frame boundary inside an API) and parks other threads only at loop headers/function entries, so parked
// threads' RIP/clock legitimately differ from the interpreter's; frames that end at the instruction cap, and every
// frame after a second guest thread was live, compare memory (and the live-thread count) only: fast mode stops at a
// loop header, the interpreter at the exact instruction, and thread interleaving follows (K75 measured stricter
// multi-thread forms: every thread, or the running plus API-blocked threads; both diverge in CPU only).
// @ts-expect-error shared ESM reporting tool
import { oracleFailure, writeOracleReport } from '../../tools/report/oracle-report.mjs';
import { loadHeadless, ROOT, Headless } from '../support/headless';
/* LANE-GL: opt-in fixture recorder; no rendering is claimed by this oracle. */
import { glStream } from '../support/x64-gl-stream';
import { assertGlErrors, assertScaleRecording } from '../support/gl-scale-contract';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const suspension = process.env.BGT_ORACLE_SUSPENSION === 'jspi' ? 'jspi' : 'asyncify';
/** Guest-state parts (x86_sched.h X86_STATE_*) from a spec like "cpu,flags,memory" or "off". */
export function oracleStateParts(spec = process.env.BGT_ORACLE_STATE ?? 'cpu,flags,memory'): number {
  if (spec === 'default') spec = 'cpu,flags,memory';
  if (spec === 'off' || spec === '') return 0;
  let parts = 0;
  for (const p of spec.split(',')) {
    if (p === 'cpu') parts |= 1; else if (p === 'flags') parts |= 2; else if (p === 'memory') parts |= 4; else if (p === 'current') parts |= 8;
    else throw new Error('BGT_ORACLE_STATE must be off or a list of cpu, flags, current, memory');
  }
  if ((parts & 10) && !(parts & 1)) throw new Error('BGT_ORACLE_STATE flags/current need cpu');
  return parts;
}
/** The kit fixture an oracle game id stands for: its interpret-only twin (`-interp`) and K75 fast-mode copies (`-fast`)
 * keep the fixture's stream options and contracts. */
export const oracleBaseId = (id: string) => id.replace(/-interp$/, '').replace(/-fast$/, '');
const streamOptions = (id: string) => ['x64-time', 'x64-gl-orphan', 'x64-gl-respec', 'x64-gl-frame', 'x64-gl-pacing', 'x64-gl-prims', 'x64-gl-raster', 'x64-gl-zero', 'x64-file-load', 'x64-gl-programs', 'x64-gl', 'x64-gl-scale', 'x64-gl-capacity', 'x64-gl-default-vao', 'x64-gl-fbo', 'x64-gl-current', 'x64-gl-integer', 'x64-gl-blit', 'x64-gl-feedback', 'x64-gl-ranges', 'x64-glsl', 'x64-smoke'].includes(oracleBaseId(id)) ? glStream() : undefined;

export interface OracleStep { frame: number; pointer?: [number, number, number]; key?: [string, boolean] }
export interface OracleReport {
  game: string;
  /** vK72: guest-state parts compared each frame (0 = API trace only), the first frame and part that differed,
   * and the time spent hashing (both runs). */
  state?: { parts: number; available: boolean; memoryFrames: number; firstDivergence: { frame: number; parts: string[] } | null; hashMs: { lifted: number; interpreted: number } };
  /** Completed frame pairs; requestedFrames is the requested workload. */
  frames: number;
  comparedFrames: number;
  requestedFrames: number;
  failureStage: string | null;
  error: string | null;
  exitStatus: number;
  identical: boolean;
  elapsedMs?: { lifted: number; interpreted: number };
  firstDivergence: number | null;
  hashes: { lifted: string | null; interpreted: string | null; liftedTrace?: string; interpretedTrace?: string; liftedState?: string | null; interpretedState?: string | null };
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

/** Memory hashing reads every mapped guest page (~1-2 GB/s): budget ~2 ms per frame on average. The lifted run decides
 * frame by frame (after each hash, the next one waits ceil(hash ms / 2) frames, so a growing 2 GiB guest is hashed
 * rarely), always hashing the first and last frame; the interpreted run hashes exactly the same frames. */
const MEMORY_MS_PER_FRAME = 2;
/** Whether guest() call `n` hashes memory: the interpreted run follows the lifted run's plan; the lifted run hashes
 * when the budget allows (`next`) and always on the workload's last frame (`last`, not a call index: x64-smoke's
 * startup frames call guest() too, vK72b). */
export const memoryHashDue = (n: number, next: number, last: boolean, plan: Set<number> | null) => plan ? plan.has(n) : n >= next || last;
async function run(id: string, frames: number, script: OracleStep[], parts = 0, plan: Set<number> | null = null): Promise<{
  hashes: string[]; metrics: unknown; error: string | null; stage: string | null; elapsedMs: number; hashMs: number; memoryFrames: Set<number>; available: boolean;
}> {
  let hashMs = 0, index = 0, capHits = 0, next = 0, available = true;
  const memoryFrames = new Set<number>();
  // `last`: the workload's final frame (always hashed). Not `index === frames - 1`: x64-smoke's startup frames also
  // call guest() and shift the index (vK72b review).
  const guest = (h: Headless, last = false) => {
    if (!parts) return '';
    // Hosts without the export (test doubles, pre-vK72 builds) compare the API trace only; the report says so.
    if (typeof h.host.guestStateHash !== 'function' || h.host.guestStateHash(0) === null) { available = false; return ''; }
    const t = performance.now(), n = index++;
    // `current` (fast builds): a frame that ended at the instruction cap stops at a loop header in fast mode but at the
    // exact instruction in the interpreter, so its CPU is not comparable; such frames record "cap" instead.
    let capped = false;
    if (parts & 8) { const hits = Number((h.host.metrics() as { cap_hits?: number }).cap_hits ?? 0); capped = hits !== capHits; capHits = hits; }
    const cpu = parts & 1 ? capped ? 'cap' : h.host.guestStateHash(parts & 11) : null;
    let mem: string | null = null;
    if (parts & 4 && memoryHashDue(n, next, last, plan)) {
      const m0 = performance.now(); mem = h.host.guestStateHash(4); memoryFrames.add(n);
      next = n + Math.max(1, Math.ceil((performance.now() - m0) / MEMORY_MS_PER_FRAME));
    } else if (parts & 4) mem = '-';
    hashMs += performance.now() - t;
    return `|c${cpu ?? ''}|m${mem ?? ''}`;
  };
  let started = performance.now();
  const stream = streamOptions(id);
  /* LANE-K1: deterministic entropy tape is TEST REPLAY ONLY, never used by real play. */
  let cursor = 0;
  const entropy = (bytes: Uint8Array) => { for (let i=0;i<bytes.length;i++) bytes[i] = ((cursor++ * 73 + 41) ^ (cursor >>> 8)) & 255; };
  let h: Headless | undefined;
  const hashes: string[] = [];
  let error: string | null = null;
  let stage: string | null = 'load';
  const byFrame = new Map<number, OracleStep[]>();
  for (const st of script) byFrame.set(st.frame, [...(byFrame.get(st.frame) ?? []), st]);
  try {
    h = await loadHeadless(id, { storage: new Map(), ...stream, entropy, suspension });
    stage = 'startup';
    started = performance.now();
    // The smoke's measured 600-frame loop follows deterministic shader/file startup.
    // Recorder-only pre-roll is identical in both builds and remains part of the trace hash.
    const startup: string[] = [];
    if (oracleBaseId(id) === 'x64-smoke') for (let f=0;f<20;f++) {
      await h.stepAsync(1);
      if (h.host.commandErrorCount) throw new Error(JSON.stringify(h.host.commandErrors));
      startup.push((h.host.stateHash() ?? '') + ':' + stream!.frameHash() + guest(h));
    }
    for (let f = 0; f < frames; f++) {
      stage = f === 0 ? 'startup' : 'execution';
      for (const st of byFrame.get(f) ?? []) {
        if (st.pointer) h.pointer(...st.pointer);
        if (st.key) h.key(...st.key);
      }
      await h.stepAsync(1); // settle external range I/O before advancing deterministic guest time
      /* LANE-GL: compare semantic GPU bytes too, not just the first four integer API arguments. */
      if (stream) assertGlErrors(id, h.host);
      hashes.push((f === 0 && startup.length ? startup.join('|') + '|' : '') +
        (h.host.stateHash() ?? '') + (stream ? ':' + stream.frameHash() : '') + guest(h, f === frames - 1));
    }
    stage = 'metrics';
    if (oracleBaseId(id) === 'x64-gl-scale') assertScaleRecording(h);
    const metrics = h.host.metrics();
    return { hashes, metrics, error: null, stage: null, elapsedMs: performance.now()-started, hashMs, memoryFrames, available };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  // Startup diagnostics remain useful even when the guest never completes a frame.
  let metrics: unknown = null;
  try { metrics = h?.host.metrics() ?? null; } catch { /* preserve the original failure */ }
  return { hashes, metrics, error, stage, elapsedMs: performance.now()-started, hashMs, memoryFrames, available };
}

/** The oracle's default guest-state parts for a built game (see the header comment). */
export function defaultStateParts(id: string, env = process.env): number {
  if (env.BGT_ORACLE_STATE !== undefined) return oracleStateParts(env.BGT_ORACLE_STATE);
  let fast = false;
  try { fast = JSON.parse(readFileSync(join(ROOT, 'web', 'public', 'games', id, 'manifest.json'), 'utf8')).pipeline?.liftPolicy?.liftMode === 'fast'; } catch { /* not built yet: the load reports it */ }
  return fast ? 13 : 7;
}
const STATE_SUFFIX = /\|c[0-9a-z]*\|m[0-9a-z-]*$/;
const traceOf = (s: string | undefined) => s === undefined ? null : s.replace(STATE_SUFFIX, '');
const stateOf = (s: string | undefined) => s === undefined ? null : STATE_SUFFIX.exec(s)?.[0] ?? null;
/** Which parts of two per-frame hash strings differ: trace (API/GL stream), cpu, memory. */
export function divergentParts(a: string | undefined, b: string | undefined): string[] {
  if (a === undefined || b === undefined) return ['missing'];
  const split = (s: string) => { const m = /^(.*?)(?:\|c([0-9a-z]*)\|m([0-9a-z-]*))?$/s.exec(s)!; return [m[1], m[2] ?? '', m[3] ?? '']; };
  const x = split(a), y = split(b);
  return ['trace', 'cpu', 'memory'].filter((_, i) => x[i] !== y[i]);
}

export async function oracle(id: string, frames = 300, script?: OracleStep[], options: { state?: number } = {}): Promise<OracleReport> {
  const parts = options.state ?? defaultStateParts(id);
  let stage = 'setup';
  try {
    if (!Number.isSafeInteger(frames) || frames <= 0) throw new Error('oracle frames must be a positive safe integer');
    stage = 'preflight-load';
    const probe = await loadHeadless(id, { ...streamOptions(id), suspension });
    stage = 'preflight-step';
    await probe.stepAsync(1);
    stage = 'script';
    const sc = script ?? defaultScript(frames, probe.host.logicalWidth, probe.host.logicalHeight);
    stage = 'module-identity';
    // Guest memory holds the module images: both builds must have loaded the same bytes (a fixture rebuilt from
    // another path embeds that path), or the memory part would report a build difference as a lifting bug.
    const modules = (g: string) => { try { return JSON.stringify(JSON.parse(readFileSync(join(ROOT, 'web', 'public', 'games', g, 'manifest.json'), 'utf8')).pipeline?.modules?.map((m: { name: string; sha256: string }) => [m.name, m.sha256]) ?? null); } catch { return null; } };
    if (parts & 4 && modules(id) !== modules(`${id}-interp`)) throw new Error(`lifted and interpreted builds of ${id} loaded different module bytes (rebuild both from the same directory)`);
    stage = 'lifted-setup';
    const a = await run(id, frames, sc, parts);
    stage = 'interpreted-setup';
    const b = await run(`${id}-interp`, frames, sc, parts, a.memoryFrames);
    let first: number | null = null;
    // Compare every completed pair, retaining the first divergence for localization.
    for (let i = 0; i < Math.max(a.hashes.length, b.hashes.length); i++) {
      if (a.hashes[i] !== b.hashes[i] && first === null) first = i;
    }
    const comparedFrames = Math.min(a.hashes.length, b.hashes.length);
    const identical = comparedFrames === frames && first === null && !a.error && !b.error;
    const report: OracleReport = {
      game: id,
      requestedFrames: frames,
      frames: comparedFrames,
      comparedFrames,
      failureStage: a.error ? `lifted-${a.stage}` : b.error ? `interpreted-${b.stage}` : first !== null ? 'comparison' : null,
      error: a.error ?? b.error ?? (first !== null ? `frame ${first} differs` : null),
      exitStatus: identical ? 0 : 1,
      identical,
      elapsedMs: { lifted: a.elapsedMs, interpreted: b.elapsedMs },
      state: { parts, available: a.available && b.available, memoryFrames: a.memoryFrames.size, firstDivergence: first === null ? null : { frame: first, parts: divergentParts(a.hashes[first], b.hashes[first]) },
        hashMs: { lifted: Math.round(a.hashMs * 10) / 10, interpreted: Math.round(b.hashMs * 10) / 10 } },
      firstDivergence: first,
      // API/GPU trace hashes keep their pre-vK72 form; guest-state parts are reported separately.
      hashes: { lifted: traceOf(a.hashes[a.hashes.length - 1]), interpreted: traceOf(b.hashes[b.hashes.length - 1]),
        liftedTrace: createHash('sha256').update(JSON.stringify(a.hashes.map(traceOf))).digest('hex'),
        interpretedTrace: createHash('sha256').update(JSON.stringify(b.hashes.map(traceOf))).digest('hex'),
        ...(parts ? { liftedState: stateOf(a.hashes[a.hashes.length - 1]), interpretedState: stateOf(b.hashes[b.hashes.length - 1]) } : {}) },
      metrics: { lifted: a.metrics, interpreted: b.metrics },
      errors: { lifted: a.error, interpreted: b.error },
    };
    return writeOracleReport(ROOT, report);
  } catch (e) {
    return writeOracleReport(ROOT, oracleFailure(id, frames, stage, e instanceof Error ? e.message : String(e)));
  }
}
