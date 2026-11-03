import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRanch,solveRanchGroup} from '../orders/ranch-engine.js';
import {orderCoinBalance,fitRanchQuantities,quantityGroup,quantityOptions,reuseRanchQuantityFit,ranchQuantityFitKey} from '../orders/ranch-quantity.js';
import {ranchCoinRules,validRanchCoinShares} from '../orders/ranch-coin-rules.js';
import {ranchFitIsCurrent,loadRanchWorkspace,saveRanchObjective} from '../orders/ranch-workspace.js';
import {ranchOrderAdmission} from '../orders/ranch-actual-orders.js';
import {readRanchSettings,RANCH_QUANTITY_RULES_KEY} from '../orders/order-quantity-rules.js';
import {writeSharedChainSource} from '../orders/shared-chain-source.js';
const fixture=(prices,times=prices)=>{const base={maxLevel:1,sources:prices.map((_,i)=>({id:i+1,name:'B'+i,level:1})),products:prices.map((coinValue,i)=>({id:i+1,name:'P'+i,buildingId:i+1,level:1,coinValue,stepMinutes:times[i],analysisBatchYield:1,inputs:[]}))};return {model:prepareRanch(base),group:quantityGroup({id:'G',slots:prices.map((_,i)=>({id:i+1,quantity:1}))},[1,1,1,1]),caps:Object.fromEntries(prices.map((_,i)=>[i+1,1]))};};

