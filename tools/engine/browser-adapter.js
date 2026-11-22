/* global requestAnimationFrame, KeyboardEvent, MouseEvent, HTMLCanvasElement */
// Host-side observation only. Never patches the official runtime or game pack.

/**
 * vK59: structural check of an engineProfile.allowedErrors pattern (shared by the build validator and this adapter).
 * The pattern must compile on its own (no group break-out such as "x)|(?!"), have no top-level alternation, no
 * lookaround, no backreference, no negated class and no escape that can match a line break (only \d \w \S \b \B and
 * escaped punctuation); control/line-separator characters are refused. Returns an error string or null.
 */
export function allowPatternProblem(pattern) {
  if (typeof pattern !== 'string' || !pattern) return 'pattern must be a non-empty string';
  if ([...pattern].some(ch => { const c = ch.codePointAt(0); return c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029; })) return 'pattern contains a control or line-separator character';
  try { new RegExp(pattern, 'u'); } catch (e) { return 'pattern does not compile on its own: ' + e.message; }
  let depth = 0, inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      const n = pattern[i + 1] ?? '';
      if (/[A-Za-z0-9]/.test(n) && !'dwSbB'.includes(n)) return 'escape \\' + n + ' is not allowed (only \\d \\w \\S \\b \\B and escaped punctuation)';
      i++; continue;
    }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { if (pattern[i + 1] === '^') return 'negated character classes are not allowed'; inClass = true; continue; }
    if (c === '(') {
      if (/^\(\?<?[=!]/.test(pattern.slice(i))) return 'lookarounds are not allowed';
      depth++; continue;
    }
    if (c === ')') { if (--depth < 0) return 'unbalanced parenthesis'; continue; }
    if (c === '|' && depth === 0) return 'top-level alternation is not allowed (one entry per line)';
  }
  return depth === 0 && !inClass ? null : 'unbalanced pattern';
}
/** Engine stderr may carry several lines in one call; each is classified on its own (vK59). */
export const stderrLines = message => { const lines = String(message).split(/\r\n|[\r\n\u2028\u2029]/u); if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop(); return lines; };

