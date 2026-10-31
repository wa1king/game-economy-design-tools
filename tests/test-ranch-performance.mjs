import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareRanch,solveRanchGroup,expandRanchTasks,validateRanchSchedule} from '../orders/ranch-engine.js';
import {fitRanchQuantities,quantityCandidates,quantityOptions,ranchQuantityFitKey,reuseRanchQuantityFit,quantityGroup} from '../orders/ranch-quantity.js';
const product=(id,buildingId,time,inputs=[])=>({id,name:'商品'+id,buildingId,buildingName:'来源'+buildingId,level:1,isCrop:buildingId===0,stepMinutes:time,analysisBatchYield:1,inputs:inputs.map(([id,quantity])=>({id,quantity}))});
const base={maxLevel:1,sources:[{id:0,name:'农田',level:1},{id:1,name:'工坊',level:1}],products:[product(1,0,2),product(2,1,5,[[1,2]])]};
const group={id:'four',slots:Array.from({length:4},()=>({id:2,quantity:15}))};
test('cached resource calendars retain a provable optimum for a dense shared production chain',()=>{
  const model=prepareRanch(base),caps={0:12,1:3},result=solveRanchGroup(model,group,1,caps);
  assert.equal(result.taskCount,180);assert.equal(result.optimalMinutes,102);assert.equal(result.totalMinutes,540);
  const expanded=expandRanchTasks(model,group,1,caps),starts=Array(expanded.tasks.length);for(const task of result.schedule)starts[task.id]=Math.round(task.start*expanded.scale);
  assert(validateRanchSchedule(expanded.tasks,expanded.edges,starts,caps));
});
test('a mathematical time lower bound rejects impossible quantity ranges before enumerating candidates',()=>{
  const model=prepareRanch({...base,products:[product(1,0,500),product(2,1,5,[[1,2]])]}),g=quantityGroup(group,[1,1,1,1]);
  const pool=quantityCandidates(model,g,{0:12,1:1},quantityOptions({targetMinutes:360,toleranceMinutes:30}),null);
  assert.equal(pool.considered,1);assert.deepEqual(pool.quantities,[[1,1,1,1]]);
});
test('fit reuse depends on recipes, active capacity and targets, independent of unused buildings or initial counts',()=>{
  const model=prepareRanch(base),caps={0:12,1:3},options=quantityOptions(),key=ranchQuantityFitKey(model,group,caps,options);
  assert.equal(ranchQuantityFitKey(model,quantityGroup(group,[1,2,3,4]),{...caps,99:8},options),key);
  assert.notEqual(ranchQuantityFitKey(model,group,{...caps,1:2},options),key);
  assert.notEqual(ranchQuantityFitKey(model,group,caps,{...options,targetMinutes:400}),key);
  const changed=structuredClone(base);changed.products[1].inputs[0].quantity=3;assert.notEqual(ranchQuantityFitKey(prepareRanch(changed),group,caps,options),key);
  const result=solveRanchGroup(model,group,1,caps),fit={options,recommendations:[{group,result}]},target={...group,id:'other-level'};
  const reused=reuseRanchQuantityFit(fit,target,{...caps,99:8});assert.equal(reused.recommendations[0].group.id,'other-level');assert.equal(reused.recommendations[0].result.optimalMinutes,result.optimalMinutes);assert.equal(reused.recommendations[0].result.assumptions.capacities[99],8);
  assert.equal(fit.recommendations[0].group.id,'four');
});
test('ranch UI offers goal-driven calculation without a current-quantity mode',()=>{
  for(const name of ['ranch-config.html','ranch-distribution.html','ranch.html']){
    const html=fs.readFileSync(new URL('../orders/'+name,import.meta.url),'utf8');assert(!html.includes('按当前数量'));assert(!html.includes('id="scheduleRanchLevels"'));assert(!html.includes('id="solveOne"'));assert(html.includes('按目标配量并计算'));
  }
});

test('measured schedule feedback finds a nearby integer quantity missed by the resource-bound predictor',()=>{
  const b={...base,products:[product(1,0,35),product(2,1,60,[[1,1]])]},m=prepareRanch(b),g=quantityGroup(group,[1,1,1,1]),fit=fitRanchQuantities(m,g,1,{0:30,1:1},{targetMinutes:360,toleranceMinutes:30,targetWorkMinutes:1000,timeLimitMs:2000});
  assert.equal(fit.within,true);assert.equal(fit.recommendations[0].result.optimalMinutes,335);assert.equal(fit.recommendations[0].group.slots.reduce((n,v)=>n+v.quantity,0),5);
});
