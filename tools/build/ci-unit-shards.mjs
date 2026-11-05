#!/usr/bin/env node
// Produce deterministic Vitest file shards from the repository's real config.
// CI_LIGHT intentionally excludes build-chunks.test.ts because the required scale
// job runs that file together with its native/browser/oracle checks.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const vitest = join(root, 'node_modules/vitest/vitest.mjs');
const config = join(root, 'vitest.config.ts');
const scaleFile = 'tests/unit/build-chunks.test.ts';

// Measured per-file test times from the first Linux CI attempt (run 42039181319).
// Keep the measured values rather than round-robin file count: a few native and
// pipeline fixtures dominate a shard. Unknown/new files get a small deterministic
// weight and will be re-measured on the next CI repair.
const measuredMs = Object.freeze({"tests/oracle/failures.test.ts":10,"tests/oracle/tooling.test.ts":31195,"tests/unit/abi-layout.test.ts":382,"tests/unit/asyncify-cache-key.test.ts":6,"tests/unit/audio-init.test.ts":15021,"tests/unit/audio-input.test.ts":19528,"tests/unit/build-cache-inputs.test.ts":28693,"tests/unit/build-cache-recovery.test.ts":2335,"tests/unit/build-cache.test.ts":12461,"tests/unit/build-hermetic-time.test.ts":19527,"tests/unit/build-transport.test.ts":10341,"tests/unit/codegen.test.ts":337519,"tests/unit/commands.test.ts":257,"tests/unit/contracts.test.ts":341940,"tests/unit/coverage-buffer.test.ts":233,"tests/unit/coverage-publication.test.ts":1397,"tests/unit/coverage.test.ts":195366,"tests/unit/crt-buffer.test.ts":92088,"tests/unit/crt-fs.test.ts":820632,"tests/unit/crt-read-ahead.test.ts":86,"tests/unit/crt.test.ts":101105,"tests/unit/decode-cooperation.test.ts":2381,"tests/unit/feedback.test.ts":17,"tests/unit/gl-oracle-contract.test.ts":4,"tests/unit/glsl-boundaries.test.ts":11,"tests/unit/glsl-integers.test.ts":9,"tests/unit/glsl-opaque.test.ts":2141,"tests/unit/glsl-regressions.test.ts":82,"tests/unit/glsl.test.ts":1228,"tests/unit/gpu-commands.test.ts":86,"tests/unit/gpu-image.test.ts":2,"tests/unit/gpu-loss-race.test.ts":4,"tests/unit/gpu-pipeline-lifetime.test.ts":9,"tests/unit/gpu-webgpu-shaders.test.ts":18,"tests/unit/handles.test.ts":19493,"tests/unit/host-gcc.test.ts":9,"tests/unit/host.test.ts":641,"tests/unit/import-codegen.test.ts":2626,"tests/unit/import-lowering.test.ts":9647,"tests/unit/incremental-build.test.ts":1573,"tests/unit/integration-i3.test.ts":82053,"tests/unit/interpreter-dispatch-spans.test.ts":12064,"tests/unit/interpreter-exception-spans.test.ts":23283,"tests/unit/interpreter-import-spans.test.ts":2894,"tests/unit/jspi-only-build.test.ts":874,"tests/unit/kit-tools.test.ts":2522,"tests/unit/lift-registry.test.ts":4,"tests/unit/native-address-regressions.test.ts":44574,"tests/unit/native-alignment.test.ts":19229,"tests/unit/native-calls.test.ts":40464,"tests/unit/native-forms.test.ts":427988,"tests/unit/native-seh.test.ts":90175,"tests/unit/oracle-startup.test.ts":4,"tests/unit/per-test-tool.test.ts":431,"tests/unit/phase0-tools.test.ts":6899,"tests/unit/pi-bridge.test.ts":5245,"tests/unit/pi-harness.test.ts":36945,"tests/unit/pi-robustness.test.ts":26036,"tests/unit/privacy-scan.test.ts":13848,"tests/unit/probe-server.test.ts":789,"tests/unit/renderer-recording.test.ts":2,"tests/unit/runtime-recording-failure.test.ts":2,"tests/unit/sample.test.ts":179,"tests/unit/slice-policy.test.ts":83,"tests/unit/strings.test.ts":7607,"tests/unit/sysdlls-host.test.ts":301,"tests/unit/sysdlls.test.ts":15984,"tests/unit/test-build-selection.test.ts":630,"tests/unit/tools.test.ts":116,"tests/unit/visual-availability.test.ts":18,"tests/unit/wasm-names.test.ts":3,"tests/unit/webgpu-availability.test.ts":53,"tests/unit/webgpu-probe.test.ts":43,"tests/unit/win32-profile.test.ts":294,"tests/unit/x64-gl-capacity.test.ts":546,"tests/unit/x64-gl-default-vao.test.ts":78,"tests/unit/x64-gl-fbo.test.ts":327,"tests/unit/x64-gl-feedback.test.ts":1264,"tests/unit/x64-gl-ranges.test.ts":5283,"tests/unit/x64-gl.test.ts":19935,"tests/unit/x64-semantics.test.ts":5379,"tests/unit/x64.test.ts":36680,"tests/unit/x86-metadata.test.ts":1228,"tests/unit/x86.test.ts":11598,"tests/unit/x87.test.ts":15611,"tests/unit/yield.test.ts":518});
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
  const shards = Array.from({ length: count }, (_, index) => ({ index, total: 0, files: [] }));
  // Largest-processing-time first (LPT), with lexical tie breaks. The measured
  // weights affect placement only; each Vitest file remains whole and all files
  // remain covered exactly once.
  [...files].sort((a, b) => (measuredMs[b] ?? defaultMs) - (measuredMs[a] ?? defaultMs) || a.localeCompare(b)).forEach((file) => {
    const shard = shards.reduce((best, candidate) => candidate.total < best.total ? candidate : best);
    shard.files.push(file);
    shard.total += measuredMs[file] ?? defaultMs;
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
