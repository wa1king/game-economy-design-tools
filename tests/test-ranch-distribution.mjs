import assert from 'node:assert/strict';
import {buildRanchDistributionPlans,ranchDistributionRows,summarizeMinutes,renderRanchBoxPlot,renderRanchHistogram,ranchTimeBins,ranchDistributionCSV,formatMinutes,reuseRanchDistributionResult} from '../orders/ranch-distribution.js';
import {ranchImportCacheKey} from '../orders/ranch-import.js';
import {prepareRanch,solveRanchGroup} from '../orders/ranch-engine.js';
import {generateRanchLevelGroups} from '../orders/ranch-catalog.js';
const product=(id,b,level,inputs=[])=>({id,name:'P'+id,buildingId:b,buildingName:'B'+b,level,isCrop:b===0,stepMinutes:id*10,analysisBatchYield:1,coproducts:[],inputs:inputs.map(id=>({id,quantity:1})),coinValue:1});
const base={maxLevel:3,products:[product(1,0,1),product(2,0,1),product(3,10,2,[1]),product(4,10,2,[2]),product(5,20,3,[2,3]),product(6,20,3,[1,4])],sources:[{id:0,name:'农田',level:1},{id:10,name:'磨坊',level:2},{id:20,name:'厨房',level:3}],landsByLevel:{1:6,2:12,3:18}};
let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
test('statistics use equal-weight combinations and interpolated quartiles without mutating input',()=>{
  const values=[8,2,4,6],before=JSON.stringify(values),s=summarizeMinutes(values);assert.deepEqual(s,{n:4,min:2,q1:3.5,median:5,mean:5,q3:6.5,max:8});assert.equal(JSON.stringify(values),before);
  assert.equal(summarizeMinutes([]).mean,null);assert.equal(summarizeMinutes([9]).q1,9);assert.throws(()=>summarizeMinutes([NaN]),/无效/);
});
const baseline=buildRanchDistributionPlans(base),repeat=baseline[2].groups.find(g=>g.slots.every(v=>v.id===3));
const settings={level:3,cropQuantity:7,productQuantity:1,allowRepeated:false,quantityEdits:{3:{[repeat.id]:[3,2,1,1]}},capacities:{3:{10:2}},quantityTargetsByLevel:{3:{targetHours:'6'}},searchLimit:'15'};
const before=JSON.stringify({base,settings}),plans=buildRanchDistributionPlans(base,settings);
test('all levels use the shared generator, edited quantities and exact scheme cache keys',()=>{
  const model=prepareRanch(base);for(const p of plans){assert.equal(p.groups.length,generateRanchLevelGroups(model,p.level,{allowRepeated:false}).groups.length);assert.equal(p.cacheKey,ranchImportCacheKey(base,p.level,{cropQuantity:7,productQuantity:1,allowRepeated:false},p.capacities));}
  const edited=plans[2].groups.find(g=>g.id===repeat.id);assert.deepEqual(edited.slots.map(v=>v.quantity),[3,2,1,1]);assert.equal(plans[2].work.get(edited.key),7*(30+10));assert.equal(plans[2].capacities[10],2);assert.equal(plans[1].capacities[0],12);assert.equal(JSON.stringify({base,settings}),before);
});
test('unproved times and failures never become zero-time optimal samples',()=>{
  const p=plans[2],building=p.groups.filter(g=>g.types.includes('building'));
  p.results.set(building[0].key,{proven:true,optimalMinutes:80});p.results.set(building[1].key,{proven:false,optimalMinutes:null,lowerMinutes:60,feasibleMinutes:120});p.failures.set(building[2].key,'limit');
  const row=ranchDistributionRows(plans).find(r=>r.level===3&&r.type==='building');assert.equal(row.proven,1);assert.equal(row.optimized.mean,80);assert.equal(row.bounded,1);assert.equal(row.failed,1);assert.equal(row.pending,row.total-3);assert.equal(row.work.n,row.total);
  assert.equal(ranchDistributionRows(plans,'chain').length,3);assert.equal(ranchDistributionRows(plans,'chain')[0].optimized.min,null);
});
test('overlapping categories count once within each category and never weight permutations',()=>{
  const p=buildRanchDistributionPlans(base)[2],g=p.groups.find(g=>g.types.includes('chain'));g.types.push('building');
  const rows=ranchDistributionRows([p]);for(const row of rows)assert.equal(row.total,p.groups.filter(g=>g.types.includes(row.type)).length);
  assert.equal(rows.reduce((n,r)=>n+r.total,0),p.groups.length+1);
});
test('histogram bins are half-open, include maxima and normalize separately per category',()=>{
  const rows=[{type:'building',name:'同建筑',color:'#28795f',workValues:[0,29,30,60],optimizedValues:[]},{type:'chain',name:'高级加工链',color:'#a8773b',workValues:[30],optimizedValues:[]}],b=ranchTimeBins(rows,'work');
  assert.deepEqual(b.bins.map(b=>b.series[0].count),[2,1,1]);assert.deepEqual(b.bins.map(b=>b.series[1].count),[0,1,0]);for(let i=0;i<2;i++)assert.equal(b.bins.reduce((n,b)=>n+b.series[i].share,0),1);
  const large=ranchTimeBins([{...rows[0],workValues:Array(140000).fill(1e6)}],'work');assert(large.bins.length<=200);assert.equal(large.bins.reduce((n,b)=>n+b.series[0].count,0),140000);
});
test('cross-level reuse remaps quantities and animal labels without changing a certified joint optimum',()=>{
  const m=prepareRanch({maxLevel:1,products:[product(1,10,1)],sources:[{id:10,name:'B10',level:1}]}),group={slots:[3,1,1,1].map(quantity=>({id:1,quantity}))},target={slots:[1,1,1,3].map(quantity=>({id:1,quantity}))},result=solveRanchGroup(m,group,1,{10:1});
  assert(result.proven);assert.equal(result.optimalMinutes,60);const remapped=reuseRanchDistributionResult({group,result},target);assert.equal(remapped.optimalMinutes,60);for(let i=0;i<4;i++)assert.equal(remapped.schedule.filter(t=>t.slot===i).length,target.slots[i].quantity);
  assert.equal(summarizeMinutes([remapped.optimalMinutes]).mean,60);
});

test('graphs distinguish both types, expose statistics and export missing values as blanks',()=>{
  const chain=plans[2].groups.find(g=>g.types.includes('chain'));plans[2].results.set(chain.key,{proven:true,optimalMinutes:220});
  const rows=ranchDistributionRows(plans),svg=renderRanchBoxPlot(rows,'optimized'),hist=renderRanchHistogram(rows.filter(r=>r.level===3),'work'),csv=ranchDistributionCSV(rows);
  for(const html of [svg,hist]){assert(!/NaN|Infinity/.test(html));assert(html.includes('role="img"'));assert(html.includes('#28795f'));assert(html.includes('#a8773b'));}assert(svg.includes('中位'));assert(csv.includes('优化P25(分)'));assert(csv.includes('"高级加工链"'));assert(!csv.includes('"null"'));
  const noLand=structuredClone(base);noLand.landsByLevel={};assert(buildRanchDistributionPlans(noLand).every(p=>p.capacityError));
});

console.log(checks+' ranch distribution checks passed');
