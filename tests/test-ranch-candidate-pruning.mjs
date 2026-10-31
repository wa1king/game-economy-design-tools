import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareRanch,groupMetrics} from '../orders/ranch-engine.js';
import {quantityCandidateDominated,quantityEndpointDominated,quantityGroup,quantityOptions,quantityRank,fitRanchQuantities} from '../orders/ranch-quantity.js';
const compare=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};
const product=(id,time,buildingId,inputs=[])=>({id,name:'P'+id,buildingId,buildingName:'B'+buildingId,level:1,isCrop:false,stepMinutes:time,analysisBatchYield:1,inputs:inputs.map(([id,quantity])=>({id,quantity}))});
const base=products=>({maxLevel:1,sources:[...new Set(products.map(p=>p.buildingId))].map(id=>({id,name:'B'+id})),products});
const group=ids=>({id:'test',slots:ids.map(id=>({id,quantity:1}))});
const definitions=[
 {name:'independent buildings',products:[product(1,2,1),product(2,3,2),product(3,5,3),product(4,7,4)],ids:[1,2,3,4],winner:[3,4,2,1],target:12,work:35,tolerance:4,time:q=>Math.max(q[0]*2,q[1]*3,q[2]*5,q[3]*7),bound:q=>Math.max(q[0]*2,q[1]*3,q[2]*5,q[3]*7)},
 {name:'one serial workshop',products:[product(1,2,1),product(2,3,1),product(3,5,1),product(4,7,1)],ids:[1,2,3,4],winner:[1,1,1,1],target:17,work:17,tolerance:8,time:q=>q[0]*2+q[1]*3+q[2]*5+q[3]*7,bound:q=>q[0]*2+q[1]*3+q[2]*5+q[3]*7},
 {name:'identical two-stage pipeline',products:[product(1,2,1),product(2,3,2,[[1,1]])],ids:[2,2,2,2],winner:[2,2,2,2],target:26,work:40,tolerance:3,time:q=>q.reduce((s,n)=>s+n,0)*3+2,bound:q=>q.reduce((s,n)=>s+n,0)*3},
 {name:'fractional times use no time-bound pruning',products:[product(1,.1,1),product(2,.2,2),product(3,.5,3),product(4,.75,4)],ids:[1,2,3,4],winner:[1,2,2,1],target:1,work:2.25,tolerance:.5,time:q=>Math.max(q[0]*.1,q[1]*.2,q[2]*.5,q[3]*.75),bound:()=>0},
];
for(const d of definitions)test('every pruned candidate loses all three rankings: '+d.name,()=>{
 const model=prepareRanch(base(d.products)),g=group(d.ids),o=quantityOptions({targetMinutes:d.target,toleranceMinutes:d.tolerance,targetWorkMinutes:d.work,productMax:4});
 const actual=q=>{const candidate=quantityGroup(g,q),time=d.time(q);return {group:candidate,result:{...groupMetrics(model,candidate,1),proven:true,optimalMinutes:time,lowerMinutes:time,feasibleMinutes:time}};};
 const winner=actual(d.winner);let pruned=0;
 for(let a=1;a<=4;a++)for(let b=1;b<=4;b++)for(let c=1;c<=4;c++)for(let e=1;e<=4;e++){
   const q=[a,b,c,e],candidate=actual(q);
   if(!quantityCandidateDominated(candidate.group,candidate.result,d.bound(q),o,[winner]))continue;
   pruned++;for(const mode of ['work','time','quantity'])assert(compare(quantityRank(winner,o,mode),quantityRank(candidate,o,mode))<0,mode+' must strictly favor the verified winner');
 }
 assert(pruned>0);
 const unresolved={...winner,result:{...winner.result,proven:false,optimalMinutes:null}};
 assert.equal(quantityCandidateDominated(quantityGroup(g,[4,4,4,4]),{totalMinutes:1000},1000,o,[unresolved]),false);
});

// Run identical candidate generation and scheduling with only the pruning gate
// disabled. This checks integration independently of elapsed time and counters.
const sourceUrl=new URL('../orders/ranch-quantity.js',import.meta.url);
let referenceSource=fs.readFileSync(sourceUrl,'utf8');
assert(referenceSource.includes('if(dominated(candidate,q))'));
referenceSource=referenceSource.replace('if(dominated(candidate,q))','if(false)').replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,sourceUrl).href}'`);
const {fitRanchQuantities:unprunedFit}=await import('data:text/javascript;base64,'+Buffer.from(referenceSource).toString('base64'));
for(const d of definitions)test('pruning retains the exact recommendations: '+d.name,()=>{
 const model=prepareRanch(base(d.products)),g=group(d.ids),caps=Object.fromEntries(model.base.sources.map(s=>[s.id,1])),o={targetMinutes:d.target,toleranceMinutes:d.tolerance,targetWorkMinutes:d.work,productMax:4,cropMax:4,timeLimitMs:10000,maxEvaluations:100};
 const before=unprunedFit(model,g,1,caps,o),after=fitRanchQuantities(model,g,1,caps,o);
 const summary=fit=>fit.recommendations.map(v=>({key:v.group.key,time:v.result.optimalMinutes,work:v.result.totalMinutes,label:v.label}));
 assert.deepEqual(summary(after),summary(before));assert.equal(after.within,before.within);assert.equal(after.reason,before.reason);assert(after.tried<=before.tried);
 if(d.name!=='fractional times use no time-bound pruning')assert(after.prunedCount>0);
});

