import {ranchFamilies,generateRanchGroups} from './ranch-engine.js';

export function ranchDemandKey(group){
  return group.slots.map(v=>[v.id,v.quantity]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]).map(v=>v.join('x')).join('-');
}
export function ranchPermutations(group){
  const slots=[...group.slots].sort((a,b)=>a.id-b.id||a.quantity-b.quantity),out=[],used=new Set(),current=[];
  function visit(){
    if(current.length===slots.length){out.push({...group,id:'RP-'+current.map(v=>`${v.id}x${v.quantity}`).join('-'),slots:current.map(v=>({...v}))});return;}
    for(let i=0;i<slots.length;i++){
      if(used.has(i)||i>0&&slots[i].id===slots[i-1].id&&slots[i].quantity===slots[i-1].quantity&&!used.has(i-1))continue;
      used.add(i);current.push(slots[i]);visit();current.pop();used.delete(i);
    }
  }
  visit();return out;
}
export function generateRanchLevelGroups(model,level,options={}){
  if(!Number.isInteger(level)||level<1||level>(model.base.maxLevel||20))throw Error('等级超出项目范围。');
  const limit=options.limit??100000,byKey=new Map(),families=['building','chain'].flatMap(type=>ranchFamilies(model,level,type).map(f=>({...f,type})));
  for(const f of families)for(const g of generateRanchGroups(model,f,{...options,limit})){
    const key=ranchDemandKey(g),existing=byKey.get(key);
    if(existing){existing.familyIds.push(f.id);if(!existing.types.includes(f.type))existing.types.push(f.type);continue;}
    if(byKey.size>=limit)throw Error(`本级组合超过 ${limit.toLocaleString()} 组，无法完整列出。未截断结果，请缩小生成规则。`);
    byKey.set(key,{...g,id:'R-'+key,key,familyIds:[f.id],types:[f.type]});
  }
  const groups=[...byKey.values()];
  return {families,groups,permutationCount:groups.reduce((s,g)=>s+ranchPermutations(g).length,0)};
}
// Relabel the same feasible schedule for another assignment to A/B/C/D.
// Processing resources and the all-slots completion objective do not depend on animal labels.
export function remapRanchResult(result,source,target){
  const used=new Set(),mapping=source.slots.map(v=>{
    const j=target.slots.findIndex((t,i)=>!used.has(i)&&v.id===t.id&&v.quantity===t.quantity);
    if(j<0)throw Error('不能复用不同交付需求的排程。');used.add(j);return j;
  });
  const completion=Array(4);mapping.forEach((j,i)=>completion[j]=result.slotCompletionMinutes[i]);
  return {...result,slots:target.slots.map((v,i)=>({...v,name:result.slots.find(t=>t.id===v.id)?.name,complexity:result.slots.find(t=>t.id===v.id)?.complexity})),slotCompletionMinutes:completion,schedule:result.schedule.map(t=>({...t,slot:mapping[t.slot]}))};
}
