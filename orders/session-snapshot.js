import {isImportedProject,PROJECT_STORAGE_KEY} from './project-storage.js';
import {buildCatalog} from './order-engine.js';
import {normalizeCustomOrders} from './custom-orders.js';

export const SESSION_SCHEMA='order-session-snapshot-v1';
const gameKey=/^order-game-v1:(game-v([12])-\d+-[a-f0-9]+-[a-f0-9]+)$/;
const clone=value=>JSON.parse(JSON.stringify(value));

export function validateSessionSnapshot(value){
  if(!value||value.schemaVersion!==SESSION_SCHEMA||!isImportedProject(value.project))throw Error('不是有效的订单项目备份。');
  const snapshot=clone(value),p=snapshot.project,c=buildCatalog(p.base,p.rules);
  if(p.customOrders!=null)normalizeCustomOrders(p.customOrders,c.maxLevel);
  if(!Number.isInteger(p.activeLevel)||p.activeLevel<1||p.activeLevel>c.maxLevel)throw Error('备份中的当前等级无效。');
  for(let level=1;level<=c.maxLevel;level++){
    const s=p.configs[level];
    if(!s||!Array.isArray(s.mix)||s.mix.length!==3||s.mix.some(n=>!Number.isFinite(n)||n<0)||!Number.isFinite(s.mean)||s.mean<0||!Number.isFinite(s.variance)||s.variance<0||!s.weights||typeof s.weights!=='object'||Object.values(s.weights).some(n=>!Number.isFinite(n)||n<0))throw Error(`Lv ${level} 的目标配置无效。`);
  }
  if(!Array.isArray(snapshot.gameSaves)||snapshot.gameSaves.length>10000)throw Error('经营存档清单无效。');
  const seen=new Set();
  for(const item of snapshot.gameSaves){
    const match=typeof item?.key==='string'&&item.key.match(gameKey),state=item?.state;
    if(!match||seen.has(item.key)||!state||state.signature!==match[1]||state.version!==Number(match[2])||!state.settings||!state.inventory||!Array.isArray(state.jobs)||!Array.isArray(state.board))throw Error('备份含有无效或重复的经营存档。');
    seen.add(item.key);
  }
  return snapshot;
}

export function createSessionSnapshot(project,storage,now=new Date()){
  const gameSaves=[];
  // Only this tool's active game records are included. Recovery copies and other
  // applications' browser data never enter the shared snapshot.
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i);if(!gameKey.test(key||''))continue;
    let state;try{state=JSON.parse(storage.getItem(key));}catch{throw Error('存在无法读取的经营存档，请先备份或恢复该存档。');}
    gameSaves.push({key,state});
  }
  gameSaves.sort((a,b)=>a.key.localeCompare(b.key));
  return validateSessionSnapshot({schemaVersion:SESSION_SCHEMA,createdAt:now.toISOString(),project:clone(project),gameSaves});
}

export function restoreSessionSnapshot(storage,input,{overwrite=false,now=Date.now()}={}){
  const snapshot=validateSessionSnapshot(input),current=storage.getItem(PROJECT_STORAGE_KEY);
  if(current!==null&&!overwrite)return {restored:false,reason:'existing-project'};
  const entries=[{key:PROJECT_STORAGE_KEY,value:JSON.stringify(snapshot.project)},...snapshot.gameSaves.map(g=>({key:g.key,value:JSON.stringify(g.state)})).filter(e=>overwrite||storage.getItem(e.key)===null)];
  const previous=entries.map(e=>({key:e.key,value:storage.getItem(e.key)}));
  let backupKey=null;
  if(overwrite&&previous.some(e=>e.value!==null)){
    backupKey=`order-session-before-restore:${now}`;
    while(storage.getItem(backupKey)!==null)backupKey+='-copy';
    storage.setItem(backupKey,JSON.stringify({schemaVersion:'order-session-restore-backup-v1',entries:previous}));
  }
  const written=[];
  try{for(const e of entries){storage.setItem(e.key,e.value);written.push(e.key);}}
  catch(error){
    let failed=false;
    for(const key of written.reverse()){
      const old=previous.find(e=>e.key===key);
      try{if(old.value===null)storage.removeItem(key);else storage.setItem(key,old.value);}catch{failed=true;}
    }
    throw Error(failed?'恢复未完成，原内容已保存在恢复前备份中。':'恢复未完成，已回滚；请检查浏览器存储空间。',{cause:error});
  }
  return {restored:true,games:snapshot.gameSaves.length,backupKey};
}

export async function fetchSharedSession(fetcher=fetch){
  const response=await fetcher('./shared-session.json',{cache:'no-store'});
  if(response.status===404)return null;
  if(!response.ok)throw Error('读取已同步配置失败。');
  return validateSessionSnapshot(await response.json());
}
