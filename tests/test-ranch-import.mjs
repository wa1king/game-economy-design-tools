import assert from 'node:assert/strict';
import {prepareRanch,groupMetrics} from '../orders/ranch-engine.js';
import {generateRanchLevelGroups} from '../orders/ranch-catalog.js';
import {calculateRanchImport,readRanchResultBundle,ranchImportCacheKey,ranchSettingsKey,canMigrateRanchSettings,backupRanchBeforeImport} from '../orders/ranch-import.js';
const p=(id,b,inputs=[])=>({id,name:'商品'+id,buildingId:b,buildingName:'建筑'+b,level:b?2:1,isCrop:!b,stepMinutes:5,analysisBatchYield:1,inputs:inputs.map(([id,quantity])=>({id,quantity})),coinValue:id});
const base={maxLevel:2,products:[p(1,0),p(2,0),p(3,0),p(4,0),p(5,10,[[1,1]]),p(6,10,[[5,2]]),p(7,10,[[6,1]])],sources:[{id:0,name:'农田',level:1},{id:10,name:'工坊',level:2}],landsByLevel:{1:6,2:12}};
const payload={schema:'ranch-precomputed-v1',base,filename:'新表.xlsx',level:2,rules:{cropQuantity:7,productQuantity:1,allowRepeated:false},levels:[{groups:[{scheduleResult:{proven:true,optimalMinutes:0}}]}]};
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
await test('all levels are recalculated and fabricated imported optimality is ignored',async()=>{
  const before=JSON.stringify(payload),progress=[],result=await calculateRanchImport(payload,{onProgress:p=>progress.push(p)});assert.equal(result.plans.length,2);assert.equal(result.total,3);assert.equal(result.proven,result.plans.reduce((n,l)=>n+l.cache.results.filter(([,r])=>r.proven).length,0));assert(result.plans[1].cache.results.every(([,r])=>r.feasibleMinutes>0&&(r.proven?r.optimalMinutes===r.feasibleMinutes:r.optimalMinutes===null))); assert.equal(progress.at(-1).completed,result.total);assert.equal(JSON.stringify(payload),before);
  for(const plan of result.plans)assert.equal(plan.cacheKey,ranchImportCacheKey(result.base,plan.level,result.rules,plan.capacities));
});
await test('matching IDs retain edited quantities, targets and capacities under changed recipes',async()=>{
  const model=prepareRanch(base),g=generateRanchLevelGroups(model,2,payload.rules).groups.find(g=>g.types.includes('chain')),settings={level:2,cropQuantity:7,productQuantity:1,allowRepeated:false,quantityEdits:{2:{[g.id]:[9,2,3,4]}},quantityTargetsByLevel:{2:{targetHours:'6',targetWork:'900'}},capacities:{2:{0:6,10:2}}};
  const result=await calculateRanchImport(payload,{settings}),plan=result.plans[1],actual=plan.groups.find(x=>x.id===g.id),r=plan.cache.results.find(([key])=>key===actual.key)[1];assert.deepEqual(actual.slots.map(v=>v.quantity),[9,2,3,4]);assert.equal(plan.capacities[0],6);assert.equal(plan.capacities[10],2);assert.equal(r.totalMinutes,groupMetrics(model,actual,2).totalMinutes);assert.deepEqual(result.settings.quantityTargetsByLevel,settings.quantityTargetsByLevel);assert.deepEqual(result.settings.quantityEdits,settings.quantityEdits);assert.notEqual(result.settings,settings);
});
await test('migration requires the same complete product and source IDs',()=>{
  const changed=structuredClone(base);changed.products[5].name='改名';changed.products[5].inputs[0].quantity=3;changed.products[5].coinValue=99;assert(canMigrateRanchSettings(base,changed));assert.notEqual(ranchSettingsKey(base),ranchSettingsKey(changed));changed.products.pop();assert(!canMigrateRanchSettings(base,changed));assert(!canMigrateRanchSettings(null,base));
});
await test('backup preserves original source/settings and never touches ordinary orders',()=>{
  const source=JSON.stringify({kind:'import',base}),memory=new Map([['ranch-source-v1',source],['order-lab-project','keep']]),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)},settings={level:2},key=backupRanchBeforeImport(storage,settings,{base,filename:'旧表.xlsx'});assert(key.startsWith('ranch-before-import-v1:'));assert.equal(memory.get('ranch-source-v1'),source);assert.equal(memory.get('order-lab-project'),'keep');const backup=JSON.parse(memory.get(key));assert.deepEqual(backup.settings,settings);assert.equal(backup.project.filename,'旧表.xlsx');
});
await test('invalid format, quantities, levels and missing capacity fail rather than corrupting caches',async()=>{
  assert.throws(()=>readRanchResultBundle({schema:'other',base}),/Excel/);assert.throws(()=>readRanchResultBundle({...payload,base:{...base,maxLevel:Infinity}}),/最高等级/);
  const g=generateRanchLevelGroups(prepareRanch(base),2,payload.rules).groups[0];await assert.rejects(()=>calculateRanchImport(payload,{settings:{quantityEdits:{2:{[g.id]:[0,1,1,1]}}}}),/正整数/);await assert.rejects(()=>calculateRanchImport({...payload,base:{...base,landsByLevel:{}}}),/产能/);await assert.rejects(()=>calculateRanchImport(payload,{settings:{level:'bad'}}),/等级/);
});
console.log(checks+' ranch import checks passed');
