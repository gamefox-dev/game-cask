/* global requestAnimationFrame, KeyboardEvent, MouseEvent, HTMLCanvasElement */
// Host-side observation only. Never patches the official runtime or game pack.
export function installEngineTestAdapter(canvas, identity) {
  const errors = [], logs = []; let ready = false, frame = 0;
  const unsupported = feature => { throw new Error('engineProfile does not support BGT ' + feature); };
  const bounded = (list, value) => { if (list.length < 1000) list.push(value); };
  const error = (kind, message) => bounded(errors, { kind, message: String(message) });
  window.addEventListener('error', e => error('page', e.message));
  window.addEventListener('unhandledrejection', e => error('promise', e.reason));
  const timestamps = [];
  const tick = time => { frame++; timestamps.push(time); if (timestamps.length > 10001) timestamps.shift(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const timing = () => {
    const samples = timestamps.slice(1).map((t, i) => t - timestamps[i]);
    const sorted = [...samples].sort((a, b) => a - b);
    return { source: 'requestAnimationFrame display cadence, NOT engine frames/CPU/GPU time', samples: samples.length,
      avgMs: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null,
      p95Ms: samples.length ? sorted[Math.ceil(samples.length * .95) - 1] : null };
  };
  const waitFrames = n => {
    if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error('invalid observed frame count');
    return new Promise(resolve => { const tick = () => { if (n-- <= 0) resolve(); else requestAnimationFrame(tick); }; tick(); });
  };
  const copyCanvas = () => new Promise(resolve => requestAnimationFrame(() => {
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas, 0, 0); resolve(copy);
  }));
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
    diagnostics: () => ({ ...identity, frame, errors: [...errors], logs: [...logs], backend: identity.renderer,
      backendNotes: ['Official engine runtime; BGT backend/suspension selection does not apply'],
      logical: { width: canvas.width, height: canvas.height }, letterbox: { x: 0, y: 0, w: canvas.width, h: canvas.height },
      capabilities: { deterministic: false, pause: false, peek: false, savestates: false, cpuProfile: false, coverage: false },
      metrics: { engineProfile: identity, raf: timing() } }),
    input, step: waitFrames, waitFrames, timing,
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
  return { ready: () => { ready = true; }, error, log: message => bounded(logs, String(message)) };
}
