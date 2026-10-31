import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCatalog} from '../orders/order-engine.js';
import {fit} from '../orders/solver.js';
import {applyProbabilityPrecision} from '../orders/probability-precision.js';
import {createFitCache,fitCacheInput} from '../orders/fit-cache.js';
const base={maxLevel:2,sources:[{id:0,name:'农田'}],products:[{id:1,name:'麦',level:1,buildingId:0,isCrop:true,stepMinutes:2,analysisBatchYield:1,inputs:[]},{id:2,name:'玉米',level:2,buildingId:0,isCrop:true,stepMinutes:5,analysisBatchYield:1,inputs:[]}]};
const catalog=buildCatalog(base),config={level:1,mix:[100,0,0],mean:12,variance:0,sigma:0,sourceEnabled:false,shares:[100],shapeStrength:400,minimumOrderWeight:false,probabilityScale:10000};
const fitted=()=>applyProbabilityPrecision(catalog,fit(catalog,config),10000);
const store=()=>{const map=new Map();return {map,get:async k=>structuredClone(map.get(k)),set:async(k,v)=>{map.set(k,structuredClone(v));}};};
test('completed fits survive a new cache instance with their final probabilities and all statistics intact',async()=>{
 const storage=store(),r=fitted();await createFitCache({storage}).save(catalog,config,r);
 const loaded=await createFitCache({storage}).get(catalog,{...config,rawMixWeights:[5,0,0]});assert.deepEqual(loaded.probabilities,r.probabilities);assert.deepEqual(loaded.integerWeights,r.integerWeights);assert.equal(loaded.mean,12);assert.equal(loaded.matched,r.matched);assert.equal(loaded.config.rawMixWeights[0],5);
 loaded.probabilities[0]=0;assert.equal((await createFitCache({storage}).get(catalog,config)).probabilities[0],1);
});
test('only affected level inputs invalidate the cache; labels, prices and revision counters do not',async()=>{
 const storage=store(),cache=createFitCache({storage});await cache.save(catalog,config,fitted());
 for(const patch of [{mean:15},{mix:[0,100,0]},{probabilityScale:100000},{minimumOrderWeight:true},{variance:4,sigma:2},{sourceEnabled:true}])assert.equal(await cache.get(catalog,{...config,...patch}),null);
 const b=structuredClone(base);b.products[1].stepMinutes=90;const future=buildCatalog(b);assert(await cache.get(future,config),'Changing only future goods must preserve Lv1');
 b.products[0].stepMinutes=3;assert.equal(await cache.get(buildCatalog(b),config),null);
 const renamed=structuredClone(base);renamed.products[0].name='新名称';renamed.products[0].coinValue=123;assert(await cache.get(buildCatalog(renamed),{...config,revision:42}));
 assert(await cache.get(catalog,config),'Returning to the original targets reuses the original fit');
});
test('cached probability positions are remapped by order ID when later-level orders are inserted or reordered',async()=>{
 const storage=store();await createFitCache({storage}).save(catalog,config,fitted());
 const changed=structuredClone(base);changed.products.push({id:3,name:'豆',level:2,buildingId:0,isCrop:true,stepMinutes:8,analysisBatchYield:1,inputs:[]});const next=buildCatalog(changed);next.orders.reverse();
 const loaded=await createFitCache({storage}).get(next,config);assert(loaded);assert.equal(loaded.probabilities.length,next.orders.length);assert.equal(loaded.probabilities[next.orders.findIndex(o=>o.id==='S1-1')],1);assert.equal(loaded.probabilities.reduce((a,b)=>a+b,0),1);
});
test('missing, corrupt or unavailable storage is handled without treating broken probabilities as a fit',async()=>{
 let warnings=0;const cache=createFitCache({storage:{get:async()=>{throw Error('unavailable');},set:async()=>{throw Error('quota');}},onError:()=>warnings++});assert.equal(await cache.get(catalog,config),null);assert.equal(await cache.save(catalog,config,fitted()),false);assert.equal(warnings,2);assert(await cache.get(catalog,config),'A failed persistent write still preserves this page result');
 const storage=store();await createFitCache({storage}).save(catalog,config,fitted());const entry=[...storage.map.values()][0];entry.result.probabilities=[0];assert.equal(await createFitCache({storage}).get(catalog,config),null);
});
