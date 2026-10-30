// Original kit examples only: record a boot run, then build a strict code/data slice from it.
import { cpSync,mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT,loadHeadless } from './headless';
// @ts-expect-error plain ESM
import { buildGame } from '../../tools/build/build.mjs';
export function preparedBrowserSlice(example = 'win32-hello'): { id: string } {
  const index = process.env.BGT_E2E_SLICE_INDEX;
  if (!index) throw new Error('browser slice fixtures must be prepared by Playwright global setup');
  const fixture = JSON.parse(readFileSync(index, 'utf8'))[example];
  if (!fixture?.id) throw new Error(`no prepared browser slice for ${example}`);
  return fixture;
}

export async function prepareSlice(example='win32-hello') {
 const dir=mkdtempSync(join(ROOT,'node_modules/.cache/bgt/slice-'));
 cpSync(join(ROOT,'examples',example,'src'),join(dir,'src'),{recursive:true});
 const cfg=JSON.parse(readFileSync(join(ROOT,'examples',example,'game.json'),'utf8'));
 cfg.id=`record-${example}`;cfg.pipeline.streamModules=true;
 writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));
 const full=buildGame(dir,{quiet:true});
 const h=await loadHeadless(cfg.id);await h.stepAsync(20);
 const snapshot={schema:'game-cask/coverage/1',game:cfg.id,modules:full.pipeline.modules,files:[],code:[...h.host.codeCoverage].map(([address,kind])=>({address,kind}))};
 writeFileSync(join(dir,'coverage.json'),JSON.stringify(snapshot));
 const fixtureDir=join(ROOT,'node_modules/.cache/bgt/pipeline',cfg.id,'fixture');
 for(const m of cfg.pipeline.modules){const name=m.name ?? m.from.split('/').pop();cpSync(join(fixtureDir,cfg.pipeline.fixture.out),join(dir,'input.exe'));m.from='./input.exe';m.name=name;}
 for(const s of cfg.streams ?? []){const name=s.from.split('/').pop();cpSync(join(fixtureDir,name),join(dir,name));s.from='./'+name;}
 delete cfg.pipeline.fixture;
 cfg.id=`slice-${example}`;cfg.slice={coverage:['coverage.json']};
 writeFileSync(join(dir,'game.json'),JSON.stringify(cfg));
 const sliced=buildGame(dir,{quiet:true});
 return {id:cfg.id,full,sliced,dir,snapshot};
}
