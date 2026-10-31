import test from 'node:test';import assert from 'node:assert/strict';
import {prepareRanch,solveRanchGroup} from '../orders/ranch-engine.js';
import {orderWorkBalance,fitRanchQuantities,quantityGroup,reuseRanchQuantityFit,ranchQuantityFitKey} from '../orders/ranch-quantity.js';
import {ranchWorkRules,validRanchWorkShares} from '../orders/ranch-work-rules.js';
import {ranchFitIsCurrent} from '../orders/ranch-workspace.js';
const fixture=times=>{const base={maxLevel:1,sources:times.map((_,i)=>({id:i+1,name:'B'+i})),products:times.map((t,i)=>({id:i+1,name:'P'+i,buildingId:i+1,level:1,stepMinutes:t,analysisBatchYield:1,inputs:[]}))};return {model:prepareRanch(base),group:quantityGroup({id:'g',slots:times.map((_,i)=>({id:i+1,quantity:1}))},[1,1,1,1]),caps:Object.fromEntries(times.map((_,i)=>[i+1,1]))};};
test('20 and 30 percent are inclusive hard limits; upstream work belongs to its delivered order',()=>{
 const f=fixture([20,30,25,25]);assert(orderWorkBalance(f.model,f.group).valid);assert.deepEqual(orderWorkBalance(f.model,f.group).shares,[.20,.30,.25,.25]);
 f.model.by.get(2).stepMinutes=31;const changed=prepareRanch(f.model.base);assert(!orderWorkBalance(changed,f.group).valid);
 const b=fixture([2,5,5,5]);b.model.base.products[1].inputs=[{id:1,quantity:3}];const m=prepareRanch(b.model.base);assert.deepEqual(orderWorkBalance(m,b.group).minutes,[2,11,5,5]);
});
test('a time-perfect but unbalanced old baseline never becomes a recommendation',()=>{
 const f=fixture([10,20,30,40]),bad=quantityGroup(f.group,[1,1,1,1]),old=solveRanchGroup(f.model,bad,1,f.caps);assert.equal(old.optimalMinutes,40);assert(!orderWorkBalance(f.model,bad).valid);
 const fit=fitRanchQuantities(f.model,bad,1,f.caps,{targetMinutes:40,toleranceMinutes:0,targetWorkMinutes:100,productMax:6,timeLimitMs:1000},old);assert(fit.recommendations.every(v=>orderWorkBalance(f.model,v.group).valid));assert(fit.recommendations.every(v=>v.result.orderWorkBalanced));
 assert.equal(ranchFitIsCurrent({within:true,options:fit.options,recommendations:[{group:bad,result:old}]},bad,fit.options),false);assert.throws(()=>reuseRanchQuantityFit({recommendations:[{group:bad,result:old}]},bad,f.caps),/20%～30%/);
});
test('infeasible quantity caps cannot return a fallback that breaks the share rule',()=>{
 const f=fixture([1,1,1,100]);assert.throws(()=>fitRanchQuantities(f.model,f.group,1,f.caps,{targetMinutes:100,toleranceMinutes:10,targetWorkMinutes:200,productMax:2,timeLimitMs:1000}),/20%～30%/);
});
test('a balanced solution remains available even when every possible schedule misses the target',()=>{
 const f=fixture([10,20,30,40]),fit=fitRanchQuantities(f.model,f.group,1,f.caps,{targetMinutes:1,toleranceMinutes:0,targetWorkMinutes:100,productMax:6,timeLimitMs:1000});assert.equal(fit.within,false);assert(fit.recommendations.every(v=>orderWorkBalance(f.model,v.group).valid));
});

test('legacy valid fits can be revalidated and reused without invoking a scheduler or changing saved input',()=>{
 const f=fixture([20,30,25,25]),result=solveRanchGroup(f.model,f.group,1,f.caps),options={targetMinutes:30,toleranceMinutes:0,targetWorkMinutes:100,cropMax:42,productMax:12,timeLimitMs:2500},fit={within:true,searchVersion:1,options,recommendations:[{group:f.group,result}]},before=JSON.stringify(fit);
 assert(ranchFitIsCurrent(fit,f.group,options,f.model));const reused=reuseRanchQuantityFit(fit,f.group,f.caps,f.model);assert(reused.recommendations[0].result.orderWorkBalanced);assert.equal(reused.recommendations[0].result.optimalMinutes,30);assert.equal(JSON.stringify(fit),before);
});

test('configured work shares replace defaults and include both boundaries',()=>{
 const f=fixture([15,35,25,25]);assert(!orderWorkBalance(f.model,f.group).valid);
 const model=prepareRanch(f.model.base,{orderWorkMinPercent:15,orderWorkMaxPercent:35});assert(orderWorkBalance(model,f.group).valid);
 assert(validRanchWorkShares([.20,.30,.25,.25],{}));assert(!validRanchWorkShares([.1999,.3001,.25,.25],{}));assert(!validRanchWorkShares([.2,.2,.2,.2],{}));
 assert(validRanchWorkShares([.25,.25,.25,.25],{orderWorkMinPercent:25,orderWorkMaxPercent:25}));
 for(const rules of [{orderWorkMinPercent:26},{orderWorkMaxPercent:24},{orderWorkMinPercent:0},{orderWorkMaxPercent:101},{orderWorkMinPercent:''},{orderWorkMaxPercent:NaN}])assert.throws(()=>ranchWorkRules(rules));
});

test('quantity search and cached recommendations obey configured 22 to 28 percent bounds',()=>{
 const f=fixture([10,20,30,40]),rules={orderWorkMinPercent:22,orderWorkMaxPercent:28},model=prepareRanch(f.model.base,rules);
 const options={targetMinutes:120,toleranceMinutes:0,targetWorkMinutes:480,productMax:12,timeLimitMs:1000};
 const fit=fitRanchQuantities(model,f.group,1,f.caps,options);assert(fit.within);
 for(const v of fit.recommendations){const work=v.group.slots.map((s,i)=>[10,20,30,40][i]*s.quantity),total=work.reduce((a,b)=>a+b,0);assert(work.every(w=>w>=total*.22-1e-8&&w<=total*.28+1e-8));assert.equal(Math.max(...work),v.result.optimalMinutes);}
 assert.equal(fit.options.orderWorkMinPercent,22);assert.equal(fit.options.orderWorkMaxPercent,28);
 assert.notEqual(ranchQuantityFitKey(model,f.group,f.caps,options),ranchQuantityFitKey(f.model,f.group,f.caps,options));
 const own=fit.recommendations[0].group;assert(ranchFitIsCurrent(fit,own,fit.options,model));assert(!ranchFitIsCurrent(fit,own,{...fit.options,orderWorkMinPercent:20,orderWorkMaxPercent:30},f.model));
});
