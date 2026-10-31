import assert from 'node:assert/strict';
import {prepareRanch,solveRanchGroup,expandRanchTasks,validateRanchSchedule} from '../orders/ranch-engine.js';
import {quantityGroup,quantityOptions,quantityRank,fitRanchQuantities,ranchQuantityProfile,workUpperAtTime} from '../orders/ranch-quantity.js';
import {ranchChainData,renderRanchChain} from '../orders/ranch-chain.js';
const product=(id,time,buildingId,inputs=[])=>({id,name:'商品'+id,buildingId,buildingName:'建筑'+buildingId,level:1,isCrop:buildingId===0,stepMinutes:time,analysisBatchYield:1,inputs:inputs.map(([id,quantity])=>({id,quantity})),coinValue:id,coproducts:[]});
const base=products=>({products,sources:[...new Set(products.map(p=>p.buildingId))].map(id=>({id,name:'建筑'+id,level:1})),maxLevel:20});
const group=(ids,qs=[1,1,1,1])=>({id:'combo',slots:ids.map((id,i)=>({id,quantity:qs[i]})),familyIds:[],types:['building']});
let count=0;const test=(name,fn)=>{fn();console.log('PASS '+name);count++;};
test('chain graph reserves delivered upstream separately and merges common material',()=>{
  const m=prepareRanch(base([product(1,2,0),product(2,5,1,[[1,2]]),product(3,10,2,[[2,1]])])),g=group([1,2,1,3],[2,1,1,1]),before=JSON.stringify(m.base),data=ranchChainData(m,g,20),raw=data.nodes.find(n=>n.id===1);
  assert.equal(raw.count,7);assert.equal(raw.delivered,3);assert.equal(raw.consumed,4);assert.deepEqual(raw.deliverySlots,[0,2]);assert.equal(data.edges.find(e=>e.from===1).quantity,4);assert.equal(data.metrics.totalMinutes,34);assert.equal(data.metrics.complexity,7);assert.equal(JSON.stringify(m.base),before);
  assert(renderRanchChain(data).includes('data-product-id="1"'));assert(!renderRanchChain(data).includes('data-quantity='),'production counts must not be mislabeled as direct delivery quantity in a tooltip');
});
test('profile work matches full BOM and resource lower bound does not exceed optimum',()=>{
  const m=prepareRanch(base([product(1,2,0),product(2,5,1,[[1,2]]),product(3,10,2,[[2,1]])])),g=group([1,2,1,3],[2,1,1,1]),caps={0:3,1:1,2:1},p=ranchQuantityProfile(m,g,caps),r=solveRanchGroup(m,g,20,caps),e=p.estimate(g.slots.map(s=>s.quantity));
  assert.equal(e.totalMinutes,r.totalMinutes);assert.equal(e.taskCount,r.taskCount);assert(e.lowerMinutes<=r.optimalMinutes);assert.deepEqual(e.sourceMinutes,r.sourceMinutes);
});
test('time band is primary and common accumulated work is secondary within it',()=>{
  const o=quantityOptions({targetWorkMinutes:900}),candidate=(time,work)=>({group:group([1,2,3,4]),result:{proven:true,lowerMinutes:time,feasibleMinutes:time,optimalMinutes:time,totalMinutes:work}});
  assert(quantityRank(candidate(330,900),o)[1]<quantityRank(candidate(360,1100),o)[1]);assert(quantityRank(candidate(320,900),o)[0]>quantityRank(candidate(360,1100),o)[0]);assert(quantityRank(candidate(360,900),o)[0]===0);
});
test('joint quantity fitting reaches 120 minutes and common 300 resource minutes',()=>{
  const m=prepareRanch(base([product(1,10,1),product(2,20,2),product(3,30,3),product(4,40,4)])),g=group([1,2,3,4]),caps={1:1,2:1,3:1,4:1},before=JSON.stringify(g),r=solveRanchGroup(m,g,20,caps),fit=fitRanchQuantities(m,g,20,caps,{targetMinutes:120,toleranceMinutes:0,targetWorkMinutes:300,productMax:6,cropMax:6,timeLimitMs:4000},r),best=fit.recommendations[0];
  assert.equal(best.result.optimalMinutes,120);assert.equal(best.result.totalMinutes,300);assert.equal(fit.within,true);assert.equal(fit.quantitySearchProven,false);assert.equal(JSON.stringify(g),before);
  for(const v of fit.recommendations){assert(v.group.slots.every(s=>s.quantity>=1&&s.quantity<=6));const t=expandRanchTasks(m,v.group,20,caps),starts=Array(t.tasks.length);for(const task of v.result.schedule)starts[task.id]=Math.round(task.start*t.scale);assert(validateRanchSchedule(t.tasks,t.edges,starts,caps));assert.equal(solveRanchGroup(m,v.group,20,caps).optimalMinutes,v.result.optimalMinutes);}
});
test('same building queues quantities rather than summing isolated optimal times',()=>{
  const m=prepareRanch(base([product(1,10,1),product(2,20,1),product(3,30,1),product(4,40,1)])),g=group([1,2,3,4]),fit=fitRanchQuantities(m,g,20,{1:1},{targetMinutes:120,toleranceMinutes:0,targetWorkMinutes:120,productMax:3,timeLimitMs:2000});
  assert.equal(fit.recommendations[0].result.optimalMinutes,120);assert.equal(fit.recommendations[0].result.totalMinutes,120);
});
test('four identical products keep four quantities while sharing one workshop queue',()=>{
  const m=prepareRanch(base([product(1,10,1)])),g=group([1,1,1,1]),caps={1:1},fit=fitRanchQuantities(m,g,20,caps,{targetMinutes:80,toleranceMinutes:0,targetWorkMinutes:80,productMax:3,timeLimitMs:2000}),best=fit.recommendations[0];
  assert.equal(best.result.optimalMinutes,80);assert.equal(best.result.totalMinutes,80);assert.equal(best.result.complexity,4);assert.equal(best.result.coinValue,8);
  assert.equal(best.group.slots.length,4);assert.deepEqual(best.group.slots.map(s=>s.quantity),[2,2,2,2]);
});

