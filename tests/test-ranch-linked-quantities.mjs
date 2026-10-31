import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {prepareRanch,solveRanchGroup} from '../orders/ranch-engine.js';
import {quantityCandidates,quantityOptions,quantityGroup,fitRanchQuantities,hasEqualProductQuantities,linkedProductQuantities,QUANTITY_SEARCH_VERSION,ranchQuantityFitKey,reuseRanchQuantityFit} from '../orders/ranch-quantity.js';
const products=[1,2,3,4].map(id=>({id,name:'P'+id,buildingId:id,buildingName:'B'+id,level:1,isCrop:false,stepMinutes:10,analysisBatchYield:1,inputs:[]}));
const base={maxLevel:1,sources:products.map(p=>({id:p.buildingId,name:p.buildingName})),products},caps={1:1,2:1,3:1,4:1};
const group=(ids,qs=ids.map(()=>1))=>({id:'test',slots:ids.map((id,i)=>({id,quantity:qs[i]}))});
const model=prepareRanch(base);

test('editing one product links every occurrence without mutating legacy inputs',()=>{
 const g=group([1,2,1,1],[12,2,12,12]),old=structuredClone(g);
 assert(hasEqualProductQuantities(g));assert.deepEqual(linkedProductQuantities(g,0,5),[5,2,5,5]);assert.deepEqual(linkedProductQuantities(g,1,5),[12,5,12,12]);assert.deepEqual(g,old);
 const unequal=group([1,1,1,1],[12,2,12,12]);assert(!hasEqualProductQuantities(unequal));assert.deepEqual(linkedProductQuantities(unequal,1,6),[6,6,6,6]);
 assert.deepEqual(quantityGroup(unequal,[12,2,12,12]).slots.map(s=>s.quantity),[12,2,12,12],'reading a legacy group must not silently rewrite it');
 assert.throws(()=>linkedProductQuantities(g,4,2),/有效/);assert.throws(()=>linkedProductQuantities(g,0,0),/正整数/);
});
for(const ids of [[1,1,1,1],[1,2,1,2],[1,2,3,1]])test('candidate generation enumerates independent product variables: '+ids.join(','),()=>{
 const g=group(ids,[1,2,3,4]),before=structuredClone(g),options=quantityOptions({productMax:3,cropMax:3,maxEvaluations:200,targetMinutes:100,toleranceMinutes:20,targetWorkMinutes:200}),pool=quantityCandidates(model,g,caps,options,null);
 assert.equal(pool.considered,8+3**new Set(ids).size);
 assert(pool.quantities.every(q=>hasEqualProductQuantities(quantityGroup(g,q))));assert(pool.quantities.every(q=>q.every(v=>v>=1&&v<=3)));assert.deepEqual(g,before);
 if(new Set(ids).size===1)assert.deepEqual(new Set(pool.quantities.map(q=>q[0])),new Set([1,2,3]));
});

test('unequal saved input is only averaged into the seed; unequal baseline is ignored',()=>{
 const g=group([1,1,1,1],[12,2,12,12]),before=structuredClone(g),options=quantityOptions({targetMinutes:400,toleranceMinutes:30,targetWorkMinutes:400,productMax:12});
 const pool=quantityCandidates(model,g,caps,options,{proven:true,optimalMinutes:9999});
 assert.deepEqual(pool,quantityCandidates(model,g,caps,options,null));assert.deepEqual(pool.quantities[0],[10,10,10,10]);assert.deepEqual(g,before);
});

test('a formerly perfect unequal schedule cannot become a new recommendation',()=>{
 const g=group([1,1,1,1],[1,2,3,4]),before=structuredClone(g),baseline=solveRanchGroup(model,g,1,caps);
 assert.equal(baseline.optimalMinutes,100);
 const fit=fitRanchQuantities(model,g,1,caps,{targetMinutes:100,toleranceMinutes:0,targetWorkMinutes:100,productMax:4,cropMax:4,timeLimitMs:4000,maxEvaluations:100},baseline);
 assert.equal(fit.within,false);assert(fit.recommendations.every(v=>hasEqualProductQuantities(v.group)));assert(fit.recommendations.every(v=>v.result.optimalMinutes!==100));assert.deepEqual(g,before);assert.equal(fit.searchVersion,6);
});
for(const ids of [[1,1,1,1],[1,2,1,2],[1,2,3,1]])test('fit recommendations preserve equal quantities: '+ids.join(','),()=>{
 const g=group(ids,[1,2,3,4]),before=structuredClone(g),fit=fitRanchQuantities(model,g,1,caps,{targetMinutes:80,toleranceMinutes:10,targetWorkMinutes:160,productMax:4,cropMax:4,timeLimitMs:4000,maxEvaluations:100});
 assert(fit.recommendations.every(v=>hasEqualProductQuantities(v.group)));assert.deepEqual(g,before);
});

// Force the initial candidate pool to one vector to exercise the actual local
// refinement path; retain the real joint scheduler and the unchanged budgets.
const moduleUrl=new URL('../orders/ranch-quantity.js',import.meta.url);let source=fs.readFileSync(moduleUrl,'utf8');
const poolExpression='pool=quantityCandidates(model,group,capacities,options,baseline)';assert(source.includes(poolExpression));
source=source.replace(poolExpression,'pool={...quantityCandidates(model,group,capacities,options,baseline),quantities:[[1,1,1,1]]}').replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,moduleUrl).href}'`);
const {fitRanchQuantities:refineFit}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('one-step refinement adjusts every same-product slot together',()=>{
 const g=group([1,1,1,1]),fit=refineFit(model,g,1,caps,{targetMinutes:80,toleranceMinutes:0,targetWorkMinutes:80,productMax:4,cropMax:4,timeLimitMs:4000,maxEvaluations:42});
 assert(fit.within);assert.deepEqual(fit.recommendations[0].group.slots.map(s=>s.quantity),[2,2,2,2]);assert(fit.recommendations.every(v=>hasEqualProductQuantities(v.group)));
});

test('fit reuse keys identify the equal-quantity rule and invalid donors are rejected',()=>{
 assert.equal(QUANTITY_SEARCH_VERSION,6);const g=group([1,1,1,1]),options=quantityOptions();assert.equal(JSON.parse(ranchQuantityFitKey(model,g,caps,options))[0],6);
 const old=group([1,1,1,1],[1,2,3,4]);assert.throws(()=>reuseRanchQuantityFit({recommendations:[{group:old,result:{}}]},g,caps),/数量不一致/);
});
