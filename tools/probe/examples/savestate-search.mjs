// Original CC0 sample2d route search and file integration; no game assets.
export default async function(p) {
  await p.key('Enter');await p.step(20);
  const snap=await p.snapshot();let imported;
  try {
    const before=await p.stateHash();await p.exportSnapshot(snap,'route.bgtstate');
    imported=await p.importSnapshot('route.bgtstate');await p.restore(imported);
    const results=await p.search(imported,{variants:[0,2,4],updates:12,
      input:(delay,frame)=>[{type:'key',code:'ArrowRight',down:frame>=delay}],
      score:async p=>(await p.debugState()).player.x,prefix:'timing'});
    if(new Set(results.map(x=>x.score)).size<2)throw new Error('Variants did not affect position');
    if(await p.stateHash()!==before)throw new Error('Search did not restore baseline');
    let caught=false;
    try{await p.search(snap,{variants:[0],updates:1,input:()=>[],score:()=>{throw new Error('intentional score failure');}});}catch(e){caught=String(e).includes('intentional');}
    if(!caught||await p.stateHash()!==before)throw new Error('Failure did not restore baseline');
    p.log({savestateSearch:results,restored:true,failureRestored:true});
  }finally{await imported?.dispose();await snap.dispose();}
}