test('baseline outside the quantity bounds cannot become a recommendation',()=>{
  const m=prepareRanch(base([product(1,10,1),product(2,20,2),product(3,30,3),product(4,40,4)])),g=group([1,2,3,4],[9,9,9,9]),caps={1:1,2:1,3:1,4:1},fit=fitRanchQuantities(m,g,20,caps,{productMax:2,targetWorkMinutes:300,timeLimitMs:2000},solveRanchGroup(m,g,20,caps));assert(fit.recommendations.every(v=>v.group.slots.every(s=>s.quantity<=2)));
});
test('minimum already too slow gives a valid reason and no false target hit',()=>{
  const m=prepareRanch(base([product(1,100,1),product(2,100,1),product(3,100,1),product(4,100,1)])),fit=fitRanchQuantities(m,group([1,2,3,4]),20,{1:1},{productMax:2,targetWorkMinutes:400,timeLimitMs:2000});assert.equal(fit.within,false);assert(fit.reason.includes('各1个'));assert.equal(fit.recommendations[0].result.optimalMinutes,400);
});
test('invalid targets and quantity edits fail before changing a group',()=>{
  assert.throws(()=>quantityOptions({targetMinutes:0}),/大于0/);assert.throws(()=>quantityOptions({toleranceMinutes:360}),/偏差/);assert.throws(()=>quantityOptions({productMax:0}),/上限/);assert.throws(()=>quantityGroup(group([1,2,3,4]),[1,0,1,1]),/正整数/);
});
test('resource-work upper bound never excludes feasible integer quantities',()=>{
  const m=prepareRanch(base([product(1,10,1),product(2,20,2),product(3,30,3),product(4,40,4)])),g=group([1,2,3,4]),caps={1:1,2:1,3:1,4:1},profile=ranchQuantityProfile(m,g,caps),upper=workUpperAtTime(profile,caps,[6,6,6,6],120);
  assert(upper>=420&&upper<=421);for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)for(let d=1;d<=6;d++){const q=[a,b,c,d],e=profile.estimate(q);if(e.lowerMinutes<=120)assert(e.totalMinutes<=upper);}
});
console.log(count+' chain and quantity fitting checks passed');
