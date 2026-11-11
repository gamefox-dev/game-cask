export function generateShell({ id, name, runtime, packSize, wasmSize, width = 640, height = 360, packSha256 }) {
  const json = value => JSON.stringify(value).replaceAll('<', '\u003c');
  const title = String(name).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>' + title + '</title></head>' +
    '<body style="margin:0;background:#000"><canvas id="canvas" tabindex="0" width="' + width + '" height="' + height + '"></canvas><pre id="status" role="status"></pre>' +
    '<script src="godot.js"></script><script type="module">\n' +
    'import { installEngineTestAdapter } from "./browser-adapter.js";\n' +
    'const canvas = document.getElementById("canvas"), status = document.getElementById("status");\n' +
    'const test = installEngineTestAdapter(canvas, ' + json({ path: 'engineProfile', game: id, runtimeId: runtime.id, archiveSha256: runtime.sha256, packSha256, renderer: runtime.requirements.renderer }) + ');\n' +
    'const engine = new Engine({executable:"godot",mainPack:"game.pck",canvas,canvasResizePolicy:0,focusCanvas:true,serviceWorker:"",fileSizes:{"godot.wasm":' + wasmSize + ',"game.pck":' + packSize + '},onPrint:(...x)=>{console.log(...x);test.log(x.join(" "));},onPrintError:(...x)=>{console.error(...x);test.error("engine",x.join(" "));},onExit:code=>test.error("exit",code)});\n' +
    'engine.startGame().then(()=>{test.ready();canvas.focus();status.textContent="";}).catch(e=>{test.error("boot",e);status.textContent=String(e);});\n' +
    '</script></body></html>\n';
}
