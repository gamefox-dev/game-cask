// @bgt-examples: none
// Sharding must retain both CI projects, isolate reports, and fail the required
// gate on a failed/cancelled/skipped matrix aggregate rather than hiding a shard.
import {it, expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from '../support/headless';

const workflow=readFileSync(join(ROOT,'.github/workflows/ci.yml'),'utf8');
const e2e=workflow.slice(workflow.indexOf('\n  e2e:'),workflow.indexOf('\n  scale:'));
const gate=workflow.slice(workflow.indexOf('\n  gate:'),workflow.indexOf('\n  webgpu:'));

it('runs all three Playwright shards without cancelling siblings or changing coverage',()=>{
  expect(e2e).toMatch(/fail-fast: false/);
  expect(e2e).toMatch(/shard: \[1, 2, 3\]/);
  expect(e2e).not.toMatch(/continue-on-error|max-parallel/);
  expect(e2e).toContain('run: npm run build:examples');
  const command=e2e.split('\n').find(line=>line.includes('npx playwright test'))?.trim();
  expect(command).toBe('run: BGT_SOFTWARE_RENDERER=1 BGT_RESULTS_PREFIX=e2e-shard-${{ matrix.shard }} npx playwright test --project=chromium-webgl2 --project=chromium-auto --shard=${{ matrix.shard }}/3');
});

it('uploads uniquely prefixed JSON, HTML and failure evidence even after a shard failure',()=>{
  expect(e2e).toContain('- if: always()\n        uses: actions/upload-artifact@v4');
  expect(e2e).toContain('name: e2e-report-shard-${{ matrix.shard }}');
  for(const suffix of ['results.json','html/','artifacts/']){
    expect(e2e).toContain('reports/e2e-shard-${{ matrix.shard }}-'+suffix);
  }
});

it('requires the complete e2e matrix aggregate and rejects every non-success result',()=>{
  expect(gate).toContain('if: always()');
  expect(gate).toMatch(/needs: \[.*\be2e\b/);
  expect(gate).toContain('E2E: ${{ needs.e2e.result }}');
  const script=gate.split('        run: |\n')[1].trim();
  const env={...process.env,LINT_JS:'success',LINT_NATIVE:'success',LINT_EXAMPLES:'success',UNIT1:'success',UNIT2:'success',UNIT3:'success',SCALE:'success'};
  for(const E2E of ['success','failure','cancelled','skipped','']){
    const result=spawnSync('bash',['-e','-c',script],{env:{...env,E2E},encoding:'utf8'});
    expect(result.status,E2E).toBe(E2E==='success'?0:1);
  }
});
