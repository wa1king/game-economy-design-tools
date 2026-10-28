import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildRanchDistributionPlans,ranchDistributionRows,summarizeMinutes,renderRanchBoxPlot,renderRanchHistogram,ranchTimeBins,ranchDistributionCSV,formatMinutes,reuseRanchDistributionResult} from '../orders/ranch-distribution.js';
import {ranchSettingsKey,ranchImportCacheKey} from '../orders/ranch-import.js';
import {prepareRanch,ranchCapacities,solveRanchGroup} from '../orders/ranch-engine.js';
import {generateRanchLevelGroups} from '../orders/ranch-catalog.js';
import {createProjectStore} from '../orders/project-storage.js';
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

// Isolated DOM/event simulation. Never accesses a real browser or user storage.
const html=fs.readFileSync(new URL('../orders/ranch-distribution.html',import.meta.url),'utf8'),app=fs.readFileSync(new URL('../orders/ranch-distribution-app.js',import.meta.url),'utf8'),elements=new Map();
class Element{constructor(){this.value='';this.hidden=false;this.disabled=false;this.innerHTML='';this.textContent='';this.dataset={};this.classList={toggle(){}};}setAttribute(){}scrollIntoView(){}click(){}}
for(const match of html.matchAll(/\bid="([^"]+)"/g)){assert(!elements.has(match[1]));elements.set(match[1],new Element());}
for(const match of app.matchAll(/\$\('([^']+)'\)/g))assert(elements.has(match[1]),'missing '+match[1]);
const source=JSON.stringify({kind:'import',base,filename:'test.xlsx'}),memory=new Map([['ranch-source-v1',source],[ranchSettingsKey(base),JSON.stringify(settings)]]),initialMemory=JSON.stringify([...memory]),cache=new Map(),workers=[],typeButtons=['all','building','chain'].map(type=>{const e=new Element();e.dataset.type=type;return e;});
let lastCSV='';const context=vm.createContext({console,structuredClone,buildRanchDistributionPlans,ranchDistributionRows,renderRanchBoxPlot,renderRanchHistogram,ranchDistributionCSV,formatMinutes,reuseRanchDistributionResult,ranchSettingsKey,createProjectStore,
  localStorage:{getItem:k=>memory.get(k)??null},loadRanchCache:async k=>structuredClone(cache.get(k)),saveRanchCache:async(k,v)=>cache.set(k,structuredClone(v)),
  document:{getElementById:id=>elements.get(id),querySelectorAll:()=>typeButtons,createElement:()=>new Element()},performance:{now:()=>2000},setTimeout:()=>{},URL:{createObjectURL:()=>'',revokeObjectURL(){}},Blob:class{constructor(parts){lastCSV=parts.join('');}},
  Worker:class{constructor(){workers.push(this);}postMessage(data){this.data=data;}terminate(){this.terminated=true;}}
});
vm.runInContext(app.replace(/^import .*;\r?\n/gm,''),context);
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};await flush();
test('overview reads all levels without launching a solver or overwriting source/settings',()=>{
  assert.equal(elements.get('distributionError').hidden,true);assert.equal(elements.get('distributionWorkspace').hidden,false);assert.equal(workers.length,0);assert.equal(vm.runInContext('plans.length',context),3);assert.equal(elements.get('distributionLevel').value,'3');assert.equal(JSON.stringify([...memory]),initialMemory);assert(elements.get('distributionRows').innerHTML.includes('高级加工链'));
});
test('type and level controls update distributions independently of scheme navigation',()=>{
  typeButtons[2].onclick();assert(!elements.get('distributionRows').innerHTML.includes('distribution-type-building'));elements.get('distributionLevel').value='1';elements.get('distributionLevel').onchange();assert(elements.get('workHistogram').innerHTML.includes('暂无'));typeButtons[0].onclick();
});
const pending=elements.get('calculateDistribution').onclick();await flush();
const first=workers.at(-1),item=first.data.groups[0],key=vm.runInContext('plans.find(p=>p.groups.length).cacheKey',context);
// A concurrently updated recommendation must survive this page's cache write.
cache.set(key,{version:2,results:[],failures:[],quantityFits:[['keep',{note:'recommendation'}]]});
first.onmessage({data:{type:'result',id:item.id,result:{proven:true,optimalMinutes:70},index:1,total:first.data.groups.length}});
elements.get('pauseDistribution').onclick();await pending;await vm.runInContext('cacheQueue',context);
test('pausing preserves partial certified results and existing quantity recommendations',()=>{
  assert(first.terminated);assert.equal(cache.get(key).results.length,1);assert.deepEqual(cache.get(key).quantityFits,[['keep',{note:'recommendation'}]]);assert.equal(elements.get('calculateDistribution').disabled,false);assert.equal(JSON.stringify([...memory]),initialMemory);
});
// Resume and drive every worker result without timing-sensitive browser machinery.
const resumed=elements.get('calculateDistribution').onclick();await flush();
for(let turn=0;turn<10&&vm.runInContext('running',context);turn++){
  const w=workers.at(-1);for(const [i,g] of w.data.groups.entries())w.onmessage({data:{type:'result',id:g.id,result:{proven:true,optimalMinutes:90},index:i+1,total:w.data.groups.length}});
  w.onmessage({data:{type:'done'}});await flush();
}
await resumed;await vm.runInContext('cacheQueue',context);
test('all-level worker processing completes, persists and exports both categories',()=>{
  assert.equal(vm.runInContext('running',context),false);assert.equal(vm.runInContext('plans.every(p=>p.groups.every(g=>proven(p.results.get(g.key))))',context),true);assert.equal(cache.size,3);elements.get('downloadDistribution').onclick();assert(lastCSV.includes('同建筑'));assert(lastCSV.includes('高级加工链'));assert.equal(JSON.stringify([...memory]),initialMemory);
});
console.log(checks+' ranch distribution checks passed');
