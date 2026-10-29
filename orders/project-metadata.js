import {unitCoinValue,coinValueCoverage} from './coin-values.js';
const recipe=items=>(items||[]).map(i=>[i.id,i.quantity]).sort((a,b)=>a[0]-b[0]);
const profile=base=>JSON.stringify({sources:base.sources.map(s=>s.id).sort((a,b)=>a-b),products:base.products.map(p=>[p.id,p.level,p.buildingId,Boolean(p.isCrop),p.stepMinutes,p.analysisBatchYield,recipe(p.inputs),recipe(p.coproducts)]).sort((a,b)=>a[0]-b[0])});
const land=v=>Number.isSafeInteger(v)&&v>0;
// Automatic recovery requires identical production data. An explicit metadata-only
// action may join missing land/price values by matching product IDs, levels and buildings.
// Never replace recipes, existing prices, land counts, targets or selected orders.
export function supplementProjectMetadata(base,candidate,{metadataOnly=false}={}){
  if(!base?.products?.length||!candidate?.products?.length)return null;
  const sameIdentity=candidate.products.length===base.products.length&&base.products.every(p=>candidate.products.some(q=>q.id===p.id&&q.level===p.level&&q.buildingId===p.buildingId));
  if(!sameIdentity||!metadataOnly&&profile(base)!==profile(candidate))return null;
  const next=structuredClone(base),by=new Map(candidate.products.map(p=>[p.id,p]));let lands=0,prices=0;
  for(let lv=1;lv<=base.maxLevel;lv++)if(!land(base.landsByLevel?.[lv])&&land(candidate.landsByLevel?.[lv])){(next.landsByLevel??={})[lv]=candidate.landsByLevel[lv];lands++;}
  for(const p of next.products){const q=by.get(p.id);if(unitCoinValue(p)===null&&unitCoinValue(q)!==null){p.coinValue=q.coinValue;p.coinValueStatus=q.coinValueStatus??'导入';p.coinValueSource=q.coinValueSource??null;prices++;}}
  if(!lands&&!prices)return null;
  next.coinValues=coinValueCoverage(next.products);
  return {base:next,lands,prices};
}
export function metadataSourceIssue(base,candidate){
  if(!candidate?.products?.length)return '没有可用的本地牧场导入数据';
  const by=new Map(candidate.products.map(p=>[p.id,p]));
  if(base.products.length!==candidate.products.length)return '商品数量不同';
  for(const p of base.products){const q=by.get(p.id);if(!q)return `缺少商品 ID ${p.id}`;
    for(const key of ['level','buildingId','stepMinutes','analysisBatchYield'])if(p[key]!==q[key])return `${p.name} 的 ${ {level:'解锁等级',buildingId:'建筑',stepMinutes:'单步时间',analysisBatchYield:'产量'}[key]}不同（普通 ${p[key]}，牧场 ${q[key]}）`;
    if(JSON.stringify(recipe(p.inputs))!==JSON.stringify(recipe(q.inputs)))return `${p.name} 的配方不同`;
  }
  return profile(base)===profile(candidate)?'':'建筑或作物分类不同';
}
export function restoreMissingProjectMetadata(saved,storage){
  let candidate;try{const ranch=JSON.parse(storage.getItem('ranch-source-v1')||'null');if(ranch?.kind==='import')candidate=ranch.base;}catch{return null;}
  const update=supplementProjectMetadata(saved.base,candidate);if(!update)return null;
  // Retain the prior project locally before filling missing metadata.
  storage.setItem('order-project-before-metadata-v1',JSON.stringify(saved));
  return {...update,project:{...saved,base:update.base}};
}
