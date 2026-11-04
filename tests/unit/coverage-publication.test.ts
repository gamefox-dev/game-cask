// @bgt-examples: none
// Real Playwright teardown with synthetic CC0 coverage; no browser/game required.
import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readdirSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {ROOT} from '../support/headless';
it('publishes only final passing port tests, never collector failures or later fixture teardown failures',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bgt-publication-'));
 try{
  // Preserve ESM loading for fixtures that import the plain .mjs publisher too.
  writeFileSync(join(dir,'package.json'),JSON.stringify({type:'module'}));
  const reporter=join(ROOT,'tests/e2e/coverage-evidence-reporter.ts');
  writeFileSync(join(dir,'playwright.config.ts'),`export default {testDir:'.',testMatch:'publication.spec.ts',workers:1,retries:0,reporter:[['list'],[`+JSON.stringify(reporter)+`,{root:`+JSON.stringify(dir)+`}]],projects:[{name:'port-cc0'}]};`);
  writeFileSync(join(dir,'publication.spec.ts'),`
import {test as base} from `+JSON.stringify(join(ROOT,'tests/e2e/fixtures.ts'))+`;
const test=base.extend({
 page:async({},use,testInfo)=>{
  const handlers={};await use({on:(name,fn)=>{handlers[name]=fn;},evaluate:async()=>({schema:'game-cask/coverage/1',game:'cc0-'+testInfo.title,modules:[],code:[],files:[],metrics:{errors:0}}),emit:()=>handlers.console({type:()=> 'error',text:()=> 'unexpected synthetic error'})});
 },
 lateFailure:[async({},use,testInfo)=>{await use();if(testInfo.title==='teardown')throw Error('late synthetic fixture failure');},{auto:true}]
});
test('collector',async({page,collector})=>{page.emit();});
test('teardown',async({collector})=>{});
test('pass',async({collector})=>{});
`);
  const result=spawnSync(process.execPath,[join(ROOT,'node_modules/@playwright/test/cli.js'),'test','--config',join(dir,'playwright.config.ts')],{cwd:dir,encoding:'utf8',timeout:60000});
  mkdirSync(join(ROOT,'reports/k21'),{recursive:true});
  writeFileSync(join(ROOT,'reports/k21/publication-child.log'),result.stdout+result.stderr);
  expect(result.stdout+result.stderr).not.toMatch(/Error:.*(?:Cannot find|not find|must use|First argument)/);
  expect(result.status,result.stdout+result.stderr).toBe(1); // exactly the deliberate failures remain failures
  expect(result.stdout+result.stderr).toContain('2 failed');
  expect(result.stdout+result.stderr).toContain('1 passed');
  const inbox=join(dir,'reports/coverage-inbox');
  expect(readdirSync(inbox)).toEqual(['cc0-pass']);
  const files=readdirSync(join(inbox,'cc0-pass'));expect(files).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(inbox,'cc0-pass',files[0]),'utf8')).game).toBe('cc0-pass');
 }finally{rmSync(dir,{recursive:true,force:true});}
},90000);
