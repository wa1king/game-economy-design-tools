import test from 'node:test';import assert from 'node:assert/strict';
import {prepareRanch,solveRanchGroup} from '../orders/ranch-engine.js';
import {orderWorkBalance,fitRanchQuantities,quantityGroup,reuseRanchQuantityFit} from '../orders/ranch-quantity.js';
import {ranchFitIsCurrent} from '../orders/ranch-workspace.js';
const fixture=times=>{const base={maxLevel:1,sources:times.map((_,i)=>({id:i+1,name:'B'+i})),products:times.map((t,i)=>({id:i+1,name:'P'+i,buildingId:i+1,level:1,stepMinutes:t,analysisBatchYield:1,inputs:[]}))};return {model:prepareRanch(base),group:quantityGroup({id:'g',slots:times.map((_,i)=>({id:i+1,quantity:1}))},[1,1,1,1]),caps:Object.fromEntries(times.map((_,i)=>[i+1,1]))};};
test('15 and 35 percent are inclusive hard limits; upstream work belongs to its delivered order',()=>{
 const f=fixture([15,35,25,25]);assert(orderWorkBalance(f.model,f.group).valid);assert.deepEqual(orderWorkBalance(f.model,f.group).shares,[.15,.35,.25,.25]);
 f.model.by.get(2).stepMinutes=36;const changed=prepareRanch(f.model.base);assert(!orderWorkBalance(changed,f.group).valid);
 const b=fixture([2,5,5,5]);b.model.base.products[1].inputs=[{id:1,quantity:3}];const m=prepareRanch(b.model.base);assert.deepEqual(orderWorkBalance(m,b.group).minutes,[2,11,5,5]);
});
test('a time-perfect but unbalanced old baseline never becomes a recommendation',()=>{
 const f=fixture([10,20,30,40]),bad=quantityGroup(f.group,[1,1,1,1]),old=solveRanchGroup(f.model,bad,1,f.caps);assert.equal(old.optimalMinutes,40);assert(!orderWorkBalance(f.model,bad).valid);
 const fit=fitRanchQuantities(f.model,bad,1,f.caps,{targetMinutes:40,toleranceMinutes:0,targetWorkMinutes:100,productMax:6,timeLimitMs:1000},old);assert(fit.recommendations.every(v=>orderWorkBalance(f.model,v.group).valid));assert(fit.recommendations.every(v=>v.result.orderWorkBalanced));
 assert.equal(ranchFitIsCurrent({within:true,options:fit.options,recommendations:[{group:bad,result:old}]},bad,fit.options),false);assert.throws(()=>reuseRanchQuantityFit({recommendations:[{group:bad,result:old}]},bad,f.caps),/15%～35%/);
});
test('infeasible quantity caps cannot return a fallback that breaks the share rule',()=>{
 const f=fixture([1,1,1,100]);assert.throws(()=>fitRanchQuantities(f.model,f.group,1,f.caps,{targetMinutes:100,toleranceMinutes:10,targetWorkMinutes:200,productMax:2,timeLimitMs:1000}),/15%～35%/);
});
test('a balanced solution remains available even when every possible schedule misses the target',()=>{
 const f=fixture([10,20,30,40]),fit=fitRanchQuantities(f.model,f.group,1,f.caps,{targetMinutes:1,toleranceMinutes:0,targetWorkMinutes:100,productMax:6,timeLimitMs:1000});assert.equal(fit.within,false);assert(fit.recommendations.every(v=>orderWorkBalance(f.model,v.group).valid));
});

test('legacy valid fits can be revalidated and reused without invoking a scheduler or changing saved input',()=>{
 const f=fixture([15,35,25,25]),result=solveRanchGroup(f.model,f.group,1,f.caps),options={targetMinutes:35,toleranceMinutes:0,targetWorkMinutes:100,cropMax:42,productMax:12,timeLimitMs:2500},fit={within:true,searchVersion:1,options,recommendations:[{group:f.group,result}]},before=JSON.stringify(fit);
 assert(ranchFitIsCurrent(fit,f.group,options,f.model));const reused=reuseRanchQuantityFit(fit,f.group,f.caps,f.model);assert(reused.recommendations[0].result.orderWorkBalanced);assert.equal(reused.recommendations[0].result.optimalMinutes,35);assert.equal(JSON.stringify(fit),before);
});
