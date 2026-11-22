/* global XMLHttpRequest */
// Browser evidence only: observe the ORIGINAL fetch reader, never buffer/replace
// responses, patch runtime bytes, disable streaming compilation or suppress errors.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * K59: the large assets of a served engine build whose delivery is checked like the runtime wasm: every pack
 * (`*.pck`) and the wasm, with the build manifest's SHA-256 and byte length. `build` is a build directory or its
 * parsed manifest.json (the server verified exactly these hashes before serving).
 */
export function buildAssets(build) {
  const manifest = typeof build === 'string' ? JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8')) : build;
  if (manifest?.path !== 'engineProfile' || !manifest.files) throw new Error('buildAssets: not an engine build manifest');
  const assets = {};
  for (const [name, sha256] of Object.entries(manifest.files)) if (/\.(pck|wasm)$/.test(name))
    assets[name] = { sha256, bytes: manifest.metrics?.files?.[name]?.bytes ?? null };
  if (!Object.keys(assets).some(n => n.endsWith('.pck'))) throw new Error('buildAssets: engine build has no pack');
  return assets;
}

/** files: runtime name -> SHA-256 (only `.wasm` entries are tracked); assets: name -> SHA-256 or { sha256, bytes }. */
export function expectedBodies(files = {}, assets = {}) {
  const expected = {};
  const add = (name, value) => {
    const entry = typeof value === 'string' ? { sha256: value, bytes: null } : { sha256: value?.sha256, bytes: value?.bytes ?? null };
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || entry.bytes !== null && !(Number.isSafeInteger(entry.bytes) && entry.bytes > 0)) throw new Error('invalid expected body for ' + name);
    if (expected[name] && expected[name].sha256 !== entry.sha256) throw new Error('conflicting expected SHA-256 for ' + name);
    expected[name] = { sha256: entry.sha256, bytes: entry.bytes ?? expected[name]?.bytes ?? null };
  };
  for (const [name, value] of Object.entries(files)) if (name.endsWith('.wasm')) add(name, value);
  for (const [name, value] of Object.entries(assets)) add(name, value);
  return expected;
}

/** A Chromium ERR_ABORTED is benign only after the complete, pinned body was delivered (HTTP 200, EOF, length, hash). */
export function classifyCancellation(error, atCancellation, completed, expected) {
  const length = expected?.bytes;
  const complete = r => r?.done && r.length > 0 && r.received === r.length && (length == null || r.received === length);
  return error === 'net::ERR_ABORTED' && !!expected && complete(atCancellation) && complete(completed) && completed.status === 200 &&
    completed.sha256 === expected.sha256 ? 'canceled-after-complete' : 'failure';
}

/**
 * Install BEFORE navigation; await finish() before asserting. `files`: the verified runtime hashes (its `.wasm` is
 * tracked). K59: `{ build }` (a build directory or manifest) or `{ assets }` also tracks the pack, so a Chromium
 * cancellation after the whole pack arrived is classified like the wasm one instead of failing the run.
 */
