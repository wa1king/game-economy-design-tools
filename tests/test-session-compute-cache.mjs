import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import fs from 'node:fs';
import {buildCatalog} from '../orders/order-engine.js';
import {createFitCache} from '../orders/fit-cache.js';
import {computeCacheKeys,captureComputeCache,restoreComputeCache,validateComputeCache} from '../orders/session-compute-cache.js';
import {createSessionSnapshot,restoreSessionSnapshot,fetchSharedSession} from '../orders/session-snapshot.js';
import {ranchSettingsKey} from '../orders/ranch-import.js';
import {ensureSharedSession} from '../orders/shared-session-bootstrap.js';

const memory=()=>{const m=new Map();return {get length(){return m.size;},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const fixture=JSON.parse(fs.readFileSync(new URL('../orders/shared-session.json',import.meta.url),'utf8'));
const project={...fixture.project,base:{...fixture.project.base,maxLevel:2,sources:[{id:0,name:'农田',category:'田地',level:1}],products:[{id:1,name:'小麦',level:1,buildingId:0,isCrop:true,stepMinutes:2,analysisBatchYield:1,inputs:[],coinValue:5}],landsByLevel:{1:6,2:12}},activeLevel:1,customOrders:{version:1,levels:{}},probabilityScale:10000,configs:{1:{mix:[100,0,0],mean:12,variance:0,weights:{0:1},sourceEnabled:false,minimumOrderWeight:false},2:{mix:[100,0,0],mean:12,variance:0,weights:{0:1},sourceEnabled:false,minimumOrderWeight:false}}};

async function sample(){
  const storage=memory(),ordinary=new Map(),ranch=new Map(),settingsKey=ranchSettingsKey(project.base);
  storage.setItem(settingsKey,JSON.stringify({unlockLevel:2,objective:'coins',quantityTargetsByLevel:{2:{targetCoins:'300',coinTolerance:'30'}},quantityEdits:{2:{sample:[2,2,2,2]}}}));
  storage.setItem('unrelated-secret','must never leave browser');storage.setItem('ranch-settings-v1:other','old project');
  const keys=await computeCacheKeys(project,storage),catalog=buildCatalog(project.base,project.rules);
  const result={probabilities:catalog.orders.map((_,i)=>i===0?1:0),mean:12,matched:true};
  await createFitCache({storage:{get:async k=>ordinary.get(k),set:async(k,v)=>ordinary.set(k,v)}}).save(catalog,{level:1,mix:[100,0,0],mean:12,variance:0,sigma:0,sourceEnabled:false,shares:[100],shapeStrength:400,probabilityScale:10000,minimumOrderWeight:false},result);
  assert(ordinary.has(keys.ordinary[0]));
  ranch.set(keys.ranch[1],{version:2,results:[['sample',{proven:true,optimalMinutes:42,schedule:[{start:0,end:42}]}]],failures:[],quantityFits:[]});
  const requested=[];
  const cache=await captureComputeCache(project,storage,{read:async(kind,list)=>{requested.push(...list);const db=kind==='ordinary'?ordinary:ranch;return list.filter(k=>db.has(k)).map(key=>({key,value:db.get(key)}));}});
  return {storage,cache,keys,ordinary,ranch,requested,settingsKey};
}
test('capture includes only current input keys, preserves exact probabilities and schedules, and never exports unrelated or prior projects',async()=>{
  const s=await sample();assert.equal(s.cache.ordinary.length,1);assert.equal(s.cache.ranch.length,1);assert.deepEqual(s.cache.ranch[0].value,[...s.ranch.values()][0]);assert.equal(s.cache.settings.length,1);assert(!JSON.stringify(s.cache).includes('secret'));assert(!JSON.stringify(s.cache).includes('old project'));
  const changed=structuredClone(project);changed.configs[2].mean=99;const after=await computeCacheKeys(changed,s.storage);assert.equal(after.ordinary[0],s.keys.ordinary[0]);assert.notEqual(after.ordinary[1],s.keys.ordinary[1]);
});
test('full restore retains unlock, user targets and quantities, seeds both caches, and refuses to overwrite existing user settings',async()=>{
  const s=await sample(),snapshot={...createSessionSnapshot(project,s.storage),computeCache:s.cache},target=memory(),saved={ordinary:new Map(),ranch:new Map()};
  await restoreComputeCache(snapshot,{put:async(kind,records)=>records.forEach(({key,value})=>{if(!saved[kind].has(key))saved[kind].set(key,value);})});
  restoreSessionSnapshot(target,snapshot);assert.deepEqual(JSON.parse(target.getItem(s.settingsKey)),JSON.parse(s.storage.getItem(s.settingsKey)));assert.deepEqual(JSON.parse(target.getItem('order-shared-chain-v1')).base,project.base);
  assert.equal(saved.ordinary.size,1);assert.equal(saved.ranch.size,1);const before=target.getItem(s.settingsKey);assert.equal(restoreSessionSnapshot(target,snapshot).restored,false);assert.equal(target.getItem(s.settingsKey),before);
});
test('cache validation rejects arbitrary settings, duplicates, invalid probabilities and another project schedule keys',async()=>{
  const s=await sample();for(const mutate of [c=>c.settings.push({key:'unrelated-secret',value:{}}),c=>c.ordinary.push(c.ordinary[0]),c=>c.ordinary[0].value.result.probabilities=[0],c=>c.ranch[0].key=c.ranch[0].key.replace('小麦','other')]){const c=structuredClone(s.cache);mutate(c);assert.throws(()=>validateComputeCache(c,project));}
});
test('first visit through either order system restores caches before project initialization; existing workspaces never fetch or change',async()=>{
  const s=await sample(),snapshot={...createSessionSnapshot(project,s.storage),computeCache:s.cache},target=memory(),events=[];
  const job=()=>ensureSharedSession({storage:target,fetchSession:async()=>{events.push('fetch');return snapshot;},restoreCache:async()=>{assert.equal(target.getItem('order-project-v3'),null);events.push('cache');}});
  const [a,b]=await Promise.all([job(),job()]);assert(a.restored&&b.restored);assert.deepEqual(events,['fetch','cache']);assert.equal(JSON.parse(target.getItem(s.settingsKey)).unlockLevel,2);
  target.setItem(s.settingsKey,'user change');await job();assert.equal(target.getItem(s.settingsKey),'user change');assert.deepEqual(events,['fetch','cache']);
  const existing=memory();existing.setItem('order-shared-chain-v1','existing');await ensureSharedSession({storage:existing,fetchSession:()=>{throw Error('must not fetch');}});assert.equal(existing.getItem('order-project-v3'),null);
});
test('compressed GitHub snapshot decompresses completely and old JSON-only deployments still load',async()=>{
  const s=await sample(),snapshot={...createSessionSnapshot(project,s.storage),computeCache:s.cache},compressed=gzipSync(JSON.stringify(snapshot));
  const loaded=await fetchSharedSession(async url=>{assert(url.endsWith('.gz'));return new Response(compressed);});assert.deepEqual(loaded,snapshot);
  const legacy=await fetchSharedSession(async url=>url.endsWith('.gz')?new Response(null,{status:404}):Response.json(snapshot));assert.deepEqual(legacy,snapshot);
});
