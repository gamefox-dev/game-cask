// Integration boundary: neither entry metrics nor FILE accounting may disappear on merge.
import { expect, it } from 'vitest';
import { BGTRuntime } from '../../bgt/runtime/runtime';
import { Vfs } from '../../bgt/runtime/vfs';

it('coverage snapshots retain execution evidence and separate consumed, observed and speculative FILE bytes', () => {
  const vfs = new Vfs();
  vfs.add('input', new Uint8Array(3 * 65536));
  const file = vfs.openFile('input');
  vfs.consume(file, 0, 3);
  vfs.consume(file, 65536, 1, true);
  vfs.readAhead(file, 131072, 16384);
  vfs.readAheadRequests++;
  // Sentinel execution evidence tests serialization, not the dispatcher (coverage.test.ts).
  const execution = { interp_insns: 12, interp_code_entries: 6, interp_functions: 2, interp_unowned_entries: 0 };
  const runtime = {
    vfs, manifest: { id: 'snapshot-probe', pipeline: { modules: [] } },
    host: { codeCoverage: new Map([[200, 2], [100, 3]]), codeCoverageDropped: 7, frameIndex: 9, metrics: (): unknown => execution },
    rangeFiles: null, errors: [], sliceEvents: 0, firstFrameMs: null, frameTimes: [],
    diagnostics: () => ({ timing: {} }),
  };
  const snapshot = BGTRuntime.prototype.coverageSnapshot.call(runtime as unknown as BGTRuntime);
  expect(snapshot.code).toEqual([{ address: 100, kind: 3 }, { address: 200, kind: 2 }]);
  expect(snapshot.files).toEqual([{ path: 'input', offset: 0, length: 65536 }, { path: 'input', offset: 65536, length: 65536 }]);
  expect(snapshot.readAhead).toEqual([{ path: 'input', offset: 131072, length: 65536 }]);
  expect(snapshot.metrics).toMatchObject({
    execution, code_entries_dropped: 7, frame: 9,
    crtConsumedBytes: 3, crtObservedBytes: 1, crtReadAheadBytes: 16384, crtReadAheadRequests: 1,
  });
  runtime.host.metrics = () => null;
  expect(BGTRuntime.prototype.coverageSnapshot.call(runtime as unknown as BGTRuntime).metrics.execution).toBeNull();
});
