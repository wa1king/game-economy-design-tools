import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCatalog} from '../orders/order-engine.js';
import {prepareRanch,ranchCapacities,solveProductionDemand,solveRanchGroup} from '../orders/ranch-engine.js';
import {createOrderTimingService} from '../orders/order-time.js';
import {projectExportSheets} from '../orders/project-export.js';
const base={maxLevel:2,landsByLevel:{1:1,2:6},sources:[{id:0,name:'农田',category:'田地'},{id:1,name:'磨坊'},{id:2,name:'糖坊'}],products:[
 {id:1,name:'麦',level:1,buildingId:0,isCrop:true,stepMinutes:2,analysisBatchYield:1,inputs:[]},
 {id:2,name:'玉米',level:1,buildingId:0,isCrop:true,stepMinutes:5,analysisBatchYield:1,inputs:[]},
 {id:3,name:'粉',level:1,buildingId:1,stepMinutes:10,analysisBatchYield:1,inputs:[{id:1,quantity:2}]},
 {id:4,name:'糖',level:1,buildingId:2,stepMinutes:20,analysisBatchYield:1,inputs:[{id:2,quantity:1}]}
]};
const solve=(items,level=2)=>{const m=prepareRanch(base);return solveProductionDemand(m,items,level,ranchCapacities(m,level),{timeLimitMs:2000,nodeLimit:20000});};
test('whole-order optimization accounts for parallel sources instead of adding individual completion times',()=>{
 const flour=solve([{id:3,quantity:2}]),sugar=solve([{id:4,quantity:1}]),both=solve([{id:3,quantity:2},{id:4,quantity:1}]);
 assert.equal(flour.optimalMinutes,22);assert.equal(sugar.optimalMinutes,25);assert.equal(both.optimalMinutes,25);assert.notEqual(both.optimalMinutes,flour.optimalMinutes+sugar.optimalMinutes);
 assert.equal(both.totalMinutes,53);assert(both.proven);
 for(const t of both.schedule)if(t.productId===3)assert(t.start>=2);
});
test('crop order quantity and current-level land capacity determine parallel harvesting waves',()=>{
 assert.equal(solve([{id:1,quantity:7}],1).optimalMinutes,14);
 assert.equal(solve([{id:1,quantity:7}],2).optimalMinutes,4);
});
test('ordinary demands permit one to three goods while ranch groups still require four slots',()=>{
 const m=prepareRanch(base);assert.throws(()=>solveRanchGroup(m,{slots:[{id:1,quantity:1}]},2,ranchCapacities(m,2)),/四个/);
 assert(solve([{id:1,quantity:1},{id:2,quantity:1},{id:3,quantity:1}]).proven);
});
test('timing cache deduplicates requests and survives label changes but invalidates changed recipes',async()=>{
 let solves=0,terminated=0;
 const factory=()=>({postMessage(job){if(job.type==='solve'){solves++;setTimeout(()=>this.onmessage({data:{key:job.key,timing:{proven:true,optimalMinutes:12,feasibleMinutes:12,lowerMinutes:12}}}),0);}},terminate(){terminated++;}});
 const service=createOrderTimingService({workerFactory:factory}),o={items:[{id:3,quantity:1}]};
 service.ensure(base,[o,o],2);await service.waitFor(base,[{order:o,level:2}]);assert.equal(solves,1);assert.equal(service.get(base,o,2).optimalMinutes,12);
 const renamed=structuredClone(base);renamed.products[0].name='新名字';assert.equal(service.get(renamed,o,2).optimalMinutes,12);assert.equal(terminated,0);
 const changed=structuredClone(base);changed.products[2].inputs[0].quantity=3;assert.equal(service.get(changed,o,2),undefined);assert.equal(terminated,1);
 service.destroy();
});
test('custom Excel rows include joint optimized time and proof bounds without changing probability sheets',()=>{
 const c=buildCatalog(base),o=c.orders.find(o=>o.id==='S1-3'),p={customOrders:{version:1,levels:{2:[o.id]}},configs:{2:{mean:12,spreadPercent:0,sourceEnabled:false}},probabilityScale:10000};
 const sheets=projectExportSheets(c,p,[{level:2,status:'not_fitted',fit:null}],()=>({proven:true,optimalMinutes:12,lowerMinutes:12,feasibleMinutes:12}));
 const custom=sheets[1];assert.equal(custom.rows[1][custom.rows[0].indexOf('优化时间分钟')],12);assert.equal(custom.rows[1][custom.rows[0].indexOf('排产状态')],'已证明最优');assert.equal(sheets[0].rows.length,1);
});
test('late results from a replaced worker cannot enter the new recipe cache',()=>{
 const workers=[],factory=()=>{const w={postMessage(job){if(job.type==='solve')this.job=job;},terminate(){}};workers.push(w);return w;};
 const s=createOrderTimingService({workerFactory:factory}),o={items:[{id:3,quantity:1}]};s.ensure(base,[o],2);
 const changed=structuredClone(base);changed.products[2].stepMinutes=15;s.ensure(changed,[o],2);
 workers[0].onmessage({data:{key:workers[0].job.key,timing:{proven:true,optimalMinutes:99}}});assert.equal(s.get(changed,o,2),undefined);
 workers[1].onmessage({data:{key:workers[1].job.key,timing:{proven:true,optimalMinutes:17}}});assert.equal(s.get(changed,o,2).optimalMinutes,17);s.destroy();
});
test('order timing worker returns the computed joint result for ordinary orders',async()=>{
 const old=globalThis.self,messages=[];globalThis.self={postMessage:data=>messages.push(data)};
 try{await import('../orders/order-time-worker.js');self.onmessage({data:{type:'init',base}});self.onmessage({data:{type:'solve',key:'test',level:2,items:[{id:3,quantity:2},{id:4,quantity:1}]}});assert.equal(messages[0].timing.optimalMinutes,25);assert.equal(messages[0].timing.proven,true);}
 finally{if(old===undefined)delete globalThis.self;else globalThis.self=old;}
});