export function installEngineTestAdapter(canvas, identity) {
  const errors = [], logs = []; let ready = false, frame = 0;
  const unsupported = feature => { throw new Error('engineProfile does not support BGT ' + feature); };
  const bounded = (list, value) => { if (list.length < 1000) list.push(value); };
  const warnings = [];
  const error = (kind, message) => bounded(errors, { kind, message: String(message) });
  // Engine stderr carries both errors and warnings. Godot prefixes them ("ERROR:", "USER ERROR:", "SCRIPT ERROR:",
  // "WARNING:", "USER WARNING:"). Only indented continuation lines ("   at: ...") inherit the previous severity, plus
  // an exact allowlist of known benign engine/emscripten notices. Everything else (e.g. "Aborted(RuntimeError: ...)",
  // "RuntimeError: memory access out of bounds") is an error, even right after a warning (fail-closed).
  const BENIGN = [/^Defaulting mix rate to value \d+\.$/, /^Blocking on the main thread is very dangerous, see https:\/\/emscripten\.org\//];
  // K59: engineProfile.allowedErrors (validated at build: exact line or whole-line pattern, ERROR-prefixed lines only,
  // justification + evidence). A matching line and its indented "at:" continuations are 'allowed': counted per entry
  // in diagnostics().allowlisted, never hidden. Unmatched errors still fail.
  const allowlist = (identity.allowedErrors ?? []).map(entry => {
    let match = () => false;
    if (typeof entry.message === 'string') match = line => line === entry.message;
    else {
      // Defense in depth: the build validated it, but never wrap an unchecked pattern.
      const problem = allowPatternProblem(entry.pattern);
      if (problem) error('allowlist', 'invalid allowedErrors pattern ' + entry.id + ': ' + problem);
      else { const re = new RegExp('^(?:' + entry.pattern + ')$', 'u'); match = line => re.test(line); }
    }
    return { entry, match, count: 0, continuations: 0 };
  });
  let lastSeverity = null, lastAllowed = null;
  const SEVERITY = { error: 3, allowed: 2, warning: 1 };
  const engineStderr = message => stderrLines(message).map(stderrLine).reduce((a, b) => SEVERITY[b] > SEVERITY[a] ? b : a);
  const stderrLine = text => {
    const errorLine = /^(USER |SCRIPT )?ERROR:/.test(text);
    let severity = errorLine ? 'error' : /^(USER )?WARNING:/.test(text) || BENIGN.some(re => re.test(text)) ? 'warning'
      : /^\s+at:\s/.test(text) && lastSeverity ? lastSeverity : 'error';
    if (errorLine) {
      lastAllowed = allowlist.find(a => a.match(text)) ?? null;
      if (lastAllowed) { severity = 'allowed'; lastAllowed.count++; }
    } else if (severity === 'allowed') lastAllowed.continuations++;
    lastSeverity = severity;
    if (severity === 'warning') bounded(warnings, { kind: 'engine', message: text });
    else if (severity === 'error') error('engine', text);
    return severity;
  };
  const allowlisted = () => allowlist.map(({ entry, count, continuations }) => ({ ...entry, count, continuations }));
  window.addEventListener('error', e => error('page', e.message));
  window.addEventListener('unhandledrejection', e => error('promise', e.reason));
  // K59 Q7: with the test-only frame pacer (tools/engine/pacer.mjs) the page's requestAnimationFrame drives only the
  // engine; the adapter observes real browser frames through the pacer's real RAF.
  const pacer = window.__ENGINE_PACER__ ?? null;
  const raf = pacer ? pacer.realRequestAnimationFrame : callback => requestAnimationFrame(callback);
  const timestamps = [];
  const tick = time => { frame++; timestamps.push(time); if (timestamps.length > 10001) timestamps.shift(); raf(tick); };
  raf(tick);
  const timing = () => {
    const samples = timestamps.slice(1).map((t, i) => t - timestamps[i]);
    const sorted = [...samples].sort((a, b) => a - b);
    return { source: 'requestAnimationFrame display cadence, NOT engine frames/CPU/GPU time', samples: samples.length,
      avgMs: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null,
      p95Ms: samples.length ? sorted[Math.ceil(samples.length * .95) - 1] : null };
  };
  const waitFrames = n => {
    if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error('invalid observed frame count');
    return new Promise(resolve => { const tick = () => { if (n-- <= 0) resolve(); else raf(tick); }; tick(); });
  };
  const copyNow = () => {
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas, 0, 0); return copy;
  };
  const copyCanvas = () => new Promise(resolve => raf(() => resolve(copyNow())));
  const needPacer = what => { if (!pacer) throw new Error(what + ' needs the frame pacer (installEngineFramePacer before navigation / engine:probe --pace)'); };
  const frameHash = async n => {
    needPacer('frameHash');
    const shot = await pacer.advance(n, () => { const c = copyNow(); return { frame: pacer.frame(), width: c.width, height: c.height, data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data }; });
    const digest = await crypto.subtle.digest('SHA-256', shot.data);
    return { frame: shot.frame, width: shot.width, height: shot.height, sha256: Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('') };
  };
  const keyMap = { UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', A: 'Space', B: 'KeyX', START: 'Enter', SELECT: 'Backspace' };
  const input = events => {
    canvas.focus();
    for (const e of events) {
      if (e.type === 'key' || e.type === 'button') {
        const code = e.code || keyMap[e.button];
        const key = code === 'Space' ? ' ' : code?.startsWith('Key') ? code.slice(3).toLowerCase() : code;
        if (!code) throw new Error('unsupported engine input button');
        // Godot 3 uses KeyboardEvent.code/key (DOM dispatch, not BGT input memory).
        canvas.dispatchEvent(new KeyboardEvent(e.down ? 'keydown' : 'keyup', { code, key, bubbles: true, cancelable: true }));
      } else if (e.type === 'pointer') {
        const r = canvas.getBoundingClientRect(), buttons = e.buttons ?? (e.down ? 1 : 0);
        const init = { clientX: r.left + e.x * r.width / canvas.width, clientY: r.top + e.y * r.height / canvas.height, buttons, bubbles: true };
        canvas.dispatchEvent(new MouseEvent('mousemove', init));
        canvas.dispatchEvent(new MouseEvent(buttons ? 'mousedown' : 'mouseup', { ...init, button: buttons === 2 ? 2 : 0 }));
      } else throw new Error('unsupported engine input event');
    }
  };
  const api = {
    ready: () => ready, failed: () => errors.length > 0, backend: () => identity.renderer,
    diagnostics: () => ({ ...identity, frame, errors: [...errors], warnings: [...warnings], allowlisted: allowlisted(), logs: [...logs], backend: identity.renderer,
      backendNotes: ['Official engine runtime; BGT backend/suspension selection does not apply'],
      logical: { width: canvas.width, height: canvas.height }, letterbox: { x: 0, y: 0, w: canvas.width, h: canvas.height },
      capabilities: { deterministic: false, framePacer: !!pacer, pause: false, peek: false, savestates: false, cpuProfile: false, coverage: false },
      pacer: pacer ? { fps: pacer.fps, frame: pacer.frame(), pending: pacer.pending() } : null,
      metrics: { engineProfile: identity, raf: timing() } }),
    input, waitFrames, timing, frameHash,
    // Paced: step(n) runs n engine frames; unpaced: it observes n browser frames (no engine control).
    step: n => pacer ? pacer.advance(n).then(() => undefined) : waitFrames(n),
    inputAt: (at, events) => { needPacer('inputAt'); pacer.at(at, () => input(events)); },
    engineFrame: () => pacer ? pacer.frame() : null,
    pause: () => unsupported('pause/deterministic stepping'), resume: () => unsupported('pause/resume'),
    stateHash: () => null, debugState: () => null,
    screenshot: async () => { const c = await copyCanvas(); return new Promise(resolve => HTMLCanvasElement.prototype.toBlob.call(c, resolve, 'image/png')); },
    readPixels: async () => {
      const c = await copyCanvas(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = ''; for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode(...d.subarray(i, i + 32768));
      return { width: c.width, height: c.height, base64: btoa(s) };
    },
  };
  for (const name of ['peek', 'snapshot', 'restore', 'exportSnapshot', 'importSnapshot', 'profileReset', 'injectCommands', 'simulateDeviceLoss']) api[name] = () => unsupported(name);
  window.__BGT_TEST__ = api;
  return { ready: () => { ready = true; }, error, engineStderr, log: message => { lastSeverity = null; lastAllowed = null; bounded(logs, String(message)); } };
}
