// Generated launch page for an official Godot web runtime. Two engine JS APIs exist:
//   godot-config (3.3+ and 4.x): new Engine(config).startGame()
//   godot-legacy (3.2.x):        new Engine(); setCanvas(); startGame(executable, pack)
// The runtime and the pack are unchanged; the page only adds the observation-only test adapter.
export function generateShell({ id, name, runtime, packSize, wasmSize, width = 640, height = 360, packSha256, allowedErrors = [], engineArgs = [] }) {
  const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
  const title = String(name).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const major = Number(runtime.version.split('.')[0]), threads = !!runtime.requirements.threads;
  const identity = { path: 'engineProfile', game: id, runtimeId: runtime.id, archiveSha256: runtime.sha256, packSha256, renderer: runtime.requirements.renderer, threads, engineArgs: [...engineArgs],
    // K59: recorded game-originated engine errors (observation: counted, not failed); see engineProfile.allowedErrors.
    ...(allowedErrors.length ? { allowedErrors: allowedErrors.map(({ id, message, pattern, justification, evidence, evidenceSha256 }) => ({ id, message, pattern, justification, evidence, evidenceSha256 })) } : {}) };
  const print = 'x=>{console.log(x);test.log(x);}', printErr = 'x=>{(test.engineStderr(x)==="error"?console.error:console.warn)(x);}';
  let start;
  if ((runtime.shell ?? 'godot-config') === 'godot-legacy') {
    if (engineArgs.length) throw new Error('engine arguments need the Engine config API (Godot 3.3+/4.x)');
    start = 'const engine = new Engine();\n' +
      `engine.setCanvas(canvas); engine.setCanvasResizedOnStart(false); engine.setStdoutFunc(${print}); engine.setStderrFunc(${printErr}); engine.setOnExit(code=>test.error("exit",code));\n` +
      'const started = engine.startGame("godot","game.pck");\n';
  } else {
    const config = { executable: 'godot', mainPack: 'game.pck', canvasResizePolicy: 0, focusCanvas: true, serviceWorker: '', args: [...engineArgs],
      fileSizes: { 'godot.wasm': wasmSize, 'game.pck': packSize },
      // 4.x: the page is served with COOP/COEP itself; never fall back to the template's header service worker.
      ...(major >= 4 ? { ensureCrossOriginIsolationHeaders: false, experimentalVK: false, gdextensionLibs: [] } : {}) };
    start = `const config = Object.assign(${json(config)}, {canvas, onPrint:(...x)=>(${print})(x.join(" ")), onPrintError:(...x)=>(${printErr})(x.join(" ")), onExit:code=>test.error("exit",code)});\n` +
      (threads ? 'if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") test.error("boot","threaded runtime requires cross-origin isolation (COOP/COEP headers)");\n' : '') +
      'const engine = new Engine(config);\n' +
      'const started = engine.startGame();\n';
  }
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>' + title + '</title></head>' +
    '<body style="margin:0;background:#000"><canvas id="canvas" tabindex="0" width="' + width + '" height="' + height + '"></canvas><pre id="status" role="status"></pre>' +
    '<script src="godot.js"></script><script type="module">\n' +
    'import { installEngineTestAdapter } from "./browser-adapter.js";\n' +
    'const canvas = document.getElementById("canvas"), status = document.getElementById("status");\n' +
    'const test = installEngineTestAdapter(canvas, ' + json(identity) + ');\n' +
    start +
    'started.then(()=>{test.ready();canvas.focus();status.textContent="";}).catch(e=>{test.error("boot",e);status.textContent=String(e);});\n' +
    '</script></body></html>\n';
}
