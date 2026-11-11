// Browser evidence only: observe the ORIGINAL fetch reader, never buffer/replace
// responses, patch runtime bytes, disable streaming compilation or suppress errors.
export async function captureEngineErrors(page, files) {
  const errors = [], requests = [], pending = [];
  const expected = Object.fromEntries(Object.entries(files).filter(([name]) => name.endsWith('.wasm')));
  await page.addInitScript(({ expected }) => {
    const records = []; window.__ENGINE_REQUEST_EVIDENCE__ = records;
    const originalFetch = window.fetch;
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
        reader.read = function (...readArgs) {
          return read.apply(this, readArgs).then(result => {
            if (result.value) { record.received += result.value.byteLength; chunks.push(result.value.slice()); }
            if (result.done) {
              record.done = true;
              const data = new Uint8Array(record.received); let at = 0;
              for (const chunk of chunks) { data.set(chunk, at); at += chunk.byteLength; }
              chunks.length = 0;
              record.hashing = crypto.subtle.digest('SHA-256', data).then(digest => {
                record.sha256 = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
              });
            }
            return result;
          });
        };
        return reader;
      };
      return response;
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
  return { errors, requests, async finish() {
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
      if (failure.error === 'net::ERR_ABORTED' && first?.done && first.length > 0 && first.received === first.length &&
          final?.done && final.status === 200 && final.received === final.length && final.sha256 === expected[name]) {
        failure.classification = 'canceled-after-complete';
      } else errors.push('request: ' + failure.url + ' ' + failure.error);
    }
    const bodies = await page.evaluate(async () => {
      const records = window.__ENGINE_REQUEST_EVIDENCE__ ?? [];
      await Promise.all(records.map(r => r.hashing));
      return records.map(r => ({ token: r.token, url: r.url, status: r.status, length: r.length, received: r.received, done: r.done, sha256: r.sha256 }));
    }).catch(e => { errors.push('runtime evidence unavailable: ' + e.message); return []; });
    for (const name of Object.keys(expected)) if (!bodies.some(r => new URL(r.url).pathname === '/' + name)) errors.push('missing runtime body evidence: ' + name);
    for (const r of bodies) {
      const name = new URL(r.url).pathname.slice(1);
      if (!r.done || r.status !== 200 || !r.length || r.received !== r.length || r.sha256 !== expected[name]) errors.push('runtime body integrity: ' + r.url);
    }
    return { errors, requests, bodies };
  } };
}