export async function captureEngineErrors(page, files, { build, assets } = {}) {
  const errors = [], requests = [], pending = [];
  const expected = expectedBodies(files, { ...(build ? buildAssets(build) : {}), ...assets });
  await page.addInitScript(({ expected }) => {
    const records = []; window.__ENGINE_REQUEST_EVIDENCE__ = records;
    const originalFetch = window.fetch;
    const digest = (record, data) => {
      record.hashing = crypto.subtle.digest('SHA-256', data).then(digest => {
        record.sha256 = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
      }, e => { record.hashError = String(e); });
    };
    window.fetch = async function (...args) {
      const inputRequest = args[0] instanceof window.Request;
      const url = new URL(inputRequest ? args[0].url : String(args[0]), location.href);
      const name = url.pathname.slice(1);
      // Capture-only identity: never touch cross-origin requests or production shells.
      // Allocate BEFORE fetch so an abort before response headers cannot borrow a
      // previous response's EOF/hash. Bind this token to Playwright's Request.
      if (url.origin !== location.origin || !Object.hasOwn(expected, name)) return originalFetch.apply(this, args);
      const token = crypto.randomUUID();
      const headers = new window.Headers(args[1]?.headers ?? (inputRequest ? args[0].headers : undefined));
      headers.set('X-Game-Cask-Capture-Id', token);
      args[1] = { ...args[1], headers };
      const record = { token, url: url.href, status: null, length: 0, received: 0, done: false, sha256: null };
      records.push(record);
      const response = await originalFetch.apply(this, args);
      record.status = response.status; record.length = Number(response.headers.get('Content-Length'));
      if (!response.body) return response;
      const stream = response.body, originalReader = stream.getReader;
      stream.getReader = function (...readerArgs) {
        const reader = originalReader.apply(this, readerArgs), read = reader.read, chunks = [];
        // K59: packs can be large. With a Content-Length, copy each chunk once into one preallocated buffer
        // (1x the body) instead of chunk copies plus a concatenation (2x).
        let buffer = null;
        if (record.length > 0) try { buffer = new Uint8Array(record.length); } catch (e) { record.hashError = String(e); }
        reader.read = function (...readArgs) {
          return read.apply(this, readArgs).then(result => {
            if (result.value) {
              const n = result.value.byteLength;
              if (buffer) { if (record.received + n <= buffer.length) buffer.set(result.value, record.received); else record.overflow = true; }
              else if (!record.hashError) chunks.push(result.value.slice());
              record.received += n;
            }
            if (result.done) {
              record.done = true;
              if (buffer) { if (!record.overflow && record.received === buffer.length) digest(record, buffer); buffer = null; }
              else if (!record.hashError) {
                const data = new Uint8Array(record.received); let at = 0;
                for (const chunk of chunks) { data.set(chunk, at); at += chunk.byteLength; }
                chunks.length = 0; digest(record, data);
              }
            }
            return result;
          });
        };
        return reader;
      };
      return response;
    };
    // Godot 3.2's loader uses XMLHttpRequest (arraybuffer). Observe completed bodies the same way, read-only.
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, target, ...rest) {
      const url = new URL(String(target), location.href), name = url.pathname.slice(1);
      if (url.origin === location.origin && Object.hasOwn(expected, name)) {
        const record = { token: null, transport: 'xhr', url: url.href, status: null, length: 0, received: 0, done: false, sha256: null };
        records.push(record);
        this.addEventListener('loadend', () => {
          record.status = this.status; record.length = Number(this.getResponseHeader('Content-Length'));
          const body = this.responseType === 'arraybuffer' ? this.response : null;
          if (!body) return;
          record.received = body.byteLength; record.done = true;
          digest(record, body);
        });
      }
      return open.call(this, method, target, ...rest);
    };
  }, { expected });
  page.on('pageerror', e => errors.push('page: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  page.on('requestfailed', request => {
    const failure = { url: request.url(), error: request.failure()?.errorText, classification: 'failure', evidence: null };
    requests.push(failure);
    // Snapshot received bytes at cancellation, not merely at end-of-test. Partial
    // cancellations can NEVER be reclassified by a later successful retry.
    const token = request.headers()['x-game-cask-capture-id'];
    const snapshot = page.evaluate(token => {
      const records = window.__ENGINE_REQUEST_EVIDENCE__ ?? [];
      const r = token && records.find(r => r.token === token);
      return r ? { token: r.token, received: r.received, done: r.done, length: r.length, index: records.indexOf(r) } : null;
    }, token).catch(() => null);
    pending.push({ failure, snapshot });
  });
  return { errors, requests, expected, async finish() {
    for (const { failure, snapshot } of pending.splice(0)) {
      const first = await snapshot;
      const final = first && await page.evaluate(async index => {
        const r = window.__ENGINE_REQUEST_EVIDENCE__?.[index];
        if (!r) return null;
        await r.hashing;
        return { token: r.token, url: r.url, status: r.status, length: r.length, received: r.received, done: r.done, sha256: r.sha256 };
      }, first.index).catch(() => null);
      failure.evidence = { atCancellation: first, completed: final };
      const name = new URL(failure.url).pathname.slice(1);
      failure.classification = classifyCancellation(failure.error, first, final, Object.hasOwn(expected, name) ? expected[name] : null);
      if (failure.classification !== 'canceled-after-complete') errors.push('request: ' + failure.url + ' ' + failure.error);
    }
    const bodies = await page.evaluate(async () => {
      const records = window.__ENGINE_REQUEST_EVIDENCE__ ?? [];
      await Promise.all(records.map(r => r.hashing));
      return records.map(r => ({ token: r.token, url: r.url, status: r.status, length: r.length, received: r.received, done: r.done, sha256: r.sha256, ...(r.hashError ? { hashError: r.hashError } : {}) }));
    }).catch(e => { errors.push('runtime evidence unavailable: ' + e.message); return []; });
    for (const name of Object.keys(expected)) if (!bodies.some(r => new URL(r.url).pathname === '/' + name)) errors.push('missing runtime body evidence: ' + name);
    for (const r of bodies) {
      const name = new URL(r.url).pathname.slice(1), want = expected[name];
      if (!r.done || r.status !== 200 || !r.length || r.received !== r.length || (want.bytes != null && r.received !== want.bytes) || r.sha256 !== want.sha256)
        errors.push('runtime body integrity: ' + r.url);
    }
    return { errors, requests, bodies };
  } };
}
