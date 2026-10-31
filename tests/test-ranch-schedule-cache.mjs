import assert from 'node:assert/strict';
import {prepareRanch,expandRanchTasks,validateRanchSchedule,solveRanchGroup,groupMetrics} from '../orders/ranch-engine.js';
import {createRanchScheduleCache,solveRanchGroupCached,ranchScheduleCacheStats} from '../orders/ranch-schedule-cache.js';

const product=(id,time,buildingId,inputs=[],level=1)=>({id,name:'P'+id,stepMinutes:time,buildingId,buildingName:'B'+buildingId,level,isCrop:buildingId===0,analysisBatchYield:1,inputs:inputs.map(([id,quantity])=>({id,quantity})),coproducts:[],coinValue:id+1});
const base=products=>({products,sources:[...new Set(products.map(p=>p.buildingId))].map(id=>({id,name:id===0?'农田':'B'+id,level:1,category:id===0?'田地':'加工'})),maxLevel:20,landsByLevel:{1:2,20:30}});
const group=(ids,quantities=ids.map(()=>1),id='test')=>({id,slots:ids.map((id,i)=>({id,quantity:quantities[i]}))});
function validate(model,g,caps,result){
  const expanded=expandRanchTasks(model,g,20,caps),starts=Array(expanded.tasks.length);
  for(const task of result.schedule){
    const actual=expanded.tasks[task.id];assert.equal(task.productId,actual.productId);assert.equal(task.slot,actual.slot);assert.equal(task.resource,actual.resource);assert.equal(task.duration,actual.duration/expanded.scale);
    starts[task.id]=Math.round(task.start*expanded.scale);
  }
  assert(validateRanchSchedule(expanded.tasks,expanded.edges,starts,caps));
  assert.deepEqual(result.slotCompletionMinutes,expanded.roots.map(ids=>Math.max(...ids.map(i=>starts[i]+expanded.tasks[i].duration))/expanded.scale));
  const metrics=groupMetrics(model,g,20);for(const key of ['totalMinutes','complexity','coinValue','counts','slots','sourceMinutes'])assert.deepEqual(result[key],metrics[key]);
  assert.equal(result.optimalMinutes,Math.max(...result.schedule.map(t=>t.end)));
}
let tests=0;const test=(name,fn)=>{fn();tests++;console.log('PASS '+name);};

