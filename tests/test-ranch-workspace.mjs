import assert from 'node:assert/strict';
import test from 'node:test';
import {loadRanchWorkspace,saveRanchTargets,readRanchTarget,calculateRanchWorkspace,ranchAutoWorkTarget,ranchFitIsCurrent} from '../orders/ranch-workspace.js';
import {mergeRanchCacheValue} from '../orders/ranch-cache.js';
import {ranchSettingsKey} from '../orders/ranch-import.js';
import {prepareRanch,solveRanchGroup,groupMetrics} from '../orders/ranch-engine.js';
import {fitRanchQuantities,quantityGroup,QUANTITY_SEARCH_VERSION,hasEqualProductQuantities} from '../orders/ranch-quantity.js';
import {ranchDistributionRows} from '../orders/ranch-distribution.js';

const product=(id,buildingId,time,level=1,inputs=[])=>({id,name:'测试商品'+id,buildingId,buildingName:'来源'+buildingId,stepMinutes:time,level,isCrop:buildingId===0,analysisBatchYield:1,coproducts:[],inputs:inputs.map(([id,quantity])=>({id,quantity})),coinValue:id});
const simpleBase={maxLevel:2,products:[product(1,10,10)],sources:[{id:10,name:'工坊',level:1}]};
const cropBase={maxLevel:2,products:[product(1,0,2),product(2,10,10,2,[[1,1]])],sources:[{id:0,name:'农田',level:1},{id:10,name:'工坊',level:2}],landsByLevel:{1:6,2:6}};
const target={targetHours:'1.3333333333333333',targetTolerance:'0',targetWork:'80',fitCropMax:'3',fitProductMax:'3',quantityBudget:'2500'};
const copy=value=>structuredClone(value);
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};

function harness({base=simpleBase,settings={},automatic=true,source=true}={}){
  const storageKey=ranchSettingsKey(base),memory=new Map(source?[['ranch-source-v1',JSON.stringify({kind:'import',base,filename:'合成测试.xlsx'})],[storageKey,JSON.stringify(settings)],['order-project-v3',JSON.stringify({sentinel:'ordinary-project'})]]:[]),cache=new Map(),workers=[],writes=[],messages=[];
  const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>{memory.set(key,value);}};
  const deps={storage,loadCache:async key=>copy(cache.get(key)),mergeCache:async(key,value)=>{const merged=mergeRanchCacheValue(cache.get(key),value);cache.set(key,copy(merged));writes.push({key,value:copy(value)});return copy(merged);},workerFactory:()=>{
    const worker={terminated:false,data:null,onmessage:null,onerror:null,terminate(){this.terminated=true;},emit(data){this.onmessage?.({data});},postMessage(data){this.data=data;messages.push(copy(data));if(!automatic)return;
      queueMicrotask(async()=>{
        try{const model=prepareRanch(data.base);for(const [i,group]of data.groups.entries()){
          if(this.terminated)return;
          if(data.mode==='quantity'){const fit=fitRanchQuantities(model,group,data.level,data.capacities,data.options,data.baselines?.[group.id]??null);this.emit({type:'quantityResult',id:group.id,fit,index:i+1,total:data.groups.length});}
          else{const result=solveRanchGroup(model,group,data.level,data.capacities,{timeLimitMs:data.timeLimitMs,nodeLimit:10000});this.emit({type:'result',id:group.id,result,index:i+1,total:data.groups.length});}
          await Promise.resolve();
        }if(!this.terminated)this.emit({type:'done'});}catch(error){this.emit({type:'error',message:error.message});}
      });
    }};workers.push(worker);return worker;
  }};
  return {base,storageKey,memory,storage,cache,workers,writes,messages,deps,load:()=>loadRanchWorkspace(deps),settings:()=>JSON.parse(memory.get(storageKey)||'{}')};
}

