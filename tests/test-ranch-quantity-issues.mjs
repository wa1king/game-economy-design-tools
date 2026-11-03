import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRanch,ranchCapacities} from '../orders/ranch-engine.js';
import {ranchCoinCandidates} from '../orders/ranch-coin-candidates.js';
import {quantityOptions,ranchQuantityProfile} from '../orders/ranch-quantity.js';
import {coinConstraintConflict,uniqueQuantityIssueText,isQuantityConstraintIssue} from '../orders/ranch-quantity-issues.js';
import {loadRanchWorkspace,saveRanchObjective,readRanchTarget} from '../orders/ranch-workspace.js';
import {writeSharedChainSource} from '../orders/shared-chain-source.js';
const p=(id,time,inputs=[])=>({id,name:'商品'+id,level:1,buildingId:1,buildingName:'工坊',coinValue:time,stepMinutes:time,analysisBatchYield:1,inputs});
const b=products=>({maxLevel:1,products,sources:[{id:1,name:'工坊',level:1}]});
const g=ids=>({id:'G',slots:ids.map(id=>({id,quantity:1}))});
test('cap conflict has a numeric proof and is confined to this preset',()=>{
  const m=prepareRanch(b([p(1,2),p(2,5),p(3,10),p(4,207)])),group=g([1,2,3,4]),profile=ranchQuantityProfile(m,group,{1:1}),options=quantityOptions({objective:'coins',productMax:30,targetWorkMinutes:900});
  const issue=coinConstraintConflict(m,group,profile,options);assert.equal(issue.required,69);assert.equal(issue.cap,30);assert.equal(issue.minimum,207);assert.equal(issue.unit*issue.required,138);assert(isQuantityConstraintIssue(issue.message,issue));
  assert.throws(()=>ranchCoinCandidates(m,group,profile,options),e=>e.code==='RANCH_QUANTITY_INFEASIBLE'&&e.message.includes('69')&&e.message.includes('其他组合'));
  // Inclusive boundary: the exact 69 cap has an integer 20%-30% allocation.
  const relaxed={...options,productMax:69};assert.equal(coinConstraintConflict(m,group,profile,relaxed),null);assert(ranchCoinCandidates(m,group,profile,relaxed).candidates.length);
});
test('integer infeasibility and internal task ceiling produce different diagnostics',()=>{
  const m=prepareRanch(b([p(1,1),p(2,1),p(3,1),p(4,1.1)])),group=g([1,2,3,4]),options=quantityOptions({objective:'coins',productMax:5,targetWorkMinutes:50,orderCoinMinPercent:25,orderCoinMaxPercent:25});
  assert.throws(()=>ranchCoinCandidates(m,group,ranchQuantityProfile(m,group,{1:1}),options),e=>e.code==='RANCH_QUANTITY_INFEASIBLE'&&e.message.includes('整数'));
  const large=prepareRanch(b([p(1,1),p(2,1,[{id:1,quantity:300}])])),repeat=g([2,2,2,2]);
  assert.throws(()=>ranchCoinCandidates(large,repeat,ranchQuantityProfile(large,repeat,{1:1}),quantityOptions({objective:'coins',targetWorkMinutes:1204})),e=>e.code==='RANCH_TASK_LIMIT'&&e.message.includes('1200')&&!isQuantityConstraintIssue(e.message,e.diagnostic));
});
test('legacy work-share errors are ignored without fitting or overwriting inputs',async()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},base=b([p(1,2),p(2,5),p(3,10),p(4,207)]);writeSharedChainSource(base,'synthetic.xlsx',storage);
  let cache=null,calls=0;const deps={storage,loadCache:async()=>cache,workerFactory:()=>{calls++;throw Error('unexpected fitting');}};
  const ws=await loadRanchWorkspace(deps);saveRanchObjective(ws,'coins');const group=ws.plans[0].groups.find(v=>v.slots.map(x=>x.id).join(',')==='1,2,3,4');assert(group);
  cache={version:2,results:[],failures:[],quantityFits:[[group.id,{error:'当前数量上限与单单工时占比下，没有可计算的金币配量；请调整数量上限或商品组合。'}]]};
  const before=[...values],after=await loadRanchWorkspace(deps);assert.equal(calls,0);assert.deepEqual([...values],before);assert.deepEqual(after.plans[0].groups,ws.plans[0].groups);assert.equal(readRanchTarget(after.settings,1).targetCoins,'300');assert(!after.plans[0].quantityFits.has(group.id));assert(!after.plans[0].quantityErrors.has(group.id));
});
test('repeated causes are summarized once and runtime failures stay distinct',()=>{
  assert.equal(uniqueQuantityIssueText(['A','A','B','B']),'A；B');assert.equal(isQuantityConstraintIssue('搜索预算不足'),false);assert.equal(isQuantityConstraintIssue('缺少金币单价'),false);
  assert.equal(isQuantityConstraintIssue('本预设组合受金币占比限制：商品A至少需 69 个，超过上限 30 个。'),true);
});
