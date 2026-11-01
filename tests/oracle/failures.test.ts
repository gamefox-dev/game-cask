// LANE-K4b: setup/startup failures must not become a successful zero-frame comparison.
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '', calls: 0, fail: '', failAt: 0 }));
vi.mock('../support/headless', () => ({
  get ROOT() { return state.root; },
  loadHeadless: async () => {
    const call = ++state.calls;
    if (state.fail === `load-${call}`) throw new Error('cannot load fixture');
    let frame = 0;
    return {
      host: { logicalWidth: 320, logicalHeight: 200, commandErrorCount: 0,
        stateHash: () => String(frame), metrics: () => ({ frames: frame }) },
      stepAsync: async () => { if (state.fail === `step-${call}` && frame === state.failAt) throw new Error('startup abort'); frame++; },
      pointer: () => {}, key: () => {},
    };
  },
}));
import { oracle } from './oracle';

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'bgt-oracle-failure-'));
  state.calls = 0; state.fail = ''; state.failAt = 0;
  mkdirSync(join(state.root, 'reports'));
  writeFileSync(join(state.root, 'reports/oracle-fixture.json'), JSON.stringify({ identical: true, frames: 300 }));
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));

for (const [fault, stage] of [
  ['load-1', 'preflight-load'], ['step-1', 'preflight-step'],
  ['load-2', 'lifted-load'], ['load-3', 'interpreted-load'],
  ['step-2', 'lifted-startup'], ['step-3', 'interpreted-startup'],
]) it(`writes a fresh failure report for ${stage}`, async () => {
  state.fail = fault;
  const report = await oracle('fixture', 300, []);
  expect(report).toMatchObject({ frames: 0, comparedFrames: 0, requestedFrames: 300, identical: false, failureStage: stage, exitStatus: 1 });
  expect(report.error).toMatch(/cannot load fixture|startup abort/);
  if (stage.startsWith('preflight')) expect(report.hashes).toEqual({ lifted: null, interpreted: null });
  expect(JSON.parse(readFileSync(join(state.root, 'reports/oracle-fixture.json'), 'utf8'))).toEqual(report);
});

it('counts only completed pairs when one run aborts after two measured frames', async () => {
  state.fail = 'step-2'; state.failAt = 2;
  const report = await oracle('fixture', 300, []);
  expect(report).toMatchObject({ frames: 2, comparedFrames: 2, requestedFrames: 300, identical: false,
    failureStage: 'lifted-execution', firstDivergence: 2, exitStatus: 1 });
});

it('counts genuine completed comparisons and clears failure metadata on success', async () => {
  const report = await oracle('fixture', 300, []);
  expect(report).toMatchObject({ frames: 300, comparedFrames: 300, requestedFrames: 300, identical: true,
    failureStage: null, error: null, firstDivergence: null, exitStatus: 0 });
});

it('rejects zero requested frames rather than manufacturing an identical zero-frame result', async () => {
  expect(await oracle('fixture', 0, [])).toMatchObject({ comparedFrames: 0, identical: false, failureStage: 'setup', exitStatus: 1 });
});