test('workspace load uses imported source, existing quantities and cache without solving or writing',async()=>{
  const h=harness({settings:{level:2,quantityTargets:{...target,targetHours:'1.50'},browser:{type:'building',buildingId:10}}}),first=await h.load(),group=first.plans[1].groups[0],edited=quantityGroup(group,[2,2,2,2]),result=solveRanchGroup(first.model,edited,2,first.plans[1].capacities);
  h.memory.set(h.storageKey,JSON.stringify({...h.settings(),quantityEdits:{2:{[group.id]:[2,2,2,2]}}}));h.cache.set(first.plans[1].cacheKey,{version:2,results:[[edited.key,result]],failures:[],quantityFits:[]});const before=copy([...h.memory]),ws=await h.load();
  assert.equal(ws.filename,'合成测试.xlsx');assert.equal(ws.plans.length,2);assert.deepEqual(ws.plans[1].groups[0].slots.map(s=>s.quantity),[2,2,2,2]);assert.equal(ws.plans[1].results.get(edited.key).optimalMinutes,80);assert.equal(ws.plans[1].work.get(edited.key),80);assert.equal(ws.plans[1].metrics.get(edited.key).coinValue,8);assert.equal(readRanchTarget(ws.settings,2).targetHours,'1.50');assert.deepEqual([...h.memory],before);assert.equal(h.workers.length,0);assert.equal(h.writes.length,0);assert.equal(await harness({source:false}).load(),null);
});

test('saving target cells is atomic, retains raw strings and merges unrelated changes from another page',async()=>{
  const h=harness({settings:{level:2,quantityTargets:{...target},quantityTargetsByLevel:{1:{...target},2:{...target}},browser:{groupId:'old'}}}),ws=await h.load(),latest={...h.settings(),browser:{groupId:'new'},capacities:{2:{10:2}},quantityEdits:{2:{example:[3,1,1,1]}}};h.memory.set(h.storageKey,JSON.stringify(latest));
  const before=h.memory.get(h.storageKey),localBefore=JSON.stringify(ws.settings);
  assert.throws(()=>saveRanchTargets(ws,[{level:1,key:'targetHours',value:'2'},{level:2,key:'fitProductMax',value:'0'}]),/Lv 2/);assert.equal(h.memory.get(h.storageKey),before);assert.equal(JSON.stringify(ws.settings),localBefore);
  saveRanchTargets(ws,[{level:1,key:'targetHours',value:'2.50'},{level:2,key:'targetWork',value:''}]);const saved=h.settings();assert.equal(saved.quantityTargetsByLevel[1].targetHours,'2.50');assert.equal(saved.quantityTargetsByLevel[2].targetWork,'');assert.equal(saved.quantityTargets.targetWork,'');assert.deepEqual(saved.browser,latest.browser);assert.deepEqual(saved.capacities,latest.capacities);assert.deepEqual(saved.quantityEdits,latest.quantityEdits);assert.equal(h.memory.get('order-project-v3'),JSON.stringify({sentinel:'ordinary-project'}));assert(h.memory.has('ranch-workspace-revision-v1'));
});

test('current-quantity mode computes joint schedules, reuses exact demands across levels and persists results only',async()=>{
  const h=harness({settings:{searchLimit:'10000',quantityTargetsByLevel:{1:target,2:target}}}),ws=await h.load(),settingsBefore=h.memory.get(h.storageKey),sourceBefore=h.memory.get('ranch-source-v1'),events=[];
  const report=await calculateRanchWorkspace(ws,{mode:'schedule',onProgress:p=>events.push(p)});
  assert.equal(report.scheduled,1,'identical capacities and demand should be scheduled once');assert.equal(h.workers.length,1);assert.equal(h.messages[0].timeLimitMs,10000);assert.equal(h.messages[0].groups[0].id,ws.plans[0].groups[0].key);assert.equal(report.failed,0);assert.equal(ws.running,false);
  for(const plan of ws.plans){const result=plan.results.get(plan.groups[0].key);assert(result.proven);assert.equal(result.optimalMinutes,40);assert.equal(result.totalMinutes,40);assert.equal(h.cache.get(plan.cacheKey).results.length,1);}
  assert(events.some(p=>p.phase==='schedule'));assert.equal(h.memory.get(h.storageKey),settingsBefore);assert.equal(h.memory.get('ranch-source-v1'),sourceBefore);const rows=ranchDistributionRows(ws.plans,'building');assert(rows.every(row=>row.optimized.mean===40&&row.proven===1));
});

