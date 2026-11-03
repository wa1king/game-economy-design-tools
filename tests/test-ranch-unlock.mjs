import test from 'node:test';
import assert from 'node:assert/strict';
import {ranchUnlockLevel,ranchLevelUnlocked,ranchUnlockedPlans} from '../orders/ranch-unlock.js';
import {loadRanchWorkspace,saveRanchUnlockLevel,calculateRanchWorkspace,readRanchTarget,mergeRanchSettings} from '../orders/ranch-workspace.js';
import {writeSharedChainSource} from '../orders/shared-chain-source.js';
import {ranchSettingsKey,calculateRanchImport} from '../orders/ranch-import.js';
import {prepareRanch,solveRanchGroup} from '../orders/ranch-engine.js';
import {fitRanchQuantities} from '../orders/ranch-quantity.js';
import {ranchExportSheets} from '../orders/ranch-export.js';
import {ranchDashboardRows,ranchDashboardSummary} from '../orders/ranch-distribution.js';

const base={maxLevel:3,sources:[{id:10,name:'工坊',level:1}],products:[{id:1,name:'测试商品',level:1,buildingId:10,buildingName:'工坊',stepMinutes:10,analysisBatchYield:1,inputs:[],coinValue:10}]};
const target={targetHours:String(40/60),targetTolerance:'0',targetWork:'40',fitCropMax:'1',fitProductMax:'1',quantityBudget:'1000'};
async function setup(settings={}){
  const map=new Map(),calls=[],saves=[];
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};writeSharedChainSource(base,'synthetic.xlsx',storage);storage.setItem(ranchSettingsKey(base),JSON.stringify(settings));
  const ws=await loadRanchWorkspace({storage,loadCache:async()=>null,mergeCache:async(key,value)=>{saves.push(key);return value;},workerFactory:()=>({terminate(){},postMessage(data){calls.push(data);queueMicrotask(()=>{
    const model=prepareRanch(data.base);
    for(const [i,g] of data.groups.entries()){
      const result=data.mode==='quantity'?{type:'quantityResult',id:g.id,fit:fitRanchQuantities(model,g,data.level,data.capacities,data.options)}:{type:'result',id:g.id,result:solveRanchGroup(model,g,data.level,data.capacities)};
      this.onmessage({data:{...result,requestId:data.requestId,index:i+1,total:data.groups.length}});
    }
    this.onmessage({data:{type:'done',requestId:data.requestId}});
  });}})});
  return {ws,storage,calls,saves};
}
test('default preserves all levels, explicit unlock is inclusive and invalid values are rejected',()=>{
  assert.equal(ranchUnlockLevel(),1);assert.equal(ranchUnlockLevel({unlockLevel:'6'}),6);
  const plans=[1,2,3].map(level=>({level}));assert.deepEqual(ranchUnlockedPlans(plans,{unlockLevel:2}),plans.slice(1));assert.equal(plans.length,3);
  assert(!ranchLevelUnlocked(1,{unlockLevel:2}));assert(ranchLevelUnlocked(2,{unlockLevel:2}));
  for(const value of [0,-1,1.5,'',NaN,201])assert.throws(()=>ranchUnlockLevel({unlockLevel:value}));
});
test('unlock saves merge latest user settings and retain quantities, targets, caches and later re-unlocking',async()=>{
  const {ws,storage}=await setup({quantityTargetsByLevel:{1:target},quantityEdits:{1:{sentinel:[2,2,2,2]}}}),key=ws.storageKey;
  const plan=ws.plans[0],g=plan.groups[0];plan.results.set(g.key,solveRanchGroup(ws.model,g,1,plan.capacities));
  const previous=structuredClone(ws.settings),before=JSON.stringify([...plan.results]);
  const latest=JSON.parse(storage.getItem(key));latest.targetCoins='777';storage.setItem(key,JSON.stringify(latest));
  saveRanchUnlockLevel(ws,2);assert.equal(ws.settings.unlockLevel,2);assert.equal(ws.settings.targetCoins,'777');assert.deepEqual(ws.settings.quantityEdits,previous.quantityEdits);assert.deepEqual(ws.settings.quantityTargetsByLevel,previous.quantityTargetsByLevel);
  const value=storage.getItem(key);for(const invalid of [0,1.5,4,'']){assert.throws(()=>saveRanchUnlockLevel(ws,invalid));assert.equal(storage.getItem(key),value);}
  // An idle detail tab cannot overwrite the newly saved unlock level.
  assert.equal(mergeRanchSettings(previous,{...previous,level:3},ws.settings).unlockLevel,2);
  saveRanchUnlockLevel(ws,1);assert.equal(JSON.stringify([...plan.results]),before);assert.equal(ranchUnlockedPlans(ws.plans,ws.settings).length,3);
});
test('both computation modes skip locked grades, their invalid targets and capacity errors without changing stored results',async()=>{
  for(const mode of ['quantity','schedule']){
    const {ws,calls,saves}=await setup({unlockLevel:2,quantityTargetsByLevel:{1:{targetHours:'invalid'},2:target,3:target}});
    const locked=ws.plans[0],g=locked.groups[0];locked.results.set(g.key,solveRanchGroup(ws.model,g,1,locked.capacities));locked.capacityError='锁定等级的产能不用参与校验';const before=JSON.stringify([...locked.results]),progress=[];
    const report=await calculateRanchWorkspace(ws,{mode,onProgress:p=>progress.push(p)});
    assert.equal(report.failed,0);assert(calls.length);assert(calls.every(c=>c.level>=2));assert(progress.every(p=>p.level>=2&&p.totalLevels===2));assert(!saves.includes(locked.cacheKey));assert.equal(JSON.stringify([...locked.results]),before);
    const plans=ranchUnlockedPlans(ws.plans,ws.settings),targets=Object.fromEntries(plans.map(p=>[p.level,readRanchTarget(ws.settings,p.level)]));
    assert.deepEqual([...new Set(ranchDashboardRows(plans,targets).map(r=>r.level))],[2,3]);assert.equal(ranchDashboardSummary(plans,targets).levels,2);
    const sheets=ranchExportSheets(ws);assert(sheets[0].rows.slice(1).every(r=>r[0]>=2));assert.deepEqual(sheets[1].rows.slice(1).map(r=>r[0]),[2,3]);
  }
});
test('legacy result import only recomputes unlocked grades and retains the unlock preference',async()=>{
  const levels=[],result=await calculateRanchImport({schema:'ranch-precomputed-v1',base},{settings:{unlockLevel:2},solve:(model,g,level,capacities)=>{levels.push(level);return solveRanchGroup(model,g,level,capacities);}});
  assert(levels.length);assert(levels.every(level=>level>=2));assert.equal(result.settings.unlockLevel,2);
});
