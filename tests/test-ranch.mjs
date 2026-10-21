import assert from 'node:assert/strict';
import {prepareRanch,ranchCapacities,ranchFamilies,generateRanchGroups,groupMetrics,solveRanchGroup,expandRanchTasks,validateRanchSchedule} from '../orders/ranch-engine.js';
const product=(id,time,buildingId,inputs=[],level=1)=>({id,name:'P'+id,stepMinutes:time,buildingId,buildingName:'B'+buildingId,level,isCrop:buildingId===0,analysisBatchYield:1,inputs:inputs.map(([id,quantity])=>({id,quantity})),coproducts:[],coinValue:id+1});
const base=products=>({products,sources:[...new Set(products.map(p=>p.buildingId))].map(id=>({id,name:id===0?'农田':'B'+id,level:1,category:id===0?'田地':'加工'})),maxLevel:20,landsByLevel:{1:2,20:30}});
const group=(ids,quantities=ids.map(()=>1))=>({id:'test',slots:ids.map((id,i)=>({id,quantity:quantities[i]}))});
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
test('same building is serialized across all four slots',()=>{
 const m=prepareRanch(base([product(1,10,1),product(2,20,1),product(3,30,1),product(4,40,1)]));
 const g=group([1,2,3,4]),before=JSON.stringify(m.base),r=solveRanchGroup(m,g,20,{1:1});
 assert.equal(r.optimalMinutes,100);assert.equal(r.totalMinutes,100);assert.equal(r.complexity,4);assert.equal(JSON.stringify(m.base),before);
 assert.equal(solveRanchGroup(m,g,20,{1:2}).optimalMinutes,50);
});
test('independent buildings overlap instead of summing individual durations',()=>{
 const m=prepareRanch(base([product(1,10,1),product(2,20,2),product(3,30,3),product(4,40,4)]));
 const r=solveRanchGroup(m,group([1,2,3,4]),20,{1:1,2:1,3:1,4:1});assert.equal(r.optimalMinutes,40);assert.equal(r.totalMinutes,100);
});
test('four orders share upstream and downstream capacity',()=>{
 const m=prepareRanch(base([product(1,10,1),product(2,20,2,[[1,1]])]));
 const r=solveRanchGroup(m,group([2,2,2,2]),20,{1:1,2:1});assert.equal(r.optimalMinutes,90);assert.equal(r.totalMinutes,120);assert.equal(r.taskCount,8);
});
test('delivered upstream goods are reserved, not consumed again',()=>{
 const m=prepareRanch(base([product(1,10,1),product(2,20,2,[[1,1]])]));const g=group([1,2,1,2]);
 const r=solveRanchGroup(m,g,20,{1:1,2:1});assert.equal(r.optimalMinutes,50);assert.equal(r.counts[1],4);assert.equal(r.counts[2],2);assert.equal(r.totalMinutes,80);assert.equal(r.coinValue,10);assert.equal(r.complexity,6);
 assert.equal(solveRanchGroup(m,g,20,{1:2,2:2}).optimalMinutes,30);
});
test('multiple requested copies are counted and farmland capacity matters',()=>{
 const m=prepareRanch(base([product(1,5,0)])),g=group([1,1,1,1],[2,2,2,2]);
 assert.equal(solveRanchGroup(m,g,20,{0:2}).optimalMinutes,20);assert.equal(groupMetrics(m,g,20).totalMinutes,40);assert.equal(ranchCapacities(m,20)[0],30);
});
test('fractional time stays exact',()=>{
 const m=prepareRanch(base([product(1,.5,0),product(2,1.25,1,[[1,1]])]));const r=solveRanchGroup(m,group([2,2,2,2]),20,{0:4,1:1});assert.equal(r.optimalMinutes,5.5);
});
test('missing coin prices remain unavailable; zero is valid',()=>{
 const b=base([product(1,1,0)]);b.products[0].coinValue=null;const m=prepareRanch(b);assert.equal(groupMetrics(m,group([1,1,1,1]),20).coinValue,null);m.by.get(1).coinValue=0;assert.equal(groupMetrics(m,group([1,1,1,1]),20).coinValue,0);
});
test('ranch generators allow same-building and direct ancestry unlike normal orders',()=>{
 const m=prepareRanch(base([product(1,1,0),product(2,2,1,[[1,1]],2),product(3,3,1,[[2,1]],3),product(4,4,1,[[1,1]],3),product(5,5,1,[[1,1]],3)]));
 const buildings=ranchFamilies(m,3,'building');assert.equal(buildings.length,1);const g=generateRanchGroups(m,buildings[0],{allowRepeated:false});assert.equal(g.length,1);assert.deepEqual(g[0].slots.map(v=>v.id),[2,3,4,5]);
 const f=ranchFamilies(m,3,'chain').find(v=>v.anchorId===3);assert.deepEqual(f.productIds,[1,2,3]);assert.equal(generateRanchGroups(m,f,{allowRepeated:false}).length,0);
 const repeated=generateRanchGroups(m,f,{allowRepeated:true});assert(repeated.length>0);assert(repeated.every(g=>g.slots.some(v=>v.id===3)&&new Set(g.slots.map(v=>v.id)).size>=2));
 assert.throws(()=>generateRanchGroups(m,buildings[0],{allowRepeated:true,limit:1}),/未截断/);
});
test('bad quantities, capacities, levels, and multi-output recipes are rejected',()=>{
 const b=base([product(1,1,0),product(2,1,1,[[1,1]],2)]),m=prepareRanch(b);assert.throws(()=>solveRanchGroup(m,group([1,1,1,1]),20,{0:0}),/容量/);assert.throws(()=>solveRanchGroup(m,group([2,2,2,2]),1,{0:2,1:1}),/尚未解锁/);
 assert.throws(()=>groupMetrics(m,group([1,1,1,1],[1,1,1,0]),20),/正整数/);b.products[0].analysisBatchYield=2;assert.throws(()=>prepareRanch(b),/多产出/);
});
test('certificates validate resource and predecessor constraints',()=>{
 const m=prepareRanch(base([product(1,2,0),product(2,3,1,[[1,2]])])),g=group([1,2,1,2]),caps={0:2,1:1},r=solveRanchGroup(m,g,20,caps),t=expandRanchTasks(m,g,20,caps);
 const starts=Array(t.tasks.length);for(const row of r.schedule)starts[row.id]=Math.round(row.start*t.scale);assert(validateRanchSchedule(t.tasks,t.edges,starts,caps));assert.throws(()=>validateRanchSchedule(t.tasks,t.edges,starts.map(()=>0),caps),/原料/);
});
test('unfinished exact search returns bounds instead of a false optimum',()=>{
 const ps=[product(1,2,0),product(2,1,3,[[1,1]]),product(3,3,2,[[2,1],[1,1]]),product(4,2,1,[[2,1]]),product(5,1,2,[[3,1],[4,1]])];
 const m=prepareRanch(base(ps)),g=group([5,1,1,1]),caps={0:2,1:1,2:1,3:1};
 const stopped=solveRanchGroup(m,g,20,caps,{timeLimitMs:0});assert.equal(stopped.optimalMinutes,null);assert.equal(stopped.proven,false);assert(stopped.lowerMinutes<=8&&stopped.feasibleMinutes>=8);
 const solved=solveRanchGroup(m,g,20,caps);assert.equal(solved.optimalMinutes,8);assert(solved.nodes>0);
});
console.log(count+' ranch regression cases passed');
