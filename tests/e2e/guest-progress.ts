import type { Page } from '@playwright/test';
import type { BGTTestAPI } from '../../bgt/runtime/testapi';

/** Drive the same deterministic updates as step(page, 1), stopping on the first matching log.
 * Keep polling in the browser: exporting full diagnostics over Playwright on every deferred
 * FILE read is far more expensive than the guest work. step() already settles pending I/O,
 * renders and waits for GPU completion; no wall-clock sleep is needed for guest progress.
 * Both the update bound and the caller's Playwright deadline still catch real hangs.
 */
export async function stepUntilLog(page: Page, message: string, maxFrames: number) {
  return page.evaluate(async ({ message, maxFrames }) => {
    const api = (window as unknown as { __BGT_TEST__: BGTTestAPI }).__BGT_TEST__;
    const started = performance.now();
    let stepMs = 0, diagnosticsMs = 0;
    for (let frames = 1; frames <= maxFrames; frames++) {
      let t = performance.now();
      await api.step(1);
      stepMs += performance.now() - t;
      t = performance.now();
      const d = api.diagnostics();
      diagnosticsMs += performance.now() - t;
      if (d.logs.some(l => l.message.includes(message)))
        return { frames, stepMs, diagnosticsMs, elapsedMs: performance.now() - started };
      if (api.failed() || d.errors.length)
        throw new Error(`Guest failed before "${message}": ${JSON.stringify(d)}`);
    }
    throw new Error(`Guest did not log "${message}" within ${maxFrames} updates: ${JSON.stringify(api.diagnostics())}`);
  }, { message, maxFrames });
}
