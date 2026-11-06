#!/usr/bin/env node
// Produce deterministic Vitest file shards from the repository's real config.
// CI_LIGHT intentionally excludes build-chunks.test.ts because the required scale
// job runs that file together with its native/browser/oracle checks.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declaredExamples } from './test-examples.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const vitest = join(root, 'node_modules/vitest/vitest.mjs');
const config = join(root, 'vitest.config.ts');
const scaleFile = 'tests/unit/build-chunks.test.ts';

// Linux runs42067318101/42092343084 and merged-source run42141326145 measured
// test AND cold example setup costs. Retain the maximum observed cost per file
// and unique example; I16 adds K31/K34 measurements and a third required shard.
// File-only balancing previously hid large, duplicated cold-example setup.
const measuredMs = Object.freeze({"tests/oracle/failures.test.ts":15,"tests/oracle/tooling.test.ts":30633,"tests/unit/abi-layout.test.ts":683,"tests/unit/asyncify-cache-key.test.ts":11,"tests/unit/audio-init.test.ts":14718,"tests/unit/audio-input.test.ts":30081,"tests/unit/build-cache-inputs.test.ts":25175,"tests/unit/build-cache-recovery.test.ts":3279,"tests/unit/build-cache.test.ts":11169,"tests/unit/build-hermetic-time.test.ts":27218,"tests/unit/build-transport.test.ts":12239,"tests/unit/codegen.test.ts":331134,"tests/unit/commands.test.ts":588,"tests/unit/contracts.test.ts":340150,"tests/unit/coverage-buffer.test.ts":267,"tests/unit/coverage-publication.test.ts":2287,"tests/unit/coverage.test.ts":309586,"tests/unit/crt-buffer.test.ts":141535,"tests/unit/crt-fs.test.ts":778568,"tests/unit/crt-read-ahead.test.ts":129,"tests/unit/crt.test.ts":114149,"tests/unit/decode-cooperation.test.ts":10254,"tests/unit/feedback.test.ts":31,"tests/unit/gl-oracle-contract.test.ts":4,"tests/unit/glsl-boundaries.test.ts":20,"tests/unit/glsl-integers.test.ts":9,"tests/unit/glsl-opaque.test.ts":2419,"tests/unit/glsl-regressions.test.ts":129,"tests/unit/glsl.test.ts":1753,"tests/unit/gpu-commands.test.ts":122,"tests/unit/gpu-image.test.ts":2,"tests/unit/gpu-loss-race.test.ts":4,"tests/unit/gpu-pipeline-lifetime.test.ts":11,"tests/unit/gpu-webgpu-shaders.test.ts":28,"tests/unit/handles.test.ts":24815,"tests/unit/host-gcc.test.ts":9,"tests/unit/host.test.ts":738,"tests/unit/import-codegen.test.ts":4143,"tests/unit/import-lowering.test.ts":9647,"tests/unit/incremental-build.test.ts":2334,"tests/unit/integration-i3.test.ts":92709,"tests/unit/interpreter-dispatch-spans.test.ts":12064,"tests/unit/interpreter-exception-spans.test.ts":32254,"tests/unit/interpreter-import-spans.test.ts":5287,"tests/unit/jspi-only-build.test.ts":1303,"tests/unit/kit-tools.test.ts":4616,"tests/unit/lift-registry.test.ts":6,"tests/unit/native-address-regressions.test.ts":44574,"tests/unit/native-alignment.test.ts":31225,"tests/unit/native-calls.test.ts":89166,"tests/unit/native-forms.test.ts":770002,"tests/unit/native-seh.test.ts":100709,"tests/unit/oracle-startup.test.ts":6,"tests/unit/per-test-tool.test.ts":552,"tests/unit/phase0-tools.test.ts":6594,"tests/unit/pi-bridge.test.ts":5700,"tests/unit/pi-harness.test.ts":36210,"tests/unit/pi-robustness.test.ts":26848,"tests/unit/privacy-scan.test.ts":13743,"tests/unit/probe-server.test.ts":1272,"tests/unit/renderer-recording.test.ts":4,"tests/unit/runtime-recording-failure.test.ts":3,"tests/unit/sample.test.ts":229,"tests/unit/slice-policy.test.ts":122,"tests/unit/strings.test.ts":11450,"tests/unit/sysdlls-host.test.ts":423,"tests/unit/sysdlls.test.ts":16961,"tests/unit/test-build-selection.test.ts":977,"tests/unit/tools.test.ts":417,"tests/unit/visual-availability.test.ts":23,"tests/unit/wasm-names.test.ts":6,"tests/unit/webgpu-availability.test.ts":53,"tests/unit/webgpu-probe.test.ts":47,"tests/unit/win32-profile.test.ts":509,"tests/unit/x64-gl-capacity.test.ts":1070,"tests/unit/x64-gl-default-vao.test.ts":124,"tests/unit/x64-gl-fbo.test.ts":300,"tests/unit/x64-gl-feedback.test.ts":1840,"tests/unit/x64-gl-ranges.test.ts":7726,"tests/unit/x64-gl.test.ts":30629,"tests/unit/x64-semantics.test.ts":2100,"tests/unit/x64.test.ts":46330,"tests/unit/x86-metadata.test.ts":1182,"tests/unit/x86.test.ts":20763,"tests/unit/x87.test.ts":15054,"tests/unit/yield.test.ts":518,"tests/unit/ci-unit-shards.test.ts":682,"tests/unit/coverage-snapshot.test.ts":6,"tests/unit/execution-metrics.test.ts":767,"tests/unit/gl-scale-memory.test.ts":6351,"tests/unit/glsl-review.test.ts":56,"tests/unit/gpu-continuation.test.ts":82,"tests/unit/gpu-outputs.test.ts":14,"tests/unit/guest-progress.test.ts":7,"tests/unit/host-memory.test.ts":31414,"tests/unit/import-leaves.test.ts":3,"tests/unit/interpreter-spans.test.ts":2260,"tests/unit/lift-dispatch.test.ts":13849,"tests/unit/native-alignment-fault.test.ts":7728,"tests/unit/native-examples.test.ts":5,"tests/unit/range-files.test.ts":15099,"tests/unit/runtime-recording.test.ts":3,"tests/unit/slice.test.ts":68943,"tests/unit/threads.test.ts":29571,"tests/unit/wasm-loader.test.ts":61,"tests/unit/x64-gl-blit.test.ts":1772,"tests/unit/x64-gl-integer.test.ts":1875,"tests/unit/x64-glsl.test.ts":18350,"tests/unit/asyncify-boundaries.test.ts":75220,"tests/unit/build-lock-transport.test.ts":1326,"tests/unit/coverage-identity.test.ts":156,"tests/unit/gl-frontend-memory.test.ts":20806,"tests/unit/gpu-buffer-handles.test.ts":430,"tests/unit/gpu-texture.test.ts":6,"tests/unit/heap.test.ts":261284,"tests/unit/import-strings.test.ts":3664,"tests/unit/metrics-capacity.test.ts":1125,"tests/unit/partitioned-pipeline.test.ts":139852,"tests/unit/suspension-scale.test.ts":7419,"tests/unit/webgpu-startup.test.ts":46,"tests/unit/x64-gl-current.test.ts":1821,"tests/unit/compiler-transport.test.ts":11271,"tests/unit/guest-accounting.test.ts":47560,"tests/unit/scheduler-accounting.test.ts":23735,"tests/unit/instruction-accounting.test.ts":6,"tests/unit/lifted-header-cache.test.ts":26809,"tests/unit/glsl-builtins.test.ts":173,"tests/unit/accounting-precision.test.ts":957,"tests/unit/requests.test.ts":83,"tests/unit/x64-gl-scale.test.ts":1270,"tests/unit/retirement.test.ts":140227});
const exampleMs = Object.freeze({"bench":100,"gpu-readback":100,"gpu-scenes":100,"sample2d":100,"win32-conformance":143873.134,"win32-hello":49015.699,"x64-audio":61828.338,"x64-audio-init":48130.253,"x64-basics":18183.211,"x64-contracts":96520.347,"x64-cpp":141630.965,"x64-cpprt":525884.702,"x64-crt":53613.486,"x64-gl":27203.1,"x64-gl-blit":26840.376,"x64-gl-capacity":32624.719,"x64-gl-current":33448.629,"x64-gl-default-vao":29573.566,"x64-gl-fbo":44638.365,"x64-gl-feedback":34771.559,"x64-gl-integer":32672.175,"x64-gl-ranges":30526.869,"x64-gl-scale":28881.447,"x64-glsl":42257.793,"x64-gui":21619.714,"x64-handles":38673.143,"x64-heap":37190.054,"x64-imports":17556.119,"x64-input":21942.382,"x64-memory":39503.836,"x64-smoke":45403.727,"x64-sysdlls":48128.707,"x64-threads":30975.572,"x64-tls":22287.342,"x86-handles":415646.985,"x86-heap":503078.552,"x86-threads":17575.26});
const defaultMs = 1000;

