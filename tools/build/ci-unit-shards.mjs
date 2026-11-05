#!/usr/bin/env node
// Produce deterministic Vitest file shards from the repository's real config.
// CI_LIGHT intentionally excludes build-chunks.test.ts because the required scale
// job runs that file together with its native/browser/oracle checks.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declaredExamples } from './test-examples.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const vitest = join(root, 'node_modules/vitest/vitest.mjs');
const config = join(root, 'vitest.config.ts');
const scaleFile = 'tests/unit/build-chunks.test.ts';

// Linux run42067318101 measured test AND cold example setup costs. File-only
// balancing put 31.5min setup in shard1 versus 8min in shard2, despite similar
// test weights. Include each shard's unique declared examples in its load.
const measuredMs = Object.freeze({"tests/oracle/failures.test.ts":15,"tests/oracle/tooling.test.ts":30720,"tests/unit/abi-layout.test.ts":611,"tests/unit/asyncify-cache-key.test.ts":10,"tests/unit/audio-init.test.ts":14718,"tests/unit/audio-input.test.ts":30763,"tests/unit/build-cache-inputs.test.ts":25175,"tests/unit/build-cache-recovery.test.ts":3072,"tests/unit/build-cache.test.ts":11169,"tests/unit/build-hermetic-time.test.ts":24017,"tests/unit/build-transport.test.ts":11284,"tests/unit/codegen.test.ts":331134,"tests/unit/commands.test.ts":403,"tests/unit/contracts.test.ts":340150,"tests/unit/coverage-buffer.test.ts":233,"tests/unit/coverage-publication.test.ts":2287,"tests/unit/coverage.test.ts":310582,"tests/unit/crt-buffer.test.ts":152828,"tests/unit/crt-fs.test.ts":892404,"tests/unit/crt-read-ahead.test.ts":129,"tests/unit/crt.test.ts":101965,"tests/unit/decode-cooperation.test.ts":3844,"tests/unit/feedback.test.ts":28,"tests/unit/gl-oracle-contract.test.ts":4,"tests/unit/glsl-boundaries.test.ts":11,"tests/unit/glsl-integers.test.ts":9,"tests/unit/glsl-opaque.test.ts":2081,"tests/unit/glsl-regressions.test.ts":82,"tests/unit/glsl.test.ts":1593,"tests/unit/gpu-commands.test.ts":128,"tests/unit/gpu-image.test.ts":2,"tests/unit/gpu-loss-race.test.ts":4,"tests/unit/gpu-pipeline-lifetime.test.ts":11,"tests/unit/gpu-webgpu-shaders.test.ts":28,"tests/unit/handles.test.ts":19493,"tests/unit/host-gcc.test.ts":9,"tests/unit/host.test.ts":641,"tests/unit/import-codegen.test.ts":4353,"tests/unit/import-lowering.test.ts":9647,"tests/unit/incremental-build.test.ts":1573,"tests/unit/integration-i3.test.ts":79152,"tests/unit/interpreter-dispatch-spans.test.ts":12064,"tests/unit/interpreter-exception-spans.test.ts":29026,"tests/unit/interpreter-import-spans.test.ts":5287,"tests/unit/jspi-only-build.test.ts":1303,"tests/unit/kit-tools.test.ts":3669,"tests/unit/lift-registry.test.ts":7,"tests/unit/native-address-regressions.test.ts":44574,"tests/unit/native-alignment.test.ts":30533,"tests/unit/native-calls.test.ts":59819,"tests/unit/native-forms.test.ts":665305,"tests/unit/native-seh.test.ts":89642,"tests/unit/oracle-startup.test.ts":4,"tests/unit/per-test-tool.test.ts":544,"tests/unit/phase0-tools.test.ts":6898,"tests/unit/pi-bridge.test.ts":5797,"tests/unit/pi-harness.test.ts":36210,"tests/unit/pi-robustness.test.ts":26813,"tests/unit/privacy-scan.test.ts":13710,"tests/unit/probe-server.test.ts":1272,"tests/unit/renderer-recording.test.ts":4,"tests/unit/runtime-recording-failure.test.ts":2,"tests/unit/sample.test.ts":179,"tests/unit/slice-policy.test.ts":122,"tests/unit/strings.test.ts":10800,"tests/unit/sysdlls-host.test.ts":301,"tests/unit/sysdlls.test.ts":15664,"tests/unit/test-build-selection.test.ts":630,"tests/unit/tools.test.ts":146,"tests/unit/visual-availability.test.ts":18,"tests/unit/wasm-names.test.ts":5,"tests/unit/webgpu-availability.test.ts":54,"tests/unit/webgpu-probe.test.ts":47,"tests/unit/win32-profile.test.ts":447,"tests/unit/x64-gl-capacity.test.ts":1065,"tests/unit/x64-gl-default-vao.test.ts":124,"tests/unit/x64-gl-fbo.test.ts":322,"tests/unit/x64-gl-feedback.test.ts":1840,"tests/unit/x64-gl-ranges.test.ts":5283,"tests/unit/x64-gl.test.ts":30629,"tests/unit/x64-semantics.test.ts":2100,"tests/unit/x64.test.ts":36680,"tests/unit/x86-metadata.test.ts":1182,"tests/unit/x86.test.ts":18115,"tests/unit/x87.test.ts":15054,"tests/unit/yield.test.ts":518,"tests/unit/ci-unit-shards.test.ts":486,"tests/unit/coverage-snapshot.test.ts":6,"tests/unit/execution-metrics.test.ts":767,"tests/unit/gl-scale-memory.test.ts":6351,"tests/unit/glsl-review.test.ts":56,"tests/unit/gpu-continuation.test.ts":85,"tests/unit/gpu-outputs.test.ts":14,"tests/unit/guest-progress.test.ts":7,"tests/unit/host-memory.test.ts":31414,"tests/unit/import-leaves.test.ts":3,"tests/unit/interpreter-spans.test.ts":2247,"tests/unit/lift-dispatch.test.ts":13849,"tests/unit/native-alignment-fault.test.ts":7728,"tests/unit/native-examples.test.ts":5,"tests/unit/range-files.test.ts":15099,"tests/unit/runtime-recording.test.ts":3,"tests/unit/slice.test.ts":68872,"tests/unit/threads.test.ts":29571,"tests/unit/wasm-loader.test.ts":61,"tests/unit/x64-gl-blit.test.ts":1772,"tests/unit/x64-gl-integer.test.ts":1850,"tests/unit/x64-glsl.test.ts":18515});
const exampleMs = Object.freeze({"bench":100,"gpu-readback":100,"gpu-scenes":100,"sample2d":100,"win32-conformance":102594.599,"win32-hello":49015.699,"x64-audio":60789.1,"x64-audio-init":48130.253,"x64-basics":18183.211,"x64-contracts":96520.347,"x64-cpp":133323.489,"x64-cpprt":291864.704,"x64-crt":43646.418,"x64-gl":27203.1,"x64-gl-blit":26840.376,"x64-gl-capacity":27245.698,"x64-gl-current":28336.637,"x64-gl-default-vao":29573.566,"x64-gl-fbo":44638.365,"x64-gl-feedback":29636.951,"x64-gl-integer":32672.175,"x64-gl-ranges":30526.869,"x64-gl-scale":28881.447,"x64-glsl":36122.515,"x64-gui":21619.714,"x64-handles":38673.143,"x64-heap":28914.695,"x64-imports":16180.063,"x64-input":21942.382,"x64-memory":32456.076,"x64-smoke":34457.546,"x64-sysdlls":36614.014,"x64-threads":24569.38,"x64-tls":22287.342,"x86-handles":415646.985,"x86-heap":404794.879,"x86-threads":15651.69});
const defaultMs = 1000;

function list(ciLight) {
  const env = { ...process.env };
  if (ciLight) env.BGT_CI_LIGHT = '1';
  else delete env.BGT_CI_LIGHT;
  const out = execFileSync(process.execPath, [vitest, 'list', '--config', config, '--filesOnly'], { cwd: root, env, encoding: 'utf8' });
  return [...new Set(out.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^tests\/(unit|oracle)\//.test(line) && line.endsWith('.test.ts')))].sort();
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
