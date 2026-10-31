import test from 'node:test';import assert from 'node:assert/strict';
import {customOrderTimeComparison} from '../orders/custom-order-comparison.js';
import {dashboardRows,createLevelDashboard} from '../orders/level-dashboard.js';
const order=(id,time,min=1,max=null)=>({id,cumulativeMinutes:time,minimumLevel:min,maximumLevel:max});
const catalog={orders:[order('a',10),order('b',20),order('c',100),order('late',999,2)],maxLevel:2};
const selection={levels:{1:['a','b'],2:['c']}};
test('custom tasks have equal weight; remaining probabilities are conditioned within the same level',()=>{
 const before=JSON.stringify({catalog,selection}),r=customOrderTimeComparison(catalog,selection,1,{probabilities:[.5,.2,.3,0]});assert.equal(r.customMean,15);assert.equal(r.normalMean,100);assert.equal(r.normalCount,1);assert.equal(r.delta,-85);assert.equal(JSON.stringify({catalog,selection}),before);
 const other=customOrderTimeComparison(catalog,{levels:{1:['a']}},1,{probabilities:[.5,.2,.3,0]});assert.equal(other.normalMean,68);assert.equal(other.normalMass,.5);
});
test('no custom task, zero mass and no current fit stay distinct',()=>{
 const fit={probabilities:[0,.25,.75,0]};assert.equal(customOrderTimeComparison(catalog,null,1,fit).normalMean,80);assert.equal(customOrderTimeComparison(catalog,null,1,fit).customMean,null);
 assert.equal(customOrderTimeComparison(catalog,{levels:{1:['b','c']}},1,fit).normalMean,null);
 const missing=customOrderTimeComparison(catalog,selection,1,null);assert.equal(missing.customMean,15);assert.equal(missing.normalMean,null);assert.equal(missing.delta,null);
});
test('unavailable custom tasks are visible and cannot produce a partial misleading average',()=>{
 const r=customOrderTimeComparison(catalog,{levels:{1:['a','late','deleted']}},1,{probabilities:[.5,.2,.3,0]});assert.equal(r.entries.length,3);assert.equal(r.invalid,2);assert.equal(r.customMean,null);assert.equal(r.normalMean,68);
 assert.throws(()=>customOrderTimeComparison(catalog,selection,1,{probabilities:[1]}),/数量不一致/);
});
test('stale fit is not usable for the comparison',()=>{
 const api={getCatalog:()=>({...catalog,sources:[]}),getConfig:()=>({revision:2,weights:{}}),getInfo:()=>({active:[]}),getResult:()=>({revision:1,result:{probabilities:[.5,.2,.3,0]}}),getError:()=>null};const row=dashboardRows(api)[0];assert.equal(row.r,null);assert.equal(customOrderTimeComparison(catalog,selection,1,row.r).normalMean,null);
});