function list(ciLight) {
  const env = { ...process.env };
  if (ciLight) env.BGT_CI_LIGHT = '1';
  else delete env.BGT_CI_LIGHT;
  const out = execFileSync(process.execPath, [vitest, 'list', '--config', config, '--filesOnly', '--json'], { cwd: root, env, encoding: 'utf8' });
  // Consume the complete configured inventory, not a directory/extension subset.
  // Filtering both full and light lists could hide the very same omitted file
  // from the union check. Opt-in benchmark configs remain outside this config.
  const rows = JSON.parse(out);
  if (!Array.isArray(rows)) throw new Error('Invalid Vitest file inventory');
  return [...new Set(rows.map((row) => {
    if (typeof row?.file !== 'string' || !row.file) throw new Error('Invalid Vitest file inventory entry');
    const file = relative(root, resolve(root, row.file));
    if (!file || file === '..' || file.startsWith('..' + sep) || isAbsolute(file) || /[\r\n]/.test(file)) {
      throw new Error('Vitest inventory file outside repository or not line-safe: ' + row.file);
    }
    return file.split(sep).join('/');
  }))].sort();
}

const all = list(false);
const ci = list(true);
const excluded = all.filter((file) => !ci.includes(file));
const covered = [...ci, scaleFile].sort();
if (!existsSync(join(root, scaleFile)) || excluded.length !== 1 || excluded[0] !== scaleFile || covered.join('\n') !== all.join('\n')) {
  throw new Error('CI unit partition drift: shards plus scale must equal full npm test file set, all=' + JSON.stringify(all) + ', ci=' + JSON.stringify(ci) + ', excluded=' + JSON.stringify(excluded));
}

