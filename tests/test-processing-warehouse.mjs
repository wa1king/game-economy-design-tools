import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
const require=createRequire(import.meta.url),{rows,settings}=require('../processing/turnover.js');
const design={buildings:[{id:10,name:'磨坊',level:2},{id:20,name:'厨房',level:4}],products:[
  {id:1,name:'小麦',level:1,building:0,inputs:[]},
  {id:2,name:'玉米',level:3,building:0,inputs:[]},
  {id:3,name:'面粉',level:2,building:10,inputs:[[1,3]]},
  {id:4,name:'玉米粉',level:3,building:10,inputs:[[2,5]]},
  {id:5,name:'饼',level:4,building:20,inputs:[[3,2],[1,1]]}
]};
test('each level reserves two orders per unlocked kind; crops are not counted again as processed items',()=>{
  const actual=rows(design);
  const expected=[
    [1,0,0,12,0,12,12],
    [1,1,9,12,2,14,23],
    [2,2,15,24,4,28,43],
    [2,3,24,24,6,30,54]
  ];
  for(let i=0;i<4;i++){
    const r=actual[i];assert.deepEqual([r.cropKinds,r.productKinds,r.total,r.cropStock,r.productStock,r.orderStock,r.expectedCapacity],expected[i]);
  }
  assert.equal(actual[19].expectedCapacity,54);
  // The independent SKU maxima exceed simultaneous consumption; never sum them.
  assert.equal([...actual[2].capacities.values()].reduce((a,b)=>a+(b??0),0),24);
  assert.equal(actual[2].total,15);
});
test('queue length and active-slot changes affect consumption, but never order stock',()=>{
  const d=structuredClone(design);d.turnover=settings(d);d.turnover.includeActive=false;
  assert.equal(rows(d)[3].expectedCapacity,46);
  d.turnover.queues[10][3]=4;
  const r=rows(d)[3];assert.equal(r.total,26);assert.equal(r.orderStock,30);assert.equal(r.expectedCapacity,56);
});
test('zero unlocked kinds and crops-only stages have no processing reserve',()=>{
  const d={buildings:[],products:[{id:1,level:3,building:0,inputs:[]}]};
  assert.equal(rows(d)[0].expectedCapacity,0);assert.equal(rows(d)[2].expectedCapacity,12);
});
test('incomplete recipes remain flagged instead of presenting a complete capacity estimate',()=>{
  const d=structuredClone(design);d.products[4].inputs=[];
  const r=rows(d)[3];assert.equal(r.complete,false);assert.deepEqual(r.invalid,[5]);
  assert.equal(r.orderStock,30);assert.equal(r.expectedCapacity,r.total+30);
});