test('quantity mode applies real fit recommendations under stable group IDs and updates keys, statistics and reloads',async()=>{
  const h=harness({settings:{quantityTargetsByLevel:{1:target,2:target},browser:{groupId:'keep'}}}),ws=await h.load(),original=ws.plans.map(plan=>({id:plan.groups[0].id,key:plan.groups[0].key}));
  const report=await calculateRanchWorkspace(ws,{mode:'quantity'});assert.equal(report.fitted,2);assert.equal(report.scheduled,0,'explicit work target does not need baseline');assert(h.messages.every(message=>message.mode==='quantity'));
  for(const [i,plan]of ws.plans.entries()){
    const group=plan.groups[0],fit=plan.quantityFits.get(group.id);assert.equal(group.id,original[i].id);assert.notEqual(group.key,original[i].key);assert.equal(group.slots.reduce((n,s)=>n+s.quantity,0),8);assert(ranchFitIsCurrent(fit,group,fit.options));assert.equal(plan.results.get(group.key).optimalMinutes,80);assert.equal(plan.work.get(group.key),80);assert.equal(plan.metrics.get(group.key).coinValue,8);assert.deepEqual(h.settings().quantityEdits[plan.level][group.id],group.slots.map(s=>s.quantity));assert(h.cache.get(plan.cacheKey).results.some(([key])=>key===group.key));assert(h.cache.get(plan.cacheKey).quantityFits.some(([key])=>key===group.id));
  }
  assert.deepEqual(h.settings().browser,{groupId:'keep'});assert(ranchDistributionRows(ws.plans,'building').every(row=>row.work.mean===80&&row.optimized.mean===80));const restored=await h.load();assert(restored.plans.every(plan=>plan.work.get(plan.groups[0].key)===80));const again=await calculateRanchWorkspace(restored,{mode:'quantity'});assert.equal(again.fitted,0);assert.equal(again.skipped,2);
});

test('blank automatic work target estimates a ratio without scheduling arbitrary starting quantities',async()=>{
  const auto={...target,targetHours:'1',targetTolerance:'10',targetWork:''},h=harness({base:cropBase,settings:{cropQuantity:1,quantityTargetsByLevel:{2:auto}}}),ws=await h.load();assert.equal(ws.plans[0].groups.length,0);assert.equal(ranchAutoWorkTarget(ws,ws.plans[1]),72);
  const report=await calculateRanchWorkspace(ws,{mode:'quantity'});assert.equal(report.scheduled,0);assert.equal(report.fitted,1);assert.equal(h.messages.length,1);assert.equal(h.messages[0].mode,'quantity');assert.equal(h.messages[0].options.targetWorkMinutes,72);assert.equal(h.settings().quantityTargetsByLevel[2].targetWork,'');assert.equal(h.settings().workRatios[JSON.stringify([2,ws.plans[1].capacities])],1.2);
  const restored=await h.load();assert.equal(ranchAutoWorkTarget(restored,restored.plans[1]),72);assert.equal(restored.plans[1].work.get(restored.plans[1].groups[0].key),groupMetrics(restored.model,restored.plans[1].groups[0],2).totalMinutes);
});

