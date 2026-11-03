import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ranchUnlockLevel,ranchLevelUnlocked,ranchUnlockedPlans} from '../orders/ranch-unlock.js';
import {loadRanchWorkspace,saveRanchUnlockLevel,calculateRanchWorkspace,readRanchTarget,mergeRanchSettings} from '../orders/ranch-workspace.js';
import {writeSharedChainSource} from '../orders/shared-chain-source.js';
import {ranchSettingsKey,calculateRanchImport} from '../orders/ranch-import.js';
import {prepareRanch,solveRanchGroup} from '../orders/ranch-engine.js';
import {fitRanchQuantities} from '../orders/ranch-quantity.js';
import {ranchExportSheets,downloadRanchWorkbook} from '../orders/ranch-export.js';
import {ranchDashboardRows,ranchDashboardSummary} from '../orders/ranch-distribution.js';

const base={maxLevel:3,sources:[{id:10,name:'工坊',level:1}],products:[{id:1,name:'测试商品',level:1,buildingId:10,buildingName:'工坊',stepMinutes:10,analysisBatchYield:1,inputs:[],coinValue:10}]};
const target={targetHours:String(40/60),targetTolerance:'0',targetWork:'40',fitCropMax:'1',fitProductMax:'1',quantityBudget:'1000'};
async function setup(settings={},fixture=base){
  const map=new Map(),cache=new Map(),calls=[],saves=[];
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};writeSharedChainSource(fixture,'synthetic.xlsx',storage);storage.setItem(ranchSettingsKey(fixture),JSON.stringify(settings));
  const ws=await loadRanchWorkspace({storage,loadCache:async key=>cache.get(key),mergeCache:async(key,value)=>{saves.push(key);cache.set(key,value);return value;},workerFactory:()=>({terminate(){},postMessage(data){calls.push(data);queueMicrotask(()=>{
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

test('the downloaded workbook reloads a just-committed Lv 12 gate and neither sheet contains grades 1 through 11',async()=>{
  const fixture={...structuredClone(base),maxLevel:20},quantityTargetsByLevel=Object.fromEntries(Array.from({length:20},(_,i)=>[i+1,target]));
  const {ws,calls}=await setup({quantityTargetsByLevel},fixture);
  for(const p of ws.plans){const g=p.groups[0];p.results.set(g.key,solveRanchGroup(ws.model,g,p.level,p.capacities));await ws.services.mergeCache(p.cacheKey,{version:2,results:[...p.results],failures:[],quantityFits:[]});}
  const module={exports:{}};new Function('module','exports',fs.readFileSync(new URL('../orders/vendor/jszip.min.js',import.meta.url),'utf8'))(module,module.exports);const Zip=module.exports,previous=globalThis.JSZip;globalThis.JSZip=Zip;
  let bytes;
  try{await downloadRanchWorkbook({beforeExport:()=>saveRanchUnlockLevel(ws,12),load:()=>loadRanchWorkspace(ws.services),download:data=>bytes=data});}
  finally{if(previous===undefined)delete globalThis.JSZip;else globalThis.JSZip=previous;}
  const zip=await Zip.loadAsync(bytes);
  for(const [sheet,count] of [[1,18],[2,9]]){
    const xml=await zip.file(`xl/worksheets/sheet${sheet}.xml`).async('string'),levels=[...xml.matchAll(/<c r="A\d+"[^>]*><v>([\d.]+)<\/v>/g)].map(m=>Number(m[1]));
    assert.equal(levels.length,count);assert.equal(Math.min(...levels),12);assert.equal(Math.max(...levels),20);assert(levels.every(level=>level>=12));
  }
  assert.equal(calls.length,0,'export never triggers scheduling');
});
