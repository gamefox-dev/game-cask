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

for (const phase of ['before-headers', 'mid-body']) {
  test('same-URL cancellation is isolated: ' + phase, async ({ page }, info) => {
    info.annotations.push({ type: 'catches', description: 'A second same-URL request cannot inherit a prior complete EOF/hash.' });
    const bytes = Buffer.alloc(16384, 42), hash = createHash('sha256').update(bytes).digest('hex');
    let count = 0, arrived!: () => void;
    const secondRequest = new Promise<void>(resolve => { arrived = resolve; });
    const tokens: unknown[] = [];
    const server = createServer((req, res) => {
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<html></html>'); }
      else if (req.url === '/godot.wasm') {
        tokens.push(req.headers['x-game-cask-capture-id']); count++;
        if (count === 1) { res.writeHead(200, { 'Content-Type': 'application/wasm', 'Content-Length': bytes.length }); res.end(bytes); }
        else {
          if (phase === 'mid-body') { res.writeHead(200, { 'Content-Type': 'application/wasm', 'Content-Length': bytes.length }); res.write(bytes.subarray(0, 100)); }
          arrived(); // Keep headers/body unfinished until the browser aborts.
        }
      } else { res.writeHead(204); res.end(); }
    });
    const port = Number(process.env.BGT_E2E_PORT ?? 5189);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    try {
      const capture = await captureEngineErrors(page, { 'godot.wasm': hash });
      await page.goto('http://127.0.0.1:' + port + '/');
      await page.evaluate(async () => { const r = await fetch('/godot.wasm'), reader = r.body!.getReader(); while (!(await reader.read()).done) { /* consume original stream */ } });
      const failed = page.waitForEvent('requestfailed');
      await page.evaluate(() => {
        (window as any).controller = new AbortController();
        (window as any).pending = fetch('/godot.wasm', { signal: (window as any).controller.signal }).then(async r => {
          const reader = r.body!.getReader(); await reader.read(); (window as any).readFirst = true; await reader.read();
        }).catch(() => {});
      });
      await secondRequest;
      if (phase === 'mid-body') await page.waitForFunction(() => (window as any).readFirst);
      await page.evaluate(async () => { (window as any).controller.abort(); await (window as any).pending; });
      await failed;
      const network = await capture.finish();
      await info.attach('same-url-fault-evidence.json', { body: JSON.stringify(network), contentType: 'application/json' });
      expect(count).toBe(2); expect(tokens.every(t => typeof t === 'string')).toBe(true); expect(new Set(tokens).size).toBe(2);
      expect(network.bodies).toHaveLength(2); expect(network.bodies[0].done).toBe(true); expect(network.bodies[1].done).toBe(false);
      expect(network.errors.some((e: string) => e.startsWith('request:'))).toBe(true);
      expect(network.requests).toHaveLength(1); expect(network.requests[0].classification).toBe('failure');
      expect(network.requests[0].evidence.atCancellation.token).toBe(network.bodies[1].token);
      expect(network.requests[0].evidence.atCancellation.received).toBe(phase === 'mid-body' ? 100 : 0);
    } finally { await page.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
  });
}

test('capture identity headers stay same-origin and capture-only', async ({ page }, info) => {
  info.annotations.push({ type: 'catches', description: 'Normal fetches and cross-origin runtime requests receive no diagnostic token or CORS preflight; only captured same-origin requests are tagged.' });
  const bytes = Buffer.alloc(128, 42), hash = createHash('sha256').update(bytes).digest('hex');
  const seen: { port: number; method: string; token: unknown }[] = [];
  const port = Number(process.env.BGT_E2E_PORT ?? 5189);
  const servers = [port, port + 1].map(p => createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<html></html>'); }
    else if (req.url === '/godot.wasm') {
      seen.push({ port: p, method: req.method!, token: req.headers['x-game-cask-capture-id'] });
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/wasm', 'Content-Length': bytes.length }); res.end(bytes);
    } else { res.writeHead(204); res.end(); }
  }));
  await Promise.all(servers.map((s, i) => new Promise<void>((resolve, reject) => { s.once('error', reject); s.listen(port + i, '127.0.0.1', resolve); })));
  try {
    await page.goto('http://127.0.0.1:' + port + '/');
    const consume = (url: string) => page.evaluate(async url => { const reader = (await fetch(url)).body!.getReader(); while (!(await reader.read()).done) { /* original stream */ } }, url);
    await consume('/godot.wasm');
    expect(seen[0].token).toBeUndefined();
    const capture = await captureEngineErrors(page, { 'godot.wasm': hash });
    await page.reload(); await consume('/godot.wasm');
    await consume('http://127.0.0.1:' + (port + 1) + '/godot.wasm');
    expect((await capture.finish()).errors).toEqual([]);
    expect(seen).toHaveLength(3); expect(typeof seen[1].token).toBe('string'); expect(seen[2].token).toBeUndefined();
    expect(seen.map(r => r.method)).toEqual(['GET', 'GET', 'GET']);
  } finally { await page.close(); await Promise.all(servers.map(s => new Promise<void>(resolve => { s.close(() => resolve()); s.closeAllConnections(); }))); }
});
