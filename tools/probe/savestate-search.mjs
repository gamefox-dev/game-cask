// Test-only search orchestration, separated so error/finally semantics have a fast regression.
export async function searchSavestate(p,snapshot,{variants,updates,input,score,prefix='variant'}) {
  if(!Number.isSafeInteger(updates)||updates<1)throw new Error('search updates must be positive');
  const results=[];
  try {
    for(let index=0;index<variants.length;index++) {
      const variant=variants[index];await p.restore(snapshot);
      for(let update=0;update<updates;update++) {
        const events=await input(variant,update,p);if(events?.length)await p.input(events);
        await p.step(1);
        const d=await p.diagnostics();if(d.failed||d.outsideSlice||d.errors.length)throw new Error('search branch failed at update '+update);
      }
      const value=await score(p,variant);
      if(typeof value!=='number'||!Number.isFinite(value))throw new Error('search score must be a finite scalar');
      results.push({variant,score:value,screenshot:await p.screenshot(prefix+'-'+index)});
    }
  }finally{await p.restore(snapshot);}
  return results;
}
