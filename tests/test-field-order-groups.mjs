import assert from 'node:assert/strict';
import {buildCatalog,levelInfo,availableAt} from '../orders/order-engine.js';
const p=(id,buildingId,inputs=[],level=1,extra={})=>({id,name:'商品'+id,buildingId,level,stepMinutes:id,analysisBatchYield:1,coinValue:1,isCrop:buildingId===0,inputs:inputs.map(id=>({id,quantity:1})),...extra});
const base={maxLevel:20,sources:[{id:0,name:'农田'},{id:10,name:'磨坊'},{id:20,name:'厨房'}],products:[p(1,0),p(2,0),p(3,0),p(4,10,[1]),p(5,10,[2]),p(6,20,[4])]};
const before=JSON.stringify(base),catalog=buildCatalog(base),keys=new Set(catalog.orders.map(o=>o.items.map(v=>v.id).sort((a,b)=>a-b).join(',')));
assert(keys.has('1,2'));assert(keys.has('1,2,3'));assert(keys.has('1,2,6'),'two crops and an indirect downstream product are allowed');
assert(!keys.has('4,5'),'two goods from the same processing building remain excluded');
for(const order of catalog.orders){
  const ids=order.items.map(v=>v.id);assert.equal(new Set(ids).size,ids.length);
  for(const [a,b] of [[1,4],[2,5],[4,6]])assert(!(ids.includes(a)&&ids.includes(b)),'direct recipe relationships are always excluded');
  assert.equal(order.sourceMinutes.reduce((a,b)=>a+b,0),order.cumulativeMinutes);
}
const cropPair=catalog.orders.find(o=>o.items.map(v=>v.id).join(',')==='1,2');assert.deepEqual(cropPair.items,[{id:1,quantity:7},{id:2,quantity:7}]);assert.equal(cropPair.cumulativeMinutes,21);
assert.equal(catalog.orders.filter(o=>o.itemTypes===3&&o.items.every(v=>v.id<=3)).length,1,'crop permutations do not create duplicates');
const solo=catalog.orders.find(o=>o.items.length===1&&o.items[0].id===1);assert(availableAt(solo,10));assert(!availableAt(solo,11));assert(availableAt(cropPair,20));
assert.equal(JSON.stringify(base),before);assert(catalog.assumptions.some(v=>v.includes('田地作物可同单')));
for(const source of [{id:91,name:'农田'},{id:92,name:'田地'},{id:93,name:'种植区',category:'田地'},{id:94,name:'种植区'}]){
  const c=buildCatalog({maxLevel:1,sources:[source],products:[p(1,source.id,[],1,source.id===94?{isCrop:true}:{}),p(2,source.id,[],1,source.id===94?{isCrop:true}:{}),p(3,source.id,[],1,source.id===94?{isCrop:true}:{})]});
  assert.equal(levelInfo(c,1).orders.length,7);assert.equal(c.orders.filter(o=>o.itemTypes===2).length,3);
}
const unmarked=buildCatalog({maxLevel:1,sources:[{id:8,name:'工坊'}],products:[p(1,8),p(2,8)]});assert.equal(unmarked.orders.length,2,'input-free workshop products must not be mistaken for farmland');
const later=buildCatalog({...base,products:base.products.map(v=>v.id===3?{...v,level:5}:v)});assert(!levelInfo(later,4).orders.some(o=>o.items.some(v=>v.id===3)));assert(levelInfo(later,5).orders.some(o=>o.items.map(v=>v.id).join(',')==='1,2,3'));
console.log('Field orders: crop pairs/triples and mixed orders retained; processing buildings, direct recipes, unlock levels, single windows, quantities and deduplication verified.');