test('pause flushes partial schedules, ignores late messages, and resumes without recalculating confirmed results',async()=>{
  const base={...simpleBase,products:[product(1,10,10),product(2,10,20)],maxLevel:1},h=harness({base,automatic:false}),ws=await h.load(),controller=new AbortController(),pending=calculateRanchWorkspace(ws,{mode:'schedule',signal:controller.signal});await flush();const worker=h.workers[0],group=worker.data.groups[0],result=solveRanchGroup(ws.model,group,1,ws.plans[0].capacities);worker.emit({type:'result',id:group.id,result,index:1,total:worker.data.groups.length});controller.abort();const report=await pending;
  assert.equal(report.stopped,true);assert.equal(ws.running,false);assert(worker.terminated);assert.equal(h.cache.get(ws.plans[0].cacheKey).results.length,1);const saved=copy(h.cache.get(ws.plans[0].cacheKey));
  worker.emit({type:'result',id:worker.data.groups[1].id,result:{...result,optimalMinutes:9999},index:2,total:worker.data.groups.length});assert.equal(ws.plans[0].results.size,1);assert.deepEqual(h.cache.get(ws.plans[0].cacheKey),saved);
  const resumed=calculateRanchWorkspace(ws,{mode:'schedule'});await flush();const next=h.workers[1];assert.equal(next.data.groups.length,worker.data.groups.length-1);assert(!next.data.groups.some(g=>g.id===group.id));for(const [i,g]of next.data.groups.entries())next.emit({type:'result',id:g.id,result:solveRanchGroup(ws.model,g,1,ws.plans[0].capacities),index:i+1,total:next.data.groups.length});next.emit({type:'done'});await resumed;assert.equal(ws.plans[0].results.size,ws.plans[0].groups.length);assert.equal(h.cache.get(ws.plans[0].cacheKey).results.length,ws.plans[0].groups.length);
});

test('cache merging preserves proven or better feasible schedules and independent recommendations',()=>{
  const exact={proven:true,optimalMinutes:40,feasibleMinutes:40},good={proven:false,lowerMinutes:20,feasibleMinutes:60},worse={proven:false,lowerMinutes:25,feasibleMinutes:90};
  const merged=mergeRanchCacheValue({version:2,results:[['exact',exact],['bounded',good]],failures:[['stale','old']],quantityFits:[['keep',{x:1}]]},{version:2,results:[['exact',worse],['bounded',worse],['stale',exact]],failures:[['exact','should not replace'],['failed','failure']],quantityFits:[['new',{x:2}]]});
  assert.deepEqual(new Map(merged.results).get('exact'),exact);assert.deepEqual(new Map(merged.results).get('bounded'),good);assert.deepEqual(merged.failures,[['failed','failure']]);assert.deepEqual(merged.quantityFits,[['keep',{x:1}],['new',{x:2}]]);
  assert.equal(new Map(mergeRanchCacheValue(merged,{results:[['bounded',{...good,feasibleMinutes:55}]]}).results).get('bounded').feasibleMinutes,55);
});

test('a concurrent cache update survives a stale workspace snapshot while computing',async()=>{
  const h=harness({base:{...simpleBase,maxLevel:1},automatic:false}),ws=await h.load(),plan=ws.plans[0],group=plan.groups[0],run=calculateRanchWorkspace(ws,{mode:'schedule'});await flush();h.cache.set(plan.cacheKey,{version:2,results:[['another-view',{proven:true,optimalMinutes:77}]],failures:[],quantityFits:[['another-recommendation',{keep:true}]]});
  const worker=h.workers[0];worker.emit({type:'result',id:group.key,result:solveRanchGroup(ws.model,group,1,plan.capacities),index:1,total:1});worker.emit({type:'done'});await run;const cache=h.cache.get(plan.cacheKey);assert(cache.results.some(([key])=>key==='another-view'));assert(cache.results.some(([key])=>key===group.key));assert.deepEqual(cache.quantityFits,[['another-recommendation',{keep:true}]]);
});