test('minimum and maximum diagnostics remain evaluated even when dominated',()=>{
 const model=prepareRanch(base([product(1,10,1)])),g=group([1,1,1,1]),o={targetMinutes:40,toleranceMinutes:5,targetWorkMinutes:40,productMax:4,cropMax:4,timeLimitMs:10000};
 const fit=fitRanchQuantities(model,g,1,{1:1},o);assert(fit.tried>=2);assert(fit.prunedCount>0);assert.equal(fit.recommendations[0].result.optimalMinutes,40);
});


test('endpoint proof is skipped only when a proven incumbent wins every possible completion time',()=>{
 const options=quantityOptions({targetMinutes:10,toleranceMinutes:2,targetWorkMinutes:30}),g=group([1,2,3,4]);
 const candidate=time=>({group:g,result:{proven:true,optimalMinutes:time,lowerMinutes:time,feasibleMinutes:time,totalMinutes:30}});
 assert(quantityEndpointDominated(13,options,[candidate(12)]));
 assert(quantityEndpointDominated(15,options,[candidate(7)]));
 assert(!quantityEndpointDominated(13,options,[candidate(7)]),'equal time error must not discard possible secondary improvements');
 assert(!quantityEndpointDominated(12,options,[candidate(7)]),'an interval that could reach the target band is still competitive');
 assert(!quantityEndpointDominated(100,options,[{...candidate(10),result:{...candidate(10).result,proven:false}}]));
 for(const incumbent of [7,8,10,12,13])for(let lower=1;lower<=20;lower++){
   const known=candidate(incumbent);if(!quantityEndpointDominated(lower,options,[known]))continue;
   for(let actual=lower;actual<=25;actual++)for(const mode of ['work','time','quantity'])assert(compare(quantityRank(known,options,mode),quantityRank(candidate(actual),options,mode))<0);
 }
});

// Record the real scheduler budgets and branch counts, bypassing schedule reuse
// so a previously cached proof cannot hide whether the expensive branch ran.
let recordedSource=fs.readFileSync(sourceUrl,'utf8');
recordedSource=recordedSource.replace("import {solveRanchGroupCached as solveRanchGroup} from './ranch-schedule-cache.js';",`import {solveRanchGroup as actualSolve} from './ranch-engine.js';
const solveRanchGroup=(...args)=>{const result=actualSolve(...args);globalThis.__ranchEndpointProofTrace.push({quantities:args[1].slots.map(v=>v.quantity),budget:args[4].timeLimitMs,nodes:result.nodes,proven:result.proven});return result;};`);
recordedSource=recordedSource.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,sourceUrl).href}'`);
const baselineRecordedSource=recordedSource.replace('quantityEndpointDominated(safeLower(q),options,evaluated)','false');
const {fitRanchQuantities:recordedFit}=await import('data:text/javascript;base64,'+Buffer.from(recordedSource).toString('base64'));
const {fitRanchQuantities:recordedBaselineFit}=await import('data:text/javascript;base64,'+Buffer.from(baselineRecordedSource).toString('base64'));
test('a losing maximum endpoint retains a real schedule without branching or changing recommendations',()=>{
 const b=base([product(1,2,0),product(2,1,3,[[1,1]]),product(3,3,2,[[2,1],[1,1]]),product(4,2,1,[[2,1]]),product(5,1,2,[[3,1],[4,1]])]),g=group([5,3,4,1]),caps={0:2,1:1,2:1,3:1},o={targetMinutes:10,toleranceMinutes:0,targetWorkMinutes:29,productMax:2,cropMax:2,timeLimitMs:4000};
 const prior=globalThis.__ranchEndpointProofTrace;
 try{
   globalThis.__ranchEndpointProofTrace=[];const before=recordedBaselineFit(prepareRanch(b),g,1,caps,o),beforeTrace=globalThis.__ranchEndpointProofTrace;
   globalThis.__ranchEndpointProofTrace=[];const after=recordedFit(prepareRanch(b),g,1,caps,o),afterTrace=globalThis.__ranchEndpointProofTrace;
   const endpoint=trace=>trace.find(row=>row.quantities.every(q=>q===2));assert(endpoint(beforeTrace).nodes>0);assert.equal(endpoint(afterTrace).budget,0);assert.equal(endpoint(afterTrace).nodes,0);assert(after.endpointProofSkips>0);
   const summary=fit=>fit.recommendations.map(v=>({key:v.group.key,time:v.result.optimalMinutes,work:v.result.totalMinutes,label:v.label}));assert.deepEqual(summary(after),summary(before));assert.equal(after.reason,before.reason);assert.equal(after.within,before.within);
 }finally{if(prior===undefined)delete globalThis.__ranchEndpointProofTrace;else globalThis.__ranchEndpointProofTrace=prior;}
});