test('gold balance accepts widely different work and rejects equal-work orders with unequal gold',()=>{
  const gold=fixture([75,75,75,75],[1,7,100,1000]),r=solveRanchGroup(gold.model,gold.group,1,gold.caps);
  assert.deepEqual(orderCoinBalance(gold.model,gold.group).shares,[.25,.25,.25,.25]);assert(orderCoinBalance(gold.model,gold.group).valid);
  assert(ranchOrderAdmission(gold.group,{model:gold.model,result:r,target:{objective:'coins',targetCoins:'300',coinTolerance:'0',fitProductMax:'12'}}).accepted);
  const work=fixture([1,1,1,97],[10,10,10,10]),w=solveRanchGroup(work.model,work.group,1,work.caps);
  assert(!orderCoinBalance(work.model,work.group).valid);assert(!ranchOrderAdmission(work.group,{model:work.model,result:w,target:{targetHours:String(10/60),targetTolerance:'0'}}).accepted);
});
test('20 and 30 percent endpoints are inclusive; recipes and upstream values never enter delivered gold',()=>{
  const f=fixture([20,30,25,25],[2,5,7,9]);assert(orderCoinBalance(f.model,f.group).valid);
  f.model.by.get(2).inputs=[{id:1,quantity:100}];assert.deepEqual(orderCoinBalance(f.model,f.group).values,[20,30,25,25]);
  f.model.by.get(2).coinValue=31;assert(!orderCoinBalance(f.model,f.group).valid);
  assert(validRanchCoinShares([.2,.3,.25,.25],{}));assert(!validRanchCoinShares([.199,.301,.25,.25],{}));assert(!validRanchCoinShares([.2,.2,.2,.2],{}));
});
test('integer quantities fit 300 total gold with every slot in the 60 to 90 band',()=>{
  const f=fixture([10,20,30,40],[40,30,20,10]),fit=fitRanchQuantities(f.model,f.group,1,f.caps,{objective:'coins',targetCoins:300,coinTolerance:0,targetWorkMinutes:500,productMax:12,timeLimitMs:1000});
  const best=fit.recommendations[0],balance=orderCoinBalance(f.model,best.group);assert(fit.within);assert.equal(balance.total,300);assert(balance.values.every(v=>v>=60&&v<=90));assert(best.result.proven);assert.equal(best.result.optimalMinutes,solveRanchGroup(f.model,best.group,1,f.caps).optimalMinutes);
});
test('time objective also enforces gold shares and never silently adds a work-share constraint',()=>{
  const f=fixture([10,10,10,10],[1,2,3,30]),fit=fitRanchQuantities(f.model,f.group,1,f.caps,{targetMinutes:60,toleranceMinutes:0,targetWorkMinutes:72,productMax:4,timeLimitMs:1000});
  assert(fit.within);for(const v of fit.recommendations){assert(orderCoinBalance(f.model,v.group).valid);assert(v.result.orderCoinBalanced);}
  const quantities=fit.recommendations[0].group.slots.map(v=>v.quantity);assert(quantities.every(q=>q===quantities[0]));
});
test('missing and zero prices never fabricate valid shares; repeated goods have equal values',()=>{
  const f=fixture([1,1,1,1]);f.model.by.get(1).coinValue=null;assert.equal(orderCoinBalance(f.model,f.group).priced,false);assert.equal(orderCoinBalance(f.model,f.group).total,null);assert(!orderCoinBalance(f.model,f.group).valid);
  f.model.by.get(1).coinValue=0;assert(!orderCoinBalance(f.model,f.group).valid);assert.equal(orderCoinBalance(f.model,f.group).values[0],0);
  const repeat=quantityGroup({slots:Array.from({length:4},()=>({id:2,quantity:3}))},[3,3,3,3]);assert.deepEqual(orderCoinBalance(f.model,repeat).shares,[.25,.25,.25,.25]);
});
test('old work-rule inputs migrate as numeric gold bounds without writes, with new inputs taking priority',()=>{
  const map=new Map([['project',JSON.stringify({cropQuantity:8,orderWorkMinPercent:18,orderWorkMaxPercent:32})]]),storage={getItem:k=>map.get(k)??null,setItem:()=>{throw Error('unexpected write');}},before=[...map];
  const migrated=readRanchSettings(storage,'project');assert.equal(migrated.cropQuantity,8);assert.equal(migrated.orderCoinMinPercent,18);assert.equal(migrated.orderCoinMaxPercent,32);assert.deepEqual([...map],before);
  map.set(RANCH_QUANTITY_RULES_KEY,JSON.stringify({origin:'user',orderWorkMinPercent:15,orderWorkMaxPercent:35}));map.set('project',JSON.stringify({orderCoinMinPercent:22,orderCoinMaxPercent:28}));const newer=readRanchSettings(storage,'project');assert.equal(newer.orderCoinMinPercent,22);assert.equal(newer.orderCoinMaxPercent,28);
  for(const rules of [{orderCoinMinPercent:26},{orderCoinMaxPercent:24},{orderCoinMinPercent:0},{orderCoinMaxPercent:101}])assert.throws(()=>ranchCoinRules(rules));
});
test('cached work-share failures do not block valid gold-balanced orders; exact schedules and inputs survive',async()=>{
  const f=fixture([75,75,75,75],[1,7,100,1000]),values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};f.model.base.products.forEach(p=>p.buildingId=1);f.model.base.sources=[{id:1,name:'B',level:1}];writeSharedChainSource(f.model.base,'synthetic.xlsx',storage);
  let cached=null;const deps={storage,loadCache:async()=>cached,workerFactory:()=>{throw Error('must not fit on load');}},first=await loadRanchWorkspace(deps);saveRanchObjective(first,'coins');
  const group=first.plans[0].groups.find(g=>g.slots.map(v=>v.id).join(',')==='1,2,3,4'),result=solveRanchGroup(first.model,group,1,first.plans[0].capacities);
  cached={version:2,results:[[group.key,result]],quantityFits:[[group.id,{error:'每单累计工时占比不符合当前约束'}]],failures:[]};const before=[...values],loaded=await loadRanchWorkspace(deps);
  assert.deepEqual([...values],before);assert.equal(loaded.plans[0].results.get(group.key).optimalMinutes,result.optimalMinutes);assert(!loaded.plans[0].quantityErrors.has(group.id));assert(!loaded.plans[0].quantityFits.has(group.id));
});
test('price changes invalidate fitting even when the old group total gold stays the same',()=>{
  const f=fixture([10,10,10,10],[2,2,2,2]),fit=fitRanchQuantities(f.model,f.group,1,f.caps,{targetMinutes:2,toleranceMinutes:0,targetWorkMinutes:8,productMax:1}),group=fit.recommendations[0].group,key=ranchQuantityFitKey(f.model,group,f.caps,fit.options);
  assert(ranchFitIsCurrent(fit,group,fit.options,f.model));f.model.by.get(1).coinValue=9;f.model.by.get(2).coinValue=11;assert(orderCoinBalance(f.model,group).valid);assert.equal(orderCoinBalance(f.model,group).total,40);assert(!ranchFitIsCurrent(fit,group,fit.options,f.model));assert.notEqual(key,ranchQuantityFitKey(f.model,group,f.caps,fit.options));
  const old={...fit,options:{...fit.options,orderShareMetric:undefined}};assert.throws(()=>reuseRanchQuantityFit(old,group,f.caps,f.model),/金币占比/);
});
