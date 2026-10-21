import assert from 'node:assert/strict';
import {buildCatalog} from '../orders/order-engine.js';
import {summarizeOrderOutcomes} from '../orders/order-outcomes.js';
import {ordinaryOrderReward} from '../orders/coin-values.js';
import {orderReward} from '../orders/game-engine.js';
function fixture(){return buildCatalog({maxLevel:2,sources:[{id:0,name:'田'},{id:1,name:'坊'}],products:[
 {id:1,name:'麦',level:1,buildingId:0,isCrop:true,stepMinutes:2,analysisBatchYield:1,coinValue:2,inputs:[]},
 {id:2,name:'粉',level:1,buildingId:1,stepMinutes:5,analysisBatchYield:1,coinValue:10,inputs:[{id:1,quantity:2}]}
]},{maxKinds:1,cropQuantity:7,productQuantity:1});}
const summary=(c,p=[.25,.75],level=1)=>summarizeOrderOutcomes(c,{config:{level},probabilities:p},level);
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
test('reward uses final probabilities, delivery quantities and existing 5x payout',()=>{
 const c=fixture(),snapshot=JSON.stringify(c),r=summary(c);
 assert.equal(r.stats.coinReward.mean,55);assert.equal(r.stats.coinReward.p50,50);assert.equal(r.stats.coinReward.min,50);assert.equal(r.stats.coinReward.max,70);
 assert.equal(r.coinRewardCoverage.pricedProbability,1);assert.equal(JSON.stringify(c),snapshot);
 for(const order of c.orders)assert.equal(ordinaryOrderReward(order,new Map(c.products.map(p=>[p.id,p]))),orderReward(null,order,c));
});
test('missing price on any positive-probability order does not become zero or a partial average',()=>{
 const c=fixture();c.products[1].coinValue=null;const r=summary(c);assert.equal(r.stats.coinReward.mean,null);assert.equal(r.coinRewardCoverage.missingOrderCount,1);assert.equal(r.coinRewardCoverage.missingProbability,.75);
});
test('zero probability orders with missing prices do not block the mean',()=>{
 const c=fixture();c.products[1].coinValue=null;const r=summary(c,[1,0]);assert.equal(r.stats.coinReward.mean,70);assert.equal(r.coinRewardCoverage.missingOrderCount,0);
});
test('actual zero prices remain valid zero rewards',()=>{
 const c=fixture();c.products.forEach(p=>p.coinValue=0);assert.equal(summary(c).stats.coinReward.mean,0);
});
test('level-locked and expired orders are excluded before the mean is calculated',()=>{
 const c=fixture();c.orders[1].minimumLevel=2;assert.equal(summary(c).stats.coinReward.mean,70);
 const d=fixture();d.orders[0].maximumLevel=1;assert.equal(summary(d,[.25,.75],2).stats.coinReward.mean,50);
});
test('estimated price coverage is tracked, and stale cached order totals are not used',()=>{
 const c=fixture();c.products[1].coinValueStatus='含估算';c.orders.forEach(o=>o.coinValue=99999);const r=summary(c);assert.equal(r.stats.coinReward.mean,55);assert.equal(r.coinRewardCoverage.estimatedProbability,.75);
});
test('blocked and empty results have no claimed average reward',()=>{
 const c=fixture();assert.equal(summary(c,[0,0]).stats.coinReward.mean,null);assert.equal(summarizeOrderOutcomes(c,{blocked:true,probabilities:[.25,.75]},1).stats.coinReward.mean,null);
});
console.log(count+' gold-reward checks passed');
