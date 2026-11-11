// CC0 network fault fixtures, independent of any provisioned engine runtime.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
// @ts-expect-error shared request evidence collector
import { captureEngineErrors } from '../../tools/engine/capture.mjs';
for (const mode of ['valid', 'truncated', 'hash-mismatch', 'cancel-before-EOF']) {
  test('runtime evidence distinguishes ' + mode, async ({ page }, info) => {
    info.annotations.push({ type: 'catches', description: 'Only complete, pinned HTTP 200 bytes may classify a Chromium cancellation; truncated, wrong-hash and early-canceled bodies fail.' });
    const bytes = Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, 0x81, 0x80, 1, 0]), Buffer.alloc(16384, 42)]);
    expect(() => new WebAssembly.Module(bytes)).not.toThrow();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const server = createServer((req, res) => {
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html'); res.end('<script>window.done=false; const controller=new AbortController(); fetch("/godot.wasm",{signal:controller.signal}).then(async r=>{const reader=r.body.getReader(); for(;;){const result=await reader.read(); if(result.done)break; if(' + JSON.stringify(mode === 'cancel-before-EOF') + ')controller.abort();}}).catch(e=>window.loadError=String(e)).finally(()=>window.done=true);</script>');
      } else if (req.url === '/godot.wasm') {
        res.writeHead(200, { 'Content-Type': 'application/wasm', 'Content-Length': bytes.length });
        if (mode === 'truncated' || mode === 'cancel-before-EOF') {
          res.write(bytes.subarray(0, 100)); setTimeout(() => res.destroy(), 100);
        } else res.end(mode === 'hash-mismatch' ? Buffer.alloc(bytes.length, 43) : bytes);
      } else { res.writeHead(204); res.end(); }
    });
    const port = Number(process.env.BGT_E2E_PORT ?? 5189);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    try {
      const capture = await captureEngineErrors(page, { 'godot.wasm': hash });
      await page.goto('http://127.0.0.1:' + port + '/'); await page.waitForFunction(() => (window as any).done);
      const network = await capture.finish();
      await info.attach('fault-evidence.json', { body: JSON.stringify(network), contentType: 'application/json' });
      if (mode === 'valid') expect(network.errors).toEqual([]);
      else { expect(network.errors.length).toBeGreaterThan(0); expect(network.requests.every((r: any) => r.classification !== 'canceled-after-complete')).toBe(true); }
    } finally { await page.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
  });
}
