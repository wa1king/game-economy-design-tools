import test from 'node:test';
import assert from 'node:assert/strict';
import {ranchLevelCatalogRows} from '../orders/ranch-level-catalog.js';
const item=(id,quantity=1)=>({id,quantity});
const groups=[{id:'g1',types:['building'],slots:[item(1),item(1),item(1),item(1)]},{id:'g2',types:['chain'],slots:[item(1),item(1),item(2),item(2)]},{id:'g3',types:['building'],slots:[item(2),item(2),item(2),item(2)]}];
const data={g1:{totalMinutes:40,complexity:4,coinValue:10},g2:{totalMinutes:50,complexity:8,coinValue:20},g3:{totalMinutes:20,complexity:4,coinValue:null}},results={g1:{proven:true,optimalMinutes:5},g2:{proven:false,lowerMinutes:9,feasibleMinutes:12}};
const state={groups,viewRows:[groups[0]],products:new Map([[1,{name:'面粉',buildingId:10}],[2,{name:'糖',buildingId:11}]]),metrics:g=>data[g.id],resultFor:g=>results[g.id]};
test('all-level catalogue includes the full level even when the focused building contains only one group',()=>{
 const before=JSON.stringify(groups),rows=ranchLevelCatalogRows(state);assert.deepEqual(rows.map(r=>r.g.id),['g1','g2','g3']);assert.equal(rows[0].g.slots.length,4);assert.equal(JSON.stringify(groups),before);
});
test('type, source and product-name filters combine without changing the original catalogue',()=>{
 assert.deepEqual(ranchLevelCatalogRows(state,{type:'building'}).map(r=>r.g.id),['g1','g3']);assert.deepEqual(ranchLevelCatalogRows(state,{search:'糖',building:'11',type:'chain'}).map(r=>r.g.id),['g2']);assert.equal(ranchLevelCatalogRows(state,{search:'不存在'}).length,0);
});
test('work and quantity-independent metrics sort correctly; unknown times and prices stay last in either direction',()=>{
 assert.deepEqual(ranchLevelCatalogRows(state,{sort:'work',direction:'asc'}).map(r=>r.g.id),['g3','g1','g2']);assert.deepEqual(ranchLevelCatalogRows(state,{sort:'optimal',direction:'desc'}).map(r=>r.g.id),['g2','g1','g3']);assert.deepEqual(ranchLevelCatalogRows(state,{sort:'coins',direction:'desc'}).map(r=>r.g.id),['g2','g1','g3']);
});
