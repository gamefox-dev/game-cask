// K59 Q7: test-only frame pacer for engine pages (Playwright specs and engine:probe --pace). The page's
// requestAnimationFrame is virtualized: the engine's main loop (Godot: one iteration per RAF callback) only runs when
// the test advances it, one virtual frame per real browser frame, so compositing and pixel reads stay normal.
// Inputs keyed to a frame are dispatched right before that frame's callbacks run. With the recorded official
// `--fixed-fps N` option (engineProfile.engineArgs) Godot advances by a fixed step per iteration, so the same inputs at
// the same frames replay identically. Never installed by production shells.
//
// K59 Q8, `virtualTime: true`: the main thread's performance.now(), Date.now() and the rAF timestamps become a
// virtual clock that is CONSTANT within each engine frame and advances exactly one frame period (1000 / fps ms) per
// frame: frame k reads VIRTUAL_PERF_BASE + k * period (Date.now: epochMs + k * period, floored). The same value is
// returned however often it is read, so main-thread audio callbacks that read the clock a varying number of times
// cannot change what the game sees (a per-call ticking clock does not repeat). The base is a constant, not the real
// clock, so microsecond rounding is identical across runs. Not virtualized: workers (threaded runtimes),
// AudioContext.currentTime, event.timeStamp, `new Date()` and performance.timeOrigin. Without the option the clock
// stays real and game code that reads wall time (OS.get_ticks_*, Time) stays wall-time dependent.
export const VIRTUAL_PERF_BASE = 1000;
export const VIRTUAL_EPOCH_MS = Date.UTC(2026, 0, 1);

/** Install BEFORE navigation. fps sets the virtual frame period (rAF timestamps; the virtual clock with virtualTime). */
export async function installEngineFramePacer(page, { fps = 60, virtualTime = false, epochMs = VIRTUAL_EPOCH_MS } = {}) {
  if (!Number.isFinite(fps) || fps < 1 || fps > 1000) throw new Error('frame pacer fps must be 1..1000');
  if (typeof virtualTime !== 'boolean') throw new Error('frame pacer virtualTime must be boolean');
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) throw new Error('frame pacer epochMs must be a nonnegative integer');
  await page.addInitScript(({ fps, virtualTime, epochMs, base }) => {
    if (window.__ENGINE_PACER__) return;
    const realRequest = window.requestAnimationFrame.bind(window), realCancel = window.cancelAnimationFrame.bind(window);
    let queue = new Map(), nextId = 1, frame = 0, busy = false;
    const scheduled = new Map();
    window.requestAnimationFrame = callback => { const id = nextId++; queue.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { queue.delete(id); };
    const period = 1000 / fps, virtualNow = () => base + frame * period;
    if (virtualTime) {
      Object.defineProperty(performance, 'now', { value: function now() { return virtualNow(); }, configurable: true, writable: true });
      Date.now = function now() { return Math.floor(epochMs + frame * period); };
    }
    const runFrame = () => {
      for (const action of scheduled.get(frame) ?? []) action();
      scheduled.delete(frame);
      const due = queue, timestamp = virtualTime ? virtualNow() : frame * period; queue = new Map();
      for (const callback of due.values()) {
        // Like the browser: one failing callback does not stop the others; the error still reaches the page.
        try { callback(timestamp); } catch (e) { setTimeout(() => { throw e; }); }
      }
      frame++;
    };
    window.__ENGINE_PACER__ = {
      fps, virtualTime, realRequestAnimationFrame: realRequest, realCancelAnimationFrame: realCancel,
      clock: () => ({ performanceNow: performance.now(), dateNow: Date.now() }),
      frame: () => frame, pending: () => queue.size,
      /** Run `action` at the start of virtual frame `at` (before the engine's callbacks of that frame). */
      at(at, action) {
        if (!Number.isInteger(at) || at < frame) throw new Error(`frame pacer: frame ${at} already ran (now ${frame})`);
        if (!scheduled.has(at)) scheduled.set(at, []);
        scheduled.get(at).push(action);
      },
      /** Run n virtual frames, one per real frame; capture(canvas) runs synchronously right after the last one. */
      advance(n, capture = null) {
        if (!Number.isInteger(n) || n < 0 || n > 100000) return Promise.reject(new Error('frame pacer: invalid frame count'));
        if (busy) return Promise.reject(new Error('frame pacer: concurrent advance'));
        busy = true;
        return new Promise((resolve, reject) => {
          let left = n;
          const tick = () => {
            try {
              if (left > 0) { runFrame(); left--; }
              if (left > 0) { realRequest(tick); return; }
              busy = false; resolve(capture ? capture() : frame);
            } catch (e) { busy = false; reject(e); }
          };
          if (n === 0) { busy = false; resolve(capture ? capture() : frame); } else realRequest(tick);
        });
      },
    };
  }, { fps, virtualTime, epochMs, base: VIRTUAL_PERF_BASE });
}

/** Pacer helpers for specs; the adapter's step(n)/inputAt(frame, events)/frameHash(n) use the pacer when installed. */
export const engineFrame = page => page.evaluate(() => window.__ENGINE_PACER__.frame());
export const engineAdvance = (page, n) => page.evaluate(n => window.__BGT_TEST__.step(n), n);
export const engineInputAt = (page, frame, events) => page.evaluate(([f, e]) => window.__BGT_TEST__.inputAt(f, e), [frame, events]);
/** Advance n frames, then the SHA-256 of the canvas pixels read in the same task as the last engine frame. */
export const engineFrameHash = (page, n = 0) => page.evaluate(n => window.__BGT_TEST__.frameHash(n), n);
export const pacerAvailable = page => page.evaluate(() => !!window.__ENGINE_PACER__);
