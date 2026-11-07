import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSessionSnapshot,validateSessionSnapshot,restoreSessionSnapshot,fetchSharedSession} from '../orders/session-snapshot.js';
import {PROJECT_STORAGE_KEY} from '../orders/project-storage.js';

const fixture=JSON.parse(fs.readFileSync(new URL('../orders/shared-session.json',import.meta.url),'utf8'));
const memory=entries=>{const m=new Map(entries);return {get length(){return m.size;},key:i=>[...m.keys()][i]??null,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),entries:()=>[...m]};};
const tests=[];async function test(name,fn){await fn();tests.push(name);}

await test('export preserves imported product values, raw level weights, precision and game records',()=>{
  const p=structuredClone(fixture.project);p.configs[1].mix=[2,4,4];
  const s=memory(fixture.gameSaves.map(g=>[g.key,JSON.stringify(g.state)]));
  s.setItem('unrelated-app-data','not exported');s.setItem(fixture.gameSaves[0].key+':backup','old backup');
  const result=createSessionSnapshot(p,s,new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(result.project,p);assert.deepEqual(result.gameSaves,fixture.gameSaves);assert(!JSON.stringify(result).includes('not exported'));assert.deepEqual(result.project.configs[1].mix,[2,4,4]);
});
await test('empty-browser restore copies the project and all saved inventory, money, jobs and settings',()=>{
  const s=memory();const r=restoreSessionSnapshot(s,fixture);assert(r.restored);assert.deepEqual(JSON.parse(s.getItem(PROJECT_STORAGE_KEY)),fixture.project);
  for(const g of fixture.gameSaves)assert.deepEqual(JSON.parse(s.getItem(g.key)),g.state);
});
await test('automatic initialization never replaces an existing project or game',()=>{
  const s=memory([[PROJECT_STORAGE_KEY,'existing project'],[fixture.gameSaves[0].key,'existing progress']]);const before=s.entries();assert.equal(restoreSessionSnapshot(s,fixture).restored,false);assert.deepEqual(s.entries(),before);
  const onlyGame=memory([[fixture.gameSaves[0].key,'existing progress']]);restoreSessionSnapshot(onlyGame,fixture);assert.equal(onlyGame.getItem(fixture.gameSaves[0].key),'existing progress');
});
await test('explicit restore preserves exact old bytes before replacing matching records',()=>{
  const s=memory([[PROJECT_STORAGE_KEY,'old project bytes'],[fixture.gameSaves[0].key,'old game bytes'],['another-app','keep']]);
  const r=restoreSessionSnapshot(s,fixture,{overwrite:true,now:123});const backup=JSON.parse(s.getItem(r.backupKey));assert.equal(backup.entries.find(e=>e.key===PROJECT_STORAGE_KEY).value,'old project bytes');assert.equal(backup.entries.find(e=>e.key===fixture.gameSaves[0].key).value,'old game bytes');assert.equal(s.getItem('another-app'),'keep');
});
await test('failed writes roll back completed writes and preserve the restore backup',()=>{
  const s=memory([[PROJECT_STORAGE_KEY,'old project'],[fixture.gameSaves[0].key,'old game']]),write=s.setItem;
  s.setItem=(k,v)=>{if(k===fixture.gameSaves[0].key&&v!=='old game')throw Error('quota');write(k,v);};
  assert.throws(()=>restoreSessionSnapshot(s,fixture,{overwrite:true,now:456}),/已回滚/);assert.equal(s.getItem(PROJECT_STORAGE_KEY),'old project');assert.equal(s.getItem(fixture.gameSaves[0].key),'old game');assert(s.getItem('order-session-before-restore:456'));
});
await test('backup creation failure prevents any active record changes',()=>{
  const s=memory([[PROJECT_STORAGE_KEY,'old project']]),write=s.setItem;s.setItem=(k,v)=>{if(k.startsWith('order-session-before-restore:'))throw Error('quota');write(k,v);};assert.throws(()=>restoreSessionSnapshot(s,fixture,{overwrite:true}),/quota/);assert.equal(s.getItem(PROJECT_STORAGE_KEY),'old project');assert.equal(s.length,1);
});
await test('malformed projects, invalid keys and duplicate game records are rejected before writing',()=>{
  const bad=structuredClone(fixture);bad.project.configs[1].mean=-1;assert.throws(()=>validateSessionSnapshot(bad),/Lv 1/);
  const wrong=structuredClone(fixture);wrong.gameSaves[0].key='unrelated-app';const s=memory();assert.throws(()=>restoreSessionSnapshot(s,wrong),/经营存档/);assert.equal(s.length,0);
  const duplicate=structuredClone(fixture);duplicate.gameSaves.push(duplicate.gameSaves[0]);assert.throws(()=>validateSessionSnapshot(duplicate),/经营存档/);
});
await test('shared-session fetch distinguishes missing data from invalid or failed responses',async()=>{
  assert.equal(await fetchSharedSession(async(url)=>url.endsWith('.gz')?{status:404}:({status:404})),null);
  assert.deepEqual(await fetchSharedSession(async(url)=>url.endsWith('.gz')?{status:404}:({ok:true,status:200,json:async()=>fixture})),fixture);
  await assert.rejects(fetchSharedSession(async(url)=>url.endsWith('.gz')?{status:404}:({ok:false,status:500})),/读取/);
  await assert.rejects(fetchSharedSession(async(url)=>url.endsWith('.gz')?{status:404}:({ok:true,status:200,json:async()=>({})})),/备份/);
});
console.log(JSON.stringify({passed:tests.length,tests},null,2));
