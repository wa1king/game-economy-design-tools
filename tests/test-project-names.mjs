import assert from 'node:assert/strict';
import test from 'node:test';
import {isPlaceholderProductName,productNameUpdates,applyProductNameUpdates} from '../orders/project-names.js';
import {buildCatalog} from '../orders/order-engine.js';
import {gameSignature,createGame,validateGameSave} from '../orders/game-engine.js';
const base={maxLevel:2,landsByLevel:{1:6,2:6},sources:[{id:0,name:'农田'},{id:1,name:'工坊',level:1}],products:[
 {id:1,name:'新作物1',level:1,buildingId:0,isCrop:true,stepMinutes:2,analysisBatchYield:1,coinValue:2,inputs:[]},
 {id:2,name:'新物品1',level:1,buildingId:1,stepMinutes:10,analysisBatchYield:1,coinValue:10,inputs:[{id:1,quantity:2}]}
]};
const named=()=>({...structuredClone(base),products:base.products.map((p,i)=>({...structuredClone(p),name:['芦苇草','芦苇丝'][i]}))});
test('only placeholder labels are proposed, by stable product IDs rather than source order',()=>{
 assert(isPlaceholderProductName('新作物1'));assert(isPlaceholderProductName('物品 18'));assert(!isPlaceholderProductName('芦苇草'));
 const candidate=named();candidate.products.reverse();const updates=productNameUpdates(base,candidate);
 assert.deepEqual(updates,[{id:1,from:'新作物1',to:'芦苇草'},{id:2,from:'新物品1',to:'芦苇丝'}]);
 const custom=structuredClone(base);custom.products[0].name='我的作物';assert.equal(productNameUpdates(custom,candidate).length,1);
});
test('different product sets, levels, buildings, duplicate names and placeholder-only sources are rejected',()=>{
 for(const mutate of [b=>b.products.pop(),b=>b.products[0].id=99,b=>b.products[0].level=2,b=>b.products[0].buildingId=9,b=>b.products[1].name=b.products[0].name]){const b=named();mutate(b);assert.deepEqual(productNameUpdates(base,b),[]);}
 assert.deepEqual(productNameUpdates(base,base),[]);
});
test('renaming leaves recipes, quantities, work and fitted probability positions unchanged',()=>{
 const before=structuredClone(base),updated=applyProductNameUpdates(base,productNameUpdates(base,named()));assert.deepEqual(base,before);
 const old=buildCatalog(base),next=buildCatalog(updated);
 assert.deepEqual(next.orders.map(({id,items,cumulativeMinutes,sourceMinutes,cumulativeComplexity})=>({id,items,cumulativeMinutes,sourceMinutes,cumulativeComplexity})),old.orders.map(({id,items,cumulativeMinutes,sourceMinutes,cumulativeComplexity})=>({id,items,cumulativeMinutes,sourceMinutes,cumulativeComplexity})));
 for(let i=0;i<base.products.length;i++){const {name,gameIdentityName,...p}=updated.products[i],{name:oldName,...original}=base.products[i];assert.deepEqual(p,original);assert.equal(gameIdentityName,oldName);}
 assert(next.orders.some(o=>o.description.includes('芦苇草')));
});
test('renaming keeps the existing simulation save identity and progress valid',()=>{
 const old=buildCatalog(base),next=buildCatalog(applyProductNameUpdates(base,productNameUpdates(base,named()))),result={config:{level:1,mix:[100,0,0],sourceEnabled:false},probabilities:old.orders.map(()=>1/old.orders.length)};
 assert.equal(gameSignature(next,result),gameSignature(old,result));
 const save=createGame(old,result,{seed:123},100000),snapshot=structuredClone(save);validateGameSave(save,next,result);assert.deepEqual(save,snapshot);
});
test('a stale or invalid rename request cannot overwrite names',()=>{
 const updates=productNameUpdates(base,named()),b=structuredClone(base);b.products[0].name='已改名';assert.throws(()=>applyProductNameUpdates(b,updates),/已变化/);assert.throws(()=>applyProductNameUpdates(base,[{id:99,to:'未知'}]),/无效/);
});
