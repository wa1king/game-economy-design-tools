import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareRanch,solveRanchGroup,expandRanchTasks,validateRanchSchedule} from '../orders/ranch-engine.js';
import {createRanchCpSatSolver} from '../orders/ranch-cpsat.js';
import {fitRanchQuantitiesAsync} from '../orders/ranch-quantity.js';
import {createRanchScheduleCache} from '../orders/ranch-schedule-cache.js';
const base={maxLevel:1,sources:[{id:1,name:'工坊'}],products:[3,2,2].map((t,i)=>({id:i+1,name:'P'+i,buildingId:1,buildingName:'工坊',level:1,stepMinutes:t,analysisBatchYield:1,inputs:[]}))};
const group={id:'g',slots:[{id:1,quantity:1},{id:1,quantity:1},{id:2,quantity:1},{id:3,quantity:2}]},caps={1:2};
// The five jobs have lengths 3,3,2,2,2. Total work/2 is six;
// putting 3+3 on one machine and 2+2+2 on the other attains six.
test('unavailable mature runtime keeps a valid interval and never turns a heuristic into an optimum',async()=>{
 const m=prepareRanch(base),seed=solveRanchGroup(m,group,1,caps,{timeLimitMs:0,nodeLimit:0});assert.equal(seed.lowerMinutes,6);assert.equal(seed.feasibleMinutes,7);assert.equal(seed.proven,false);
 const solve=createRanchCpSatSolver({load:async()=>{throw Error('offline');}}),r=await solve(m,group,1,caps,{timeLimitMs:100});
 assert.equal(r.optimalMinutes,null);assert.equal(r.proven,false);assert.equal(r.lowerMinutes,6);assert.equal(r.feasibleMinutes,7);assert.match(r.solverNotice,/offline/);
 const e=expandRanchTasks(m,group,1,caps),times=[];for(const row of r.schedule)times[row.id]=row.start*e.scale;assert(validateRanchSchedule(e.tasks,e.edges,times,caps));
});
test('a mathematical certificate bypasses runtime loading even with fractional durations',async()=>{
 let loads=0;const b=structuredClone(base);b.products.forEach(p=>p.stepMinutes=.5);const r=await createRanchCpSatSolver({load:async()=>{loads++;throw Error('unneeded');}})(prepareRanch(b),group,1,{1:1});assert(r.proven);assert.equal(r.optimalMinutes,2.5);assert.equal(loads,0);
});
test('asynchronous quantity fitting reuses only certified schedules',async()=>{
 const m=prepareRanch(base);let calls=0;const cache=createRanchScheduleCache({solver:async(...args)=>{calls++;return solveRanchGroup(...args);}});
 const options={targetMinutes:12,toleranceMinutes:2,targetWorkMinutes:24,productMax:3,timeLimitMs:2000};
 const fit=await fitRanchQuantitiesAsync(cache.solve,m,group,1,caps,options);assert(fit.recommendations.every(v=>v.result.proven));assert(fit.recommendations.every(v=>v.group.slots[0].quantity===v.group.slots[1].quantity));
 const winner=fit.recommendations[0];await cache.solve(m,winner.group,1,caps);const before=calls;const reused=await cache.solve(m,winner.group,1,caps);assert(reused.scheduleReused);assert.equal(calls,before);
});
test('pinned WASM solver finds the independent six-minute packing optimum', {skip:!process.env.ORTOOLS_TEST_MODULE},async()=>{
 const api=await import(process.env.ORTOOLS_TEST_MODULE);api.setCloudNoticeEnabled(false);try{
 for(const denominator of [1,10,4]){const b=structuredClone(base);b.products.forEach(p=>p.stepMinutes/=denominator);const r=await createRanchCpSatSolver({load:async()=>api})(prepareRanch(b),group,1,caps,{timeLimitMs:1000});assert.equal(r.solver,'or_tools_cp_sat');assert(r.proven);assert.equal(r.optimalMinutes,6/denominator);assert.equal(r.lowerMinutes,6/denominator);}
 }finally{await api.terminateLoadedRuntimeThreads();}
});
