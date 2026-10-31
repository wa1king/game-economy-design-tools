import test from 'node:test';
import assert from 'node:assert/strict';

test('retained worker keeps exact-demand reuse and separates changed imports and request IDs',async()=>{
  const original=globalThis.self,messages=[];
  globalThis.self={postMessage:value=>messages.push(structuredClone(value))};
  try{
    await import('../orders/ranch-worker.js');
    const base={maxLevel:2,sources:[{id:1,name:'工坊'}],products:[{id:1,name:'商品',buildingId:1,buildingName:'工坊',level:1,stepMinutes:10,analysisBatchYield:1,inputs:[]}]};
    const group={id:'g',slots:Array.from({length:4},()=>({id:1,quantity:1}))};
    const job={mode:'quantity',base,groups:[group],level:1,capacities:{1:1},options:{targetMinutes:80,toleranceMinutes:10,targetWorkMinutes:80,productMax:3,timeLimitMs:2000,orderWorkMinPercent:24,orderWorkMaxPercent:26}};
    await self.onmessage({data:{...job,requestId:1}});
    const first=messages.find(v=>v.type==='quantityResult');assert.equal(first.fit.recommendations[0].result.optimalMinutes,80);assert.equal(first.fit.options.orderWorkMinPercent,24);assert.equal(first.fit.options.orderWorkMaxPercent,26);
    assert(messages.every(v=>v.requestId===1));messages.length=0;
    await self.onmessage({data:{...job,level:2,requestId:2,options:{...job.options,orderWorkMinPercent:25,orderWorkMaxPercent:25}}});
    assert(messages.every(v=>v.requestId===2));
    const reused=messages.find(v=>v.type==='quantityResult');
    assert.equal(reused.fit.recommendations[0].result.optimalMinutes,80);assert.equal(reused.fit.options.orderWorkMinPercent,25);assert.equal(reused.fit.options.orderWorkMaxPercent,25);
    assert(reused.fit.recommendations.every(v=>v.result.scheduleReused));messages.length=0;
    const changed=structuredClone(base);changed.products[0].stepMinutes=11;
    await self.onmessage({data:{...job,base:changed,requestId:3}});
    assert(messages.every(v=>v.requestId===3));const next=messages.find(v=>v.type==='quantityResult');
    assert.equal(next.fit.recommendations[0].result.optimalMinutes,88);
    assert(next.fit.recommendations.every(v=>v.result.schedule.every(task=>task.duration===11)));
    assert.equal(messages.at(-1).type,'done');
  }finally{if(original===undefined)delete globalThis.self;else globalThis.self=original;}
});
