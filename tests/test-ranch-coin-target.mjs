import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRanch} from '../orders/ranch-engine.js';
import {ranchCoinCandidates} from '../orders/ranch-coin-candidates.js';
import {quantityOptions,ranchQuantityProfile,fitRanchQuantities,orderCoinBalance,ranchQuantityFitKey} from '../orders/ranch-quantity.js';
import {ranchOrderAdmission} from '../orders/ranch-actual-orders.js';
import {ranchFitIsCurrent,loadRanchWorkspace,saveRanchObjective,readRanchTarget} from '../orders/ranch-workspace.js';
import {writeSharedChainSource} from '../orders/shared-chain-source.js';

const product=(id,price,time=10)=>({id,name:'P'+id,level:1,buildingId:1,buildingName:'工坊',stepMinutes:time,coinValue:price,inputs:[],analysisBatchYield:1});
const base=products=>({maxLevel:1,products,sources:[{id:1,name:'工坊',level:1}],landsByLevel:{1:6}});
const group=ids=>({id:'G',key:'G',types:['building'],familyIds:['b1'],slots:ids.map(id=>({id,quantity:1}))});
test('gold candidate search matches an independent full integer oracle including repeats and decimal prices',()=>{
  for(let seed=1;seed<=30;seed++){
    const m=prepareRanch(base([1,2,3,4].map(id=>product(id,((seed*id*7)%19+1)/2,(seed*id*3)%13+2)))),ids=seed%3===0?[1,1,2,3]:[1,2,3,4],g=group(ids),o=quantityOptions({objective:'coins',targetCoins:seed*4+7,coinTolerance:0,productMax:5,targetWorkMinutes:190}),p=ranchQuantityProfile(m,g,{1:1});
    let best=Infinity;
    for(let a=1;a<=5;a++)for(let b=1;b<=5;b++)for(let c=1;c<=5;c++)for(let d=1;d<=5;d++){
      const q=[a,b,c,d];if(ids.some((id,i)=>ids.some((other,j)=>other===id&&q[i]!==q[j])))continue;
      const candidate={...g,slots:g.slots.map((v,i)=>({...v,quantity:q[i]}))};if(!orderCoinBalance(m,candidate,o).valid)continue;
      const coins=q.reduce((s,n,i)=>s+n*m.by.get(ids[i]).coinValue,0);best=Math.min(best,Math.abs(coins-o.targetCoins));
    }
    if(best===Infinity){assert.throws(()=>ranchCoinCandidates(m,g,p,o));continue;}const pool=ranchCoinCandidates(m,g,p,o);
    assert(Math.abs(pool.candidates[0].score[0]-best)<1e-8,`seed ${seed}`);
  }
});
test('300 gold replaces the six-hour goal and still calculates a proven joint optimum',()=>{
  const m=prepareRanch(base([product(1,15,90)])),g=group([1,1,1,1]),options={objective:'coins',targetCoins:300,coinTolerance:0,targetWorkMinutes:1800,productMax:12,targetMinutes:360,toleranceMinutes:30};
  const fit=fitRanchQuantities(m,g,1,{1:1},options),best=fit.recommendations[0];
  assert.deepEqual(best.group.slots.map(v=>v.quantity),[5,5,5,5]);assert.equal(best.result.coinValue,300);assert.equal(best.result.optimalMinutes,1800);assert(best.result.proven);assert(fit.within);
  assert(ranchOrderAdmission(best.group,{result:best.result,model:m,target:{objective:'coins',targetCoins:'300',coinTolerance:'0',fitProductMax:'12'}}).accepted);
  assert.equal(ranchOrderAdmission(best.group,{result:best.result,model:m,target:{targetHours:'6',targetTolerance:'30',fitProductMax:'12'}}).accepted,false);
  const key=ranchQuantityFitKey(m,g,{1:1},fit.options);m.by.get(1).coinValue=16;assert.notEqual(ranchQuantityFitKey(m,g,{1:1},fit.options),key);
  assert.equal(ranchFitIsCurrent(fit,best.group,fit.options,m),false);
});
test('missing prices fail visibly and an unreachable exact target does not become an admitted order',()=>{
  const m=prepareRanch(base([product(1,null)])),g=group([1,1,1,1]),o={objective:'coins',targetCoins:300,coinTolerance:0};
  assert.throws(()=>fitRanchQuantities(m,g,1,{1:1},o),/金币单价/);
  m.by.get(1).coinValue=7;const fit=fitRanchQuantities(m,g,1,{1:1},{...o,targetWorkMinutes:400});assert.equal(fit.within,false);
  assert.equal(ranchOrderAdmission(fit.recommendations[0].group,{result:fit.recommendations[0].result,model:m,target:{...o,fitProductMax:12}}).accepted,false);
});
test('objective switching persists independently and preserves time targets and user quantities',async()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},b=base([product(1,15)]);
  writeSharedChainSource(b,'test.xlsx',storage);const deps={storage,loadCache:async()=>null,workerFactory:()=>{throw Error('must not solve');}},ws=await loadRanchWorkspace(deps);
  const before=structuredClone(ws.plans.map(p=>p.groups));saveRanchObjective(ws,'coins');const loaded=await loadRanchWorkspace(deps),target=readRanchTarget(loaded.settings,1);
  assert.equal(target.objective,'coins');assert.equal(target.targetCoins,'300');assert.equal(target.targetHours,'6');assert.deepEqual(loaded.plans.map(p=>p.groups),before);
  saveRanchObjective(loaded,'time');assert.equal(readRanchTarget(loaded.settings,1).targetHours,'6');
});