function weightedShards(files, count) {
  const shards = Array.from({ length: count }, (_, index) => ({ index, total: 0, files: [], examples: new Set() }));
  const examples = new Map(files.map(file => [file, declaredExamples(join(root, file), root)]));
  const testCost = file => measuredMs[file] ?? defaultMs;
  const setupCost = (file, seen = new Set()) => examples.get(file).filter(id => !seen.has(id)).reduce((sum, id) => sum + (exampleMs[id] ?? defaultMs), 0);
  // LPT includes cold setup. Penalize introducing a new example twice when
  // placing a file: reuse expensive shared prebuilds instead of duplicating them
  // just to save a few milliseconds of test-only imbalance. Recorded load still
  // counts the actual setup only once per shard. Whole files/coverage unchanged.
  [...files].sort((a, b) => testCost(b) + setupCost(b) - testCost(a) - setupCost(a) || a.localeCompare(b)).forEach((file) => {
    const cost = shard => shard.total + testCost(file) + 2 * setupCost(file, shard.examples);
    const shard = shards.reduce((best, candidate) => cost(candidate) < cost(best) ? candidate : best);
    shard.total += testCost(file) + setupCost(file, shard.examples);
    shard.files.push(file);
    for (const id of examples.get(file)) shard.examples.add(id);
  });
  return shards.map(({ files: shard }) => shard.sort());
}

const shardArg = process.argv[2];
if (!shardArg) {
  process.stdout.write(ci.join('\n') + '\n');
  process.exit(0);
}
const match = /^(\d+)\/(\d+)$/.exec(shardArg);
if (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2]) || Number(match[2]) < 1) throw new Error('usage: ci-unit-shards.mjs SHARD/COUNT');
const index = Number(match[1]);
const count = Number(match[2]);
const shards = weightedShards(ci, count);
const union = shards.flat().sort();
if (union.join('\n') !== ci.join('\n')) throw new Error('CI unit shards do not cover the configured Vitest files exactly');
process.stdout.write(shards[index - 1].join('\n') + '\n');