test('re-running a bounded schedule cannot make the current view worse than its already-known feasible schedule',async()=>{
  const h=harness({base:{...simpleBase,maxLevel:1},automatic:false}),first=await h.load(),plan=first.plans[0],group=plan.groups[0],good={proven:false,lowerMinutes:30,feasibleMinutes:50,totalMinutes:40};h.cache.set(plan.cacheKey,{version:2,results:[[group.key,good]],failures:[],quantityFits:[]});const ws=await h.load(),pending=calculateRanchWorkspace(ws,{mode:'schedule'});await flush();const worker=h.workers[0];worker.emit({type:'result',id:group.key,result:{...good,feasibleMinutes:80},index:1,total:1});worker.emit({type:'done'});await pending;
  assert.equal(new Map(h.cache.get(plan.cacheKey).results).get(group.key).feasibleMinutes,50);assert.equal(ws.plans[0].results.get(group.key).feasibleMinutes,50,'visible results must retain the better already-known feasible schedule');
});

test('cache write failure releases the workspace running lock so the user can retry',async()=>{
  const h=harness({base:{...simpleBase,maxLevel:1}}),ws=await h.load();ws.services.mergeCache=async()=>{throw Error('simulated storage full');};await assert.rejects(calculateRanchWorkspace(ws,{mode:'schedule'}),/simulated storage full/);assert.equal(ws.running,false,'storage errors must not permanently lock this workspace');
});

test('equivalent fits are reused across levels even when an unused workshop unlocks',async()=>{
  const base={...simpleBase,sources:[...simpleBase.sources,{id:20,name:'未使用工坊',level:2}]},h=harness({base,settings:{quantityTargetsByLevel:{1:target,2:target}}}),ws=await h.load();
  const report=await calculateRanchWorkspace(ws);assert.equal(report.scheduled,0);assert.equal(report.fitted,2);assert.equal(report.reused,1);assert.equal(h.messages.length,1);assert.equal(h.messages[0].mode,'quantity');
  const again=await h.load(),calls=h.messages.length,result=await calculateRanchWorkspace(again);assert.equal(result.skipped,2);assert.equal(h.messages.length,calls);
});
test('changing a goal prevents cross-level reuse of an otherwise identical group',async()=>{
  const h=harness({settings:{quantityTargetsByLevel:{1:target,2:{...target,targetHours:'2',targetWork:'120'}}}}),ws=await h.load(),report=await calculateRanchWorkspace(ws);
  assert.equal(report.reused,0);assert.equal(h.messages.length,2);assert.equal(h.messages[0].options.targetMinutes,80);assert.equal(h.messages[1].options.targetMinutes,120);
  assert.equal(h.workers.length,1,'retain the same prepared worker and verified demand cache across levels');assert(h.workers[0].terminated,'release it after the full batch completes');
});

test('a delayed message from an earlier grade cannot enter the next grade on a retained worker',async()=>{
  const h=harness({automatic:false,settings:{quantityTargetsByLevel:{1:target,2:{...target,targetHours:'2',targetWork:'120'}}}}),ws=await h.load(),pending=calculateRanchWorkspace(ws);await flush();
  const worker=h.workers[0],first=worker.data;
  worker.emit({type:'done',requestId:first.requestId});await flush();
  assert.equal(h.workers.length,1);assert.equal(worker.data.level,2);assert.notEqual(worker.data.requestId,first.requestId);
  worker.emit({type:'groupError',requestId:first.requestId,id:first.groups[0].id,message:'late stale error'});
  assert.equal(ws.plans[1].quantityErrors.size,0);
  worker.emit({type:'done',requestId:worker.data.requestId});await pending;assert(worker.terminated);
});
test('pausing target fitting flushes pending quantity edits and their verified schedule together',async()=>{
  const h=harness({base:{...simpleBase,maxLevel:1},settings:{quantityTargetsByLevel:{1:target}},automatic:false}),ws=await h.load(),controller=new AbortController(),pending=calculateRanchWorkspace(ws,{signal:controller.signal});await flush();
  const worker=h.workers[0],g=worker.data.groups[0],updated=quantityGroup(g,[2,2,2,2]),result=solveRanchGroup(ws.model,updated,1,ws.plans[0].capacities),fit={options:worker.data.options,recommendations:[{group:updated,result}]};
  worker.emit({type:'quantityResult',id:g.id,fit,index:1,total:1});controller.abort();await pending;
  assert.deepEqual(h.settings().quantityEdits[1][g.id],[2,2,2,2]);assert(h.cache.get(ws.plans[0].cacheKey).quantityFits.some(([id])=>id===g.id));assert(h.cache.get(ws.plans[0].cacheKey).results.some(([key])=>key===updated.key));
});

