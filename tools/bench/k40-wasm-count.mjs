/* global structuredClone */
// Original CC0-1.0. Adapted from K39; diagnostic only: count ORIGINAL wasm operators, never time this output.
const children=a=>a.filter(Array.isArray), result=a=>a.find(x=>Array.isArray(x)&&x[0]==='result')?.[1]??null;
export function instrumentWat(source,{native=false}={}){
 // Keep quoted data intact; line comments must not swallow the reprinted module's close.
 const tokens=source.match(/"(?:\\.|[^"\\])*"|;;[^\n]*|[()]|[^\s()]+/g).filter(t=>!t.startsWith(';;'));let pos=0;
 function parse(){const t=tokens[pos++];if(t!=='(')return t;const a=[];while(tokens[pos]!==')'){if(pos>=tokens.length)throw Error('unclosed WAT');a.push(parse());}pos++;return a;}
 const mod=parse();if(pos!==tokens.length||mod[0]!=='module')throw Error('bad WAT');
 const funcs=mod.filter(x=>Array.isArray(x)&&x[0]==='func'),rets=new Map(funcs.map(f=>[f[1],result(f)]));
 const types=new Map(mod.filter(x=>Array.isArray(x)&&x[0]==='type').map(x=>[x[1],result(x[2])]));
 for(const x of mod.filter(x=>Array.isArray(x)&&x[0]==='import'))if(x[3]?.[0]==='func')rets.set(x[3][1],result(x[3]));
 const globals=new Map(mod.filter(x=>Array.isArray(x)&&x[0]==='global').map(g=>[g[1],Array.isArray(g[2])?g[2][1]:g[2]]));
 const group=n=>native?'native':/^\$(?:N_|R_|F_)/.test(n)?'lifted':/^\$(?:x86_coverage_entry|x86_coverage_lifted|x86_native_enter|x86_native_resume|x86_find_lifted)$/.test(n)?n.slice(1):'runtime';
 const hot=new Set(['$N_010011a0','$N_010015b0','$N_01001170','$N_010014f0','$N_01001580','$N_010010d6','$N_01001104']);
 let flatExpr=null;
 function findFlat(a){if(!Array.isArray(a))return false;if(a[0]==='i32.load'&&children(a)[0]?.[0]==='i32.const'){flatExpr=structuredClone(a);return true;}return children(a).some(findFlat);}
 if(!native){const map=funcs.find(f=>f[1]==='$x86_map');if(!map||!findFlat(map))throw Error('cannot identify x86_flat load');}
 const labels=[],counters=new Map(),sites=[];
 const counter=label=>{if(!counters.has(label)){counters.set(label,'$k39_c'+labels.length);labels.push(label);}const n=counters.get(label);return ['global.set',n,['i64.add',['global.get',n],['i64.const','1']]];};
 const wrap=(v,t,cs)=>['block',...(t?[['result',t]]:[]),...cs,v];
 for(const f of funcs){
  const g=group(f[1]),h=hot.has(f[1])?'hot.'+f[1].slice(1):null;
  const count=cat=>[counter(g+'.'+cat),...(h?[counter(h+'.'+cat)]:[])];
  const locals=new Map(f.filter(x=>Array.isArray(x)&&['param','local'].includes(x[0])).map(x=>[x[1],x[2]]));
  function infer(a){
   const op=a[0];if(op==='local.get'||op==='local.tee')return locals.get(a[1]);if(op==='global.get')return globals.get(a[1]);
   if(op==='call')return rets.get(a[1]);if(op==='call_indirect')return types.get(a.find(x=>Array.isArray(x)&&x[0]==='type')?.[1]);
   if(op==='select')return infer(children(a)[0]);if(['block','loop','if'].includes(op))return result(a);
   if(/^(i32|i64|f32|f64)\./.test(op)){if(/\.store/.test(op))return null;if(/\.(eq|ne|lt|gt|le|ge|eqz)(_|$)/.test(op))return 'i32';return op.split('.')[0];}
   if(op==='memory.size'||op==='memory.grow')return 'i32';return null;
  }
  // Conservative backwards slice through local definitions. Direct address-tree arithmetic is
  // certain; this additional set includes shared/multiply-defined locals, NOT a disjoint charge.
  const defs=new Map(),addressNodes=new Set(),directNodes=new Set();
  function scan(a){if(!Array.isArray(a))return;if(['local.set','local.tee'].includes(a[0])){if(!defs.has(a[1]))defs.set(a[1],[]);defs.get(a[1]).push(children(a)[0]);}children(a).forEach(scan);}
  f.slice(2).forEach(scan);
  function mark(a,set,throughLocals){if(!Array.isArray(a)||set.has(a))return;set.add(a);if(a[0]==='local.get'&&throughLocals)(defs.get(a[1])??[]).forEach(x=>mark(x,set,true));
   // A load's value can be a pointer, but computing that load's address is a separate EA.
   if(/\.(load|store)/.test(a[0]))return;children(a).forEach(x=>mark(x,set,throughLocals));}
  function addresses(a){if(!Array.isArray(a))return;if(/^(i32|i64|f32|f64)\.(load|store)/.test(a[0])){mark(children(a)[0],directNodes,false);mark(children(a)[0],addressNodes,true);}children(a).forEach(addresses);}
  f.slice(2).forEach(addresses);
  let site=0;
  function walk(a){
   if(!Array.isArray(a))return a;const op=a[0];if(['param','local','result','type'].includes(op))return a;
   const orig=[...a],sid=op==='br_table'?site++:null,selectorSource=sid===null?null:structuredClone(a.at(-1));
   for(let i=1;i<a.length;i++)if(Array.isArray(a[i]))a[i]=walk(a[i]);
   if(/^(i32|i64|f32|f64)\.(load|store)/.test(op)){
    const i=orig.findIndex(Array.isArray),direction=op.includes('.load')?'load':'store';
    if(native)a[i]=wrap(a[i],'i32',count('memory.data.'+direction));
    else{
     const offset=Number(a.find(x=>typeof x==='string'&&x.startsWith('offset='))?.split('=')[1]??0);
     const actual=offset?['i32.add',['local.get','$k39_addr'],['i32.const',String(offset)]]:['local.get','$k39_addr'];
     const guest=['i32.and',['i32.ge_u',structuredClone(actual),structuredClone(flatExpr)],['i32.lt_u',['i32.sub',actual,structuredClone(flatExpr)],['i32.const','1073741824']]];
     a[i]=['block',['result','i32'],['local.set','$k39_addr',a[i]],['if',guest,['then',...count('memory.guest.'+direction)],['else',...count('memory.host.'+direction)]],['local.get','$k39_addr']];
    }
    return a;
   }
   if(op==='br_table'){
    sites.push({function:f[1],site:sid,targets:orig.filter(x=>typeof x==='string').slice(1),selector:selectorSource});
    a[a.length-1]=wrap(a.at(-1),'i32',[...count('op.br_table'),counter('site.'+f[1].slice(1)+'.'+sid)]);return a;
   }
   if(op==='if'||op==='br_if'){
    const i=op==='if'?a.findIndex(x=>Array.isArray(x)&&x[0]!=='result'):a.length-1;
    a[i]=wrap(a[i],'i32',count('op.'+op));return a;
   }
   if(op==='block'||op==='loop'){
    let at=1;while(at<a.length&&(typeof a[at]==='string'||a[at][0]==='result'))at++;a.splice(at,0,...count('op.'+op));return a;
   }
   if(op==='then'||op==='else')return a;
   if(op==='return')return wrap(a,null,[...count('op.return'),...count('exits')]);
   if(op==='br'||op==='unreachable')return wrap(a,null,count('op.'+op));
   let cat='op.'+op;if(op==='call')cat='call.'+group(a[1]);
   if(op==='call_indirect')cat='call.indirect';
   const cs=count(cat);if(op==='call')cs.push(counter('target.'+a[1].slice(1)));
   if(/^(i32|i64)\./.test(op)&&!op.endsWith('.const')){
    if(directNodes.has(a))cs.push(...count('address.direct.'+op));
    else if(addressNodes.has(a))cs.push(...count('address.precomputed_candidate.'+op));
   }
   return wrap(a,infer(a),cs);
  }
  let at=2;while(at<f.length&&Array.isArray(f[at])&&['param','local','result'].includes(f[at][0]))at++;
  const body=f.splice(at).map(walk),ret=result(f);
  if(!native)f.push(['local','$k39_addr','i32']);
  if(ret)f.push(['local','$k39_result',ret]);
  f.push(...count('entries'),counter('function.'+f[1].slice(1)+'.entries'));
  if(f[1]==='$x86_find_lifted'){
   f.push(['if',['i32.and',['global.get','$k40_seen'],['i32.eq',['global.get','$k40_previous'],['local.get','$0']]],['then',counter('reuse.same_previous_pc')]],['global.set','$k40_previous',['local.get','$0']],['global.set','$k40_seen',['i32.const','1']]);
  }
  if(f[1]==='$x86_register_lifted')f.push(['global.set','$k40_seen',['i32.const','0']]);
  if(ret)f.push(['local.set','$k39_result',['block',['result',ret],...body]],...count('exits'),['local.get','$k39_result']);
  else f.push(...body,...count('exits'));
 }
 mod.push(['global','$k40_previous',['mut','i32'],['i32.const','0']],['global','$k40_seen',['mut','i32'],['i32.const','0']]);
 for(const [label,name]of counters)mod.push(['global',name,['mut','i64'],['i64.const','0']],['export',JSON.stringify('k39_'+label),['global',name]]);
 if(flatExpr)mod.push(['func','$k39_flat',['result','i32'],structuredClone(flatExpr)],['export','"k39_flat"',['func','$k39_flat']]);
 const print=a=>Array.isArray(a)?'('+a.map(print).join(' ')+')':a;
 return {wat:print(mod),labels,flatExpr,sites};
}
