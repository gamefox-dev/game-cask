// SPDX-License-Identifier: CC0-1.0. Original fixture, never game assets (K66, Q120).
// Catches: zero-size glBufferData rejected (GL_INVALID_VALUE per orphan), a zero-size orphan that churns native
// stores or adds commands on a real backend, a draw after re-specification that does not render, and a census
// without error codes.
import { test, expect, openGame, assertBackend, step, diagnostics, readPixels } from './fixtures';
test('zero-size glBufferData orphaning: valid, command-free, renders, census with error codes', async ({ page, backendParam }, info) => {
  const lines: string[] = [];
  page.on('console', (m) => { if (/zero (checks|replay|FAIL)/.test(m.text())) lines.push(m.text()); });
  expect(await openGame(page, backendParam, { game: 'x64-gl-zero' })).toBe('ready');
  await assertBackend(page, backendParam, info);
  for (let i = 0; i < 100 && (await diagnostics(page)).lastFrame.drawCalls !== 40; i++) await step(page, 1);
  await step(page, 2);
  expect(lines).toEqual([expect.stringMatching(/zero checks=15 failed=0 pixel=255,0,0,255$/), expect.stringMatching(/zero replay size=0 error=0x0$/)]);
  const before = await diagnostics(page); await step(page, 1); const after = await diagnostics(page);
  const m = after.metrics as Record<string, unknown>, b = before.metrics as Record<string, unknown>;
  expect(Number(m.gl_buffer_zero_stores) - Number(b.gl_buffer_zero_stores)).toBe(80);
  expect(Number(m.gl_buffer_capacity_reused) - Number(b.gl_buffer_capacity_reused)).toBe(80);
  expect(Number(m.gl_errors_raised)).toBe(Number(b.gl_errors_raised));
  expect(m.gl_error_codes).toEqual({ glBufferData: { '0x501': 1 }, glBufferSubData: { '0x501': 1 }, glMapBufferRange: { '0x502': 1 }, glDrawArrays: { '0x502': 2 },
    glCopyBufferSubData: { '0x501': 1 }, glBindBufferRange: { '0x501': 2 }, glBeginTransformFeedback: { '0x502': 1 } });
  expect(after.lastFrame.drawCalls).toBe(40); expect(after.lastFrame.submits).toBe(1);
  expect(after.commandErrors.count).toBe(0); expect(after.errors).toEqual([]);
  const px = await readPixels(page), lb = after.letterbox, at = (Math.floor(lb.y + lb.h / 2) * px.width + Math.floor(lb.x + lb.w / 2)) * 4;
  expect([...px.data.slice(at, at + 4)]).toEqual([255, 0, 0, 255]);
});
