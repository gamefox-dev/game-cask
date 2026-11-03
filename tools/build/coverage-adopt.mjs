// Explicit identity migration only. Never changes code, ranges, counters or module identity.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {coveragePlan,validateCoverageIdentity} from './coverage.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function adoptCoverage(input,manifestFile,out) {
  const source=resolve(input),target=resolve(manifestFile),output=resolve(out);
  const bytes=readFileSync(source),manifestBytes=readFileSync(target),snapshot=JSON.parse(bytes),manifest=JSON.parse(manifestBytes);
  if(manifest.schema!=='bgt-manifest/1'||!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)||!Array.isArray(manifest.pipeline?.modules))throw new Error('coverage-adopt requires a built pipeline manifest with exact game/module identities');
  // strict here means only bypass game-ID equality, never module-set/hash/base validation.
  validateCoverageIdentity(coveragePlan([source],process.cwd()),manifest.id,manifest.pipeline.modules,{strict:true});
  const adopted={...snapshot,game:manifest.id,adoption:{action:'explicit-game-identity-adoption',source_game:snapshot.game ?? null,
    source_file:relative(dirname(output),source).split('\\').join('/'),source_sha256:hash(bytes),
    manifest_file:relative(dirname(output),target).split('\\').join('/'),manifest_sha256:hash(manifestBytes),
    ...(snapshot.adoption?{previous:snapshot.adoption}:{})}};
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(adopted,null,2)+'\n',{flag:'wx'});
  return output;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null;};
    if(args.length!==6||new Set(args.filter((_,i)=>i%2===0)).size!==3||!get('--input')||!get('--manifest')||!get('--out'))throw new Error('usage: node tools/build/coverage-adopt.mjs --input RECORDING --manifest BUILT_MANIFEST --out NEW_RECORDING');
    console.log(adoptCoverage(get('--input'),get('--manifest'),get('--out')));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
