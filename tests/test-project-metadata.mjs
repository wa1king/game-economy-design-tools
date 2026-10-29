import test from 'node:test';
import assert from 'node:assert/strict';
import {supplementProjectMetadata,restoreMissingProjectMetadata} from '../orders/project-metadata.js';
import {buildCatalog} from '../orders/order-engine.js';
import {prepareRanch,ranchCapacities,solveProductionDemand} from '../orders/ranch-engine.js';
import {ordinaryOrderReward} from '../orders/coin-values.js';
const base={maxLevel:2,sources:[{id:0,name:'农田'},{id:1,name:'工坊'}],products:[{id:1,name:'新作物1',level:1,buildingId:0,isCrop:true,stepMinutes:2,analysisBatchYield:1,inputs:[]},{id:2,name:'新物品1',level:2,buildingId:1,stepMinutes:5,analysisBatchYield:1,inputs:[{id:1,quantity:2}]}]};
const candidate=()=>({...structuredClone(base),landsByLevel:{1:6,2:6},products:base.products.map((p,i)=>({...structuredClone(p),name:['麦','面粉'][i],coinValue:[2,9][i]}))});
test('old imported metadata is restored without changing prices, names, formulas or targets',()=>{
 const saved={base:structuredClone(base),configs:{2:{mean:35,mix:[20,40,40],weights:{0:3}}},customOrders:{version:1,levels:{2:['S1-2']}}},original=structuredClone(saved),store=new Map([['ranch-source-v1',JSON.stringify({kind:'import',base:candidate()})]]),storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
 const result=restoreMissingProjectMetadata(saved,storage);assert.equal(result.lands,2);assert.equal(result.prices,2);assert.deepEqual(saved,original);assert.deepEqual(result.project.configs,saved.configs);assert.deepEqual(result.project.customOrders,saved.customOrders);assert.equal(result.base.products[0].name,'新作物1');assert.deepEqual(JSON.parse(store.get('order-project-before-metadata-v1')),saved);
 const c=buildCatalog(result.base),order=c.orders.find(o=>o.id==='S1-2'),m=prepareRanch(c),timing=solveProductionDemand(m,order.items,2,ranchCapacities(m,2));assert.equal(timing.optimalMinutes,7);assert.equal(ordinaryOrderReward(order,new Map(c.products.map(p=>[p.id,p]))),45);
});
test('existing valid land and coin values, including zero coins, are never overwritten',()=>{
 const b=structuredClone(base);b.landsByLevel={1:12};b.products[0].coinValue=0;const r=supplementProjectMetadata(b,candidate());assert.equal(r.base.landsByLevel[1],12);assert.equal(r.base.products[0].coinValue,0);assert.equal(r.lands,1);assert.equal(r.prices,1);assert.equal(supplementProjectMetadata(r.base,candidate()),null);
});
test('different production designs and missing local source cannot supply metadata',()=>{
 for(const change of [b=>b.products[1].inputs[0].quantity=3,b=>b.products[1].stepMinutes=6,b=>b.products[1].buildingId=0,b=>b.products.pop(),b=>b.products[1].analysisBatchYield=2]){const c=candidate();change(c);assert.equal(supplementProjectMetadata(base,c),null);}
 assert.equal(restoreMissingProjectMetadata({base},{getItem:()=>null}),null);
});

test('explicit metadata-only repair preserves a differing recipe; automatic recovery rejects it',()=>{
 const c=candidate();c.products[1].inputs[0].quantity=3;assert.equal(supplementProjectMetadata(base,c),null);
 const r=supplementProjectMetadata(base,c,{metadataOnly:true});assert.equal(r.prices,2);assert.deepEqual(r.base.products[1].inputs,base.products[1].inputs);assert.equal(r.base.products[1].stepMinutes,5);assert.equal(r.base.products[1].coinValue,9);
 c.products[1].buildingId=99;assert.equal(supplementProjectMetadata(base,c,{metadataOnly:true}),null);
});
