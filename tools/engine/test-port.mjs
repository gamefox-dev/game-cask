// Preserve the existing test invocation for non-engine ports.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync('port/game.json', 'utf8'));
execFileSync('npm', ['run', 'build:port'], { stdio: 'inherit' });
execFileSync('npx', ['playwright', 'test', ...(cfg.engineProfile ? ['--project=port-engine'] : ['--project=port-webgl2', '--project=port-webgpu'])], {
  stdio: 'inherit', env: { ...process.env, BGT_PORT_TESTS: '1', BGT_RESULTS_PREFIX: 'e2e-port' },
});
