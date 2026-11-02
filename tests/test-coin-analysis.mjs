import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCoins,coinBreakdown,renderCoinAnalysis,renderCoinBreakdown} from '../orders/coin-analysis.js';
import {summarizeOrderOutcomes} from '../orders/order-outcomes.js';
import {buildCatalog} from '../orders/order-engine.js';
const products=new Map([[1,{id:1,name:'作物',coinValue:2}],[2,{id:2,name:'加工品',coinValue:20}]]);
const close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('ordinary probabilities, direct-price multiplier, distribution and contributions reconcile',()=>{
  const rows=[{items:[{id:1,quantity:6}],weight:1,workMinutes:12},{items:[{id:2,quantity:1}],weight:3,workMinutes:60},{items:[{id:2,quantity:100}],weight:0,workMinutes:6000}];
  const s=summarizeCoins(rows,products,{multiplier:5});
  assert.equal(s.count,2);close(s.mean,90);assert.equal(s.median,100);assert.equal(s.min,60);assert.equal(s.max,100);close(s.workRate,112.5);
  close(s.products.reduce((n,p)=>n+p.value,0),90);close(s.products.reduce((n,p)=>n+p.share,0),1);close(s.distribution.reduce((n,p)=>n+p.mass,0),1);assert.equal(s.products[0].name,'加工品');
  const scaled=summarizeCoins(rows.map(r=>({...r,weight:r.weight*13})),products,{multiplier:5});close(scaled.mean,s.mean);close(scaled.median,s.median);
});
test('ranch uses direct delivered value once per slot, joint time and ratio of means',()=>{
  const rows=[{items:Array.from({length:4},()=>({id:1,quantity:10})),weight:1,workMinutes:80,optimizedMinutes:20},{items:Array.from({length:4},()=>({id:2,quantity:2})),weight:1,workMinutes:160,optimizedMinutes:40}];
  const s=summarizeCoins(rows,products,{equalWeight:true});assert.equal(s.mean,120);assert.equal(s.median,120);close(s.workRate,60);close(s.optimizedRate,240);
  assert.equal(coinBreakdown(rows[0].items,products).total,80);assert.equal(s.products.find(v=>v.id===1).quantity,20);
  const markup=renderCoinBreakdown(rows[0].items,products,{slots:true});for(const letter of 'ABCD')assert(markup.includes(`<b>${letter}</b>`));
});
test('missing prices never become zero or partial overall averages; known coverage keeps full denominator',()=>{
  const missing=new Map(products);missing.set(2,{id:2,name:'未定价',coinValue:null});
  const rows=[{items:[{id:1,quantity:6}],weight:.25,workMinutes:12},{items:[{id:2,quantity:1}],weight:.75,workMinutes:60}];
  const s=summarizeCoins(rows,missing,{multiplier:5});assert.equal(s.mean,null);assert.equal(s.median,null);assert.equal(s.min,null);assert.equal(s.max,null);assert.equal(s.workRate,null);assert.equal(s.missingCount,1);close(s.missingMass,.75);close(s.distribution[0].mass,.25);
  assert(s.products.every(v=>v.share===null));assert(renderCoinAnalysis(s).includes('整体均值、中位数、范围与效率暂不计算'));assert.equal(coinBreakdown(rows[1].items,missing).total,null);
});
test('zero prices, empty populations, single-valued distributions and estimates stay meaningful',()=>{
  const p=new Map([[1,{name:'<作物>',coinValue:0,coinValueStatus:'估算'}]]),row={items:[{id:1,quantity:6}],weight:1,workMinutes:12};
  const s=summarizeCoins([row],p);assert.equal(s.mean,0);assert.equal(s.median,0);assert.equal(s.workRate,0);assert.equal(s.optimizedRate,null);assert.equal(s.estimatedMass,1);assert.equal(s.distribution.length,1);assert.equal(s.distribution[0].mass,1);assert.equal(s.products[0].share,null);
  assert(renderCoinAnalysis(s).includes('&lt;作物&gt;'));assert(!renderCoinAnalysis(s).includes('NaN'));assert.equal(summarizeCoins([],p).mean,null);
});
test('new statistics agree with existing weighted reward outcomes on a real generated catalogue',()=>{
  const base={maxLevel:2,sources:[{id:0,name:'农田',level:1},{id:1,name:'工坊',level:1}],products:[{id:1,name:'作物',level:1,buildingId:0,buildingName:'农田',category:'田地作物',isCrop:true,stepMinutes:2,analysisBatchYield:1,inputs:[],coinValue:2},{id:2,name:'加工品',level:1,buildingId:1,buildingName:'工坊',stepMinutes:8,analysisBatchYield:1,inputs:[{id:1,quantity:2}],coinValue:20}]};
  const catalog=buildCatalog(base),probabilities=catalog.orders.map((_,i)=>i+1),result={config:{level:2},probabilities},old=summarizeOrderOutcomes(catalog,result,2),s=summarizeCoins(catalog.orders.map((o,i)=>({items:o.items,weight:probabilities[i],workMinutes:o.cumulativeMinutes})),new Map(base.products.map(v=>[v.id,v])),{multiplier:5});
  close(s.mean,old.stats.coinReward.mean);close(s.median,old.stats.coinReward.p50);close(s.min,old.stats.coinReward.min);close(s.max,old.stats.coinReward.max);
});
