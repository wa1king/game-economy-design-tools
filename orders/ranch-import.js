import {prepareRanch,ranchCapacities,solveRanchGroup} from './ranch-engine.js';
import {generateRanchLevelGroups} from './ranch-catalog.js';
import {quantityGroup} from './ranch-quantity.js';

export function ranchSettingsKey(base){
  let h=2166136261;
  for(const c of JSON.stringify({products:base.products,sources:base.sources,lands:base.landsByLevel})){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}
  return 'ranch-settings-v1:'+(h>>>0).toString(16);
}
export function ranchImportCacheKey(base,level,rules,capacities){
  const generation=JSON.stringify([rules.cropQuantity,rules.productQuantity,rules.allowRepeated]);
  return 'ranch-catalog-v3:'+JSON.stringify([base,level,generation,capacities]);
}
const sameIds=(a,b)=>JSON.stringify(a.map(v=>v.id).sort((a,b)=>a-b))===JSON.stringify(b.map(v=>v.id).sort((a,b)=>a-b));
export function canMigrateRanchSettings(oldBase,newBase){
  return Boolean(oldBase&&sameIds(oldBase.products,newBase.products)&&sameIds(oldBase.sources,newBase.sources));
}
export function readRanchResultBundle(value){
  if(value?.schema!=='ranch-precomputed-v1'||!value.base)throw Error('请选择加工链路 Excel 或牧场全等级重算结果 JSON。');
  if(!Number.isSafeInteger(value.base.maxLevel)||value.base.maxLevel<1||value.base.maxLevel>200)throw Error('导入数据的最高等级需为1至200。');
  prepareRanch(value.base);
  return value;
}
export function backupRanchBeforeImport(storage,settings,project=null){
  // Explicit file import keeps an independent restore point. No old key/cache is deleted.
  const value={schema:'ranch-before-import-v1',createdAt:new Date().toISOString(),source:JSON.parse(storage.getItem('ranch-source-v1')||'null'),settings:structuredClone(settings),project:structuredClone(project)};
  const key='ranch-before-import-v1:'+Date.now();storage.setItem(key,JSON.stringify(value));return key;
}
export async function calculateRanchImport(payload,{settings={},onProgress=()=>{},solve=solveRanchGroup}={}){
  const bundle=readRanchResultBundle(payload),base=structuredClone(bundle.base),model=prepareRanch(base);
  const chosen=settings.cropQuantity!=null?settings:bundle.rules??{};
  const rules={cropQuantity:Number(chosen.cropQuantity??7),productQuantity:Number(chosen.productQuantity??1),allowRepeated:chosen.allowRepeated??false,sameBuildingRepeated:true};
  if(typeof rules.allowRepeated!=='boolean')throw Error('重复商品规则必须为勾选状态。');
  const migrated=structuredClone(settings),plans=[];
  for(let level=1;level<=(base.maxLevel??20);level++){
    const capacities={...ranchCapacities(model,level),...(settings.capacities?.[level]??{})};
    for(const source of base.sources)if(!Number.isSafeInteger(Number(capacities[source.id]))||Number(capacities[source.id])<1)throw Error(`Lv ${level} 的 ${source.name} 缺少有效产能。`);
    const {groups}=generateRanchLevelGroups(model,level,rules),edits=settings.quantityEdits?.[level]??{};
    const actual=groups.map(g=>Object.hasOwn(edits,g.id)?quantityGroup(g,edits[g.id]):g);
    plans.push({level,capacities,groups:actual});
  }
  const cache=new Map(),total=plans.reduce((s,l)=>s+l.groups.length,0);let completed=0;
  for(const plan of plans){
    const results=[];
    for(const g of plan.groups){
      const signature=JSON.stringify([g.key,plan.capacities]);
      // Imported optimality flags are never trusted. Recompute using this exact
      // source, migrated quantities and capacities, then validate in the solver.
      if(!cache.has(signature))cache.set(signature,solve(model,g,plan.level,plan.capacities,{timeLimitMs:2000,nodeLimit:10000}));
      results.push([g.key,cache.get(signature)]);completed++;
      if(completed%20===0){onProgress({completed,total,level:plan.level});await new Promise(resolve=>setTimeout(resolve,0));}
    }
    plan.cacheKey=ranchImportCacheKey(base,plan.level,rules,plan.capacities);
    plan.cache={version:2,results,failures:[],quantityFits:[]};
  }
  onProgress({completed,total,level:base.maxLevel});
  const requested=Number(settings.level??bundle.level??20);
  if(!Number.isSafeInteger(requested)||requested<1)throw Error('导入后的当前等级无效。');
  const level=Math.max(1,Math.min(base.maxLevel??20,requested));
  Object.assign(migrated,rules,{level});
  return {base,filename:bundle.filename??base.filename??'加工链路',rules,settings:migrated,storageKey:ranchSettingsKey(base),plans,total,proven:plans.reduce((s,l)=>s+l.cache.results.filter(([,r])=>r.proven).length,0)};
}