test('successful cached fits survive algorithm upgrades, while old failed searches can be retried',()=>{
  const group={key:'same',slots:Array.from({length:4},()=>({id:1,quantity:1}))},options={targetMinutes:360,toleranceMinutes:30,targetWorkMinutes:1000,cropMax:42,productMax:12,timeLimitMs:2500},fit={options,recommendations:[{group,result:{orderWorkBalanced:true,orderWorkShares:[.25,.25,.25,.25]}}]};
  assert.equal(ranchFitIsCurrent({...fit,within:true},group,options),true);assert.equal(ranchFitIsCurrent({...fit,within:false},group,options),false);assert.equal(ranchFitIsCurrent({...fit,within:false,searchVersion:QUANTITY_SEARCH_VERSION},group,options),true);
});

test('legacy unequal copies retain user inputs but cannot remain valid cached fits or results',async()=>{
  const h=harness(),first=await h.load(),plan=first.plans[1],g=plan.groups[0],old=quantityGroup(g,[2,1,1,1]),result=solveRanchGroup(first.model,old,2,plan.capacities);
  h.memory.set(h.storageKey,JSON.stringify({quantityEdits:{2:{[g.id]:[2,1,1,1]}}}));
  const fit={within:true,searchVersion:QUANTITY_SEARCH_VERSION,options:{},recommendations:[{group:old,result}]};h.cache.set(plan.cacheKey,{version:2,results:[[old.key,result]],quantityFits:[[g.id,fit]],failures:[]});
  const saved=h.memory.get(h.storageKey),ws=await h.load(),loaded=ws.plans[1];
  assert.deepEqual(loaded.groups[0].slots.map(v=>v.quantity),[2,1,1,1]);assert.equal(h.memory.get(h.storageKey),saved);assert.equal(h.writes.length,0);assert.equal(h.workers.length,0);
  assert(!loaded.results.has(old.key));assert(!loaded.quantityFits.has(g.id));assert.match(loaded.failures.get(old.key),/相同商品数量不一致/);assert.equal(ranchDistributionRows([loaded],'building')[0].proven,0);
});

test('old successful recommendations with unequal copies cannot bypass the new quantity rule',()=>{
  const g=quantityGroup({id:'same',slots:Array.from({length:4},()=>({id:1,quantity:1}))},[1,1,1,1]),bad=quantityGroup(g,[2,1,1,1]),options={targetMinutes:360,toleranceMinutes:30,targetWorkMinutes:1000,cropMax:42,productMax:12,timeLimitMs:2500};
  assert(hasEqualProductQuantities(g));assert(!hasEqualProductQuantities(bad));
  assert.equal(ranchFitIsCurrent({within:true,options,recommendations:[{group:bad}]},bad,options),false);
  assert.equal(ranchFitIsCurrent({within:true,options,recommendations:[{group:g},{group:bad}]},g,options),false);
  assert.equal(ranchFitIsCurrent({within:true,options,recommendations:[{group:g,result:{orderWorkBalanced:true,orderWorkShares:[.25,.25,.25,.25]}}]},g,options),true);
});