test('redistributed identical goods reuse a certified schedule with remapped slots',()=>{
  const model=prepareRanch(base([product(1,2,0),product(2,3,1,[[1,1]])])),caps={0:2,1:1},first=group([2,2,2,2],[1,2,3,4]),second=group([2,2,2,2],[4,3,2,1]);
  const initial=solveRanchGroupCached(model,first,20,caps);assert(initial.proven);assert(!initial.scheduleReused);
  const reused=solveRanchGroupCached(model,second,20,caps,{timeLimitMs:0,nodeLimit:0});assert(reused.scheduleReused);assert.equal(reused.nodes,0);assert.equal(reused.optimalMinutes,initial.optimalMinutes);validate(model,second,caps,reused);
  assert.notDeepEqual(initial.slotCompletionMinutes,reused.slotCompletionMinutes);assert.equal(ranchScheduleCacheStats(model).hits,1);
});
test('directly delivered ingredients remain distinct from consumed ingredients',()=>{
  const cache=createRanchScheduleCache(),model=prepareRanch(base([product(1,.2,0),product(2,1.15,1,[[1,2]])])),caps={0:2,1:1};
  const first=group([1,2,1,2],[1,2,3,4]),second=group([2,2,2,1],[2,2,2,4]);
  const initial=cache.solve(model,first,20,caps),reused=cache.solve(model,second,20,caps);assert(initial.proven);assert(reused.scheduleReused);assert.equal(reused.optimalMinutes,initial.optimalMinutes);assert.equal(reused.counts[1],16);assert.equal(reused.counts[2],6);assert.equal(reused.complexity,7);assert.equal(initial.complexity,6);validate(model,second,caps,reused);
  const target=expandRanchTasks(model,second,20,caps),consumed=new Set(target.edges.map(([a])=>a));assert(target.roots[3].every(root=>!consumed.has(root)));
});
test('reordered slots and branched decimal recipes preserve every predecessor',()=>{
  const cache=createRanchScheduleCache(),model=prepareRanch(base([product(1,.125,0),product(2,.25,1,[[1,2]]),product(3,.375,2,[[1,1],[2,2]])])),caps={0:8,1:1,2:1};
  const first=group([1,2,3,3],[2,2,1,2]),second=group([3,1,3,2],[2,2,1,2]);
  const initial=cache.solve(model,first,20,caps);assert(initial.proven);const r=cache.solve(model,second,20,caps);assert(r.scheduleReused);validate(model,second,caps,r);assert.equal(r.optimalMinutes,solveRanchGroup(model,second,20,caps).optimalMinutes);
});
test('input, duration and active capacity changes cannot hit stale certificates',()=>{
  const cache=createRanchScheduleCache(),model=prepareRanch(base([product(1,1,0),product(2,2,1,[[1,1]])])),g=group([2,2,2,2]),caps={0:4,1:1};
  assert(!cache.solve(model,g,20,caps).scheduleReused);
  assert(cache.solve(model,g,20,{...caps,99:7}).scheduleReused);
  assert(!cache.solve(model,g,20,{...caps,1:2}).scheduleReused);
  model.by.get(2).stepMinutes=3;assert(!cache.solve(model,g,20,caps).scheduleReused);
  model.by.get(2).inputs[0].quantity=2;assert(!cache.solve(model,g,20,caps).scheduleReused);
  assert(!cache.solve(model,group([2,2,2,2],[1,1,1,2]),20,caps).scheduleReused);
  assert.throws(()=>cache.solve(model,g,20,{...caps,0:0}),/容量/);
  model.by.get(2).level=3;assert.throws(()=>cache.solve(model,g,2,caps),/尚未解锁/);
});
test('current names, prices, slot complexity and assumptions are regenerated',()=>{
  const cache=createRanchScheduleCache(),model=prepareRanch(base([product(1,1,0),product(2,2,1,[[1,1]])])),g=group([2,2,2,2]),caps={0:4,1:1};
  const original=cache.solve(model,g,20,caps);original.schedule[0].start=999;original.assumptions.capacities[1]=999;
  model.by.get(2).name='已改名';model.by.get(2).coinValue=100;
  const reused=cache.solve(model,g,20,{...caps,88:8});assert(reused.scheduleReused);assert.equal(reused.coinValue,400);assert.equal(reused.slots[0].name,'已改名');assert(reused.schedule.filter(t=>t.productId===2).every(t=>t.name==='已改名'));assert.equal(reused.assumptions.capacities[88],8);assert.equal(reused.assumptions.capacities[1],1);validate(model,g,caps,reused);
});
test('unfinished searches are never cached as certified optima',()=>{
  const cache=createRanchScheduleCache(),model=prepareRanch(base([product(1,2,0),product(2,4,2,[[1,1]]),product(3,2,2,[[2,1]]),product(4,2,1,[[2,1]]),product(5,3,0,[[3,1]])])),g=group([1,2,2,5]),caps={0:1,1:2,2:2};
  const first=cache.solve(model,g,20,caps,{timeLimitMs:0}),second=cache.solve(model,g,20,caps,{timeLimitMs:0});assert.equal(first.proven,false);assert.equal(second.proven,false);assert(!second.scheduleReused);assert.equal(cache.stats(model).entries,0);
  const solved=cache.solve(model,g,20,caps);assert.equal(solved.optimalMinutes,12);assert(cache.solve(model,g,20,caps,{timeLimitMs:0}).scheduleReused);
});
test('LRU is bounded by both task count and entry count',()=>{
  const cache=createRanchScheduleCache({maxTasks:12,maxEntries:2}),model=prepareRanch(base([product(1,1,0)])),caps={0:1},g=q=>group([1,1,1,1],[1,1,1,q]);
  cache.solve(model,g(1),20,caps);cache.solve(model,g(2),20,caps);assert(cache.solve(model,g(1),20,caps).scheduleReused);
  cache.solve(model,g(3),20,caps);assert.deepEqual(cache.stats(model),{entries:2,tasks:10,hits:1,misses:3,evictions:1});
  cache.solve(model,g(2),20,caps);assert.equal(cache.stats(model).misses,4);assert(cache.stats(model).tasks<=12);
  cache.solve(model,g(10),20,caps);assert(cache.stats(model).tasks<=12);assert(!cache.solve(model,g(10),20,caps).scheduleReused);
});
test('separate prepared models never share caches',()=>{
  const cache=createRanchScheduleCache(),b=base([product(1,1,0)]),model=prepareRanch(b),other=prepareRanch(structuredClone(b)),g=group([1,1,1,1]);cache.solve(model,g,20,{0:1});assert(!cache.solve(other,g,20,{0:1}).scheduleReused);assert.equal(cache.stats(model).hits,0);
});
console.log(`${tests} ranch schedule cache regression cases passed`);
