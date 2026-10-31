import test from 'node:test';
import assert from 'node:assert/strict';
import {ranchOrderAdmission,ranchActualGroups} from '../orders/ranch-actual-orders.js';
import {ranchDashboardRows,ranchDashboardSummary} from '../orders/ranch-distribution.js';

const target={targetHours:'6',targetTolerance:'30'},g=(id)=>({id,key:id,types:['building','chain'],slots:[1,2,3,4].map(id=>({id,quantity:1}))});
const result={proven:true,optimalMinutes:360},balance={valid:true},accept=(group,opts={})=>ranchOrderAdmission(group,{target,result,balance,...opts});
test('admission requires a proven time in the inclusive current target band',()=>{
  for(const time of [330,360,390])assert(accept(g('ok'),{result:{...result,optimalMinutes:time}}).accepted);
  for(const time of [329,391])assert.equal(accept(g('out'),{result:{...result,optimalMinutes:time}}).state,'outside');
  assert.equal(accept(g('pending'),{result:null}).accepted,false);
  assert.equal(accept(g('bounded'),{result:{proven:false,lowerMinutes:359,feasibleMinutes:360}}).accepted,false);
  assert.equal(accept(g('none'),{target:{}}).accepted,false);
});
test('old optima and fit.within flags cannot override current quantity constraints or errors',()=>{
  assert.equal(accept(g('bad'),{balance:{valid:false}}).accepted,false);
  assert.equal(accept(g('unknown'),{balance:undefined}).accepted,false);
  assert.equal(accept(g('error'),{error:'配量失败'}).accepted,false);
  assert.equal(accept(g('capacity'),{capacityError:'缺少产能'}).accepted,false);
  const group=g('repeated');group.slots[1]={id:1,quantity:2};assert.equal(accept(group).accepted,false);
});
test('all outcome statistics use the same admitted population, deduplicate overlapping types and preserve presets',()=>{
  const groups=['ok','outside','bounded','pending','badshare','fiterror'].map(g),plan={level:1,groups,results:new Map(),failures:new Map(),quantityErrors:new Map([['fiterror','配量失败']]),orderWorkBalance:new Map(),metrics:new Map(),work:new Map()};
  for(const group of groups){plan.results.set(group.key,{...result});plan.orderWorkBalance.set(group.key,{valid:group.id!=='badshare'});plan.metrics.set(group.key,{complexity:group.id==='ok'?4:999,coinValue:group.id==='ok'?80:9999});plan.work.set(group.key,group.id==='ok'?1000:9999);}
  plan.results.set('outside',{...result,optimalMinutes:400});plan.results.set('bounded',{proven:false,lowerMinutes:300,feasibleMinutes:360});plan.results.delete('pending');
  const before=structuredClone(plan),rows=ranchDashboardRows([plan],{1:target}),summary=ranchDashboardSummary([plan],{1:target});
  assert.deepEqual(ranchActualGroups(plan,target).map(g=>g.id),['ok']);
  for(const row of rows){assert.equal(row.accepted,1);assert.equal(row.total,6);assert.equal(row.optimized.mean,360);assert.equal(row.work.mean,1000);assert.equal(row.complexity.mean,4);assert.equal(row.coins.mean,80);}
  assert.equal(summary.total,6);assert.equal(summary.accepted,1);assert.equal(summary.coins.mean,80);assert.equal(summary.excluded,5);assert.deepEqual(plan,before);
  // A target edit invalidates admission immediately, without touching schedules.
  assert.equal(ranchDashboardSummary([plan],{1:{...target,targetHours:'8'}}).accepted,0);assert.deepEqual(plan,before);
  // Missing a price cannot turn a partial price sample into an overall mean.
  plan.metrics.get('ok').coinValue=null;
  assert.equal(ranchDashboardRows([plan],{1:target})[0].coins.mean,null);
  assert.equal(ranchDashboardSummary([plan],{1:target}).coins.mean,null);
  assert.equal(ranchDashboardSummary([plan],{1:target}).accepted,1);
});
