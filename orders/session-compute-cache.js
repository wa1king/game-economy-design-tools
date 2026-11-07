import {buildCatalog,levelInfo,normalizedSourceWeights} from './order-engine.js';
import {normalizedMixWeights} from './mix-weights.js';
import {fitCacheKey} from './fit-cache.js';
import {ranchSettingsKey,ranchImportCacheKey} from './ranch-import.js';
import {prepareRanch,ranchCapacities} from './ranch-engine.js';
import {readRanchSettings,RANCH_QUANTITY_RULES_KEY} from './order-quantity-rules.js';

const stores={ordinary:['ordinary-order-fits','results'],ranch:['ranch-schedules-v1','levels']};
const clone=value=>JSON.parse(JSON.stringify(value));
function openStore(kind){return new Promise((resolve,reject)=>{
  const [name,store]=stores[kind],request=indexedDB.open(name,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(store);
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
export async function readComputeRecords(kind,keys){
  const db=await openStore(kind);
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction(stores[kind][1],'readonly'),store=tx.objectStore(stores[kind][1]),records=[];
    for(const key of keys){const request=store.get(key);request.onsuccess=()=>{if(request.result!=null)records.push({key,value:request.result});};}
    tx.oncomplete=()=>resolve(records);tx.onerror=tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
export async function putMissingComputeRecords(kind,records){
  if(!records.length)return;
  const db=await openStore(kind);
  try{await new Promise((resolve,reject)=>{
    const tx=db.transaction(stores[kind][1],'readwrite'),store=tx.objectStore(stores[kind][1]);
    for(const {key,value} of records){const request=store.get(key);request.onsuccess=()=>{if(request.result==null)store.put(value,key);};}
    tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
export async function computeCacheKeys(project,storage){
  const catalog=buildCatalog(project.base,project.rules),ordinary=[];
  for(let level=1;level<=catalog.maxLevel;level++){
    const c=project.configs[level],info=levelInfo(catalog,level),rawWeights=catalog.sources.map(s=>Number(c.weights[s.id]??1));
    const config={level,mix:normalizedMixWeights(c.mix,info.counts),mean:Number(c.mean),variance:Number(c.variance),sigma:Math.sqrt(Number(c.variance)),shares:normalizedSourceWeights(rawWeights,info.active),sourceEnabled:c.sourceEnabled,shapeStrength:400,probabilityScale:project.probabilityScale,minimumOrderWeight:c.minimumOrderWeight};
    ordinary.push(await fitCacheKey(catalog,config));
  }
  const settings=readRanchSettings(storage,ranchSettingsKey(project.base)),model=prepareRanch(project.base,settings),rules={cropQuantity:Number(settings.cropQuantity),productQuantity:Number(settings.productQuantity),allowRepeated:settings.allowRepeated??false};
  const ranch=Array.from({length:catalog.maxLevel},(_,i)=>{const level=i+1,capacities={...ranchCapacities(model,level),...(settings.capacities?.[level]??{})};return ranchImportCacheKey(project.base,level,rules,capacities);});
  return {ordinary,ranch};
}
export function validateComputeCache(value,project){
  if(value==null)return null;
  if(value.version!==1||!Array.isArray(value.settings)||!Array.isArray(value.ordinary)||!Array.isArray(value.ranch))throw Error('计算缓存备份格式无效。');
  const allowed=new Set([ranchSettingsKey(project.base),RANCH_QUANTITY_RULES_KEY]),settings=new Set();
  for(const entry of value.settings){
    if(!entry||!allowed.has(entry.key)||settings.has(entry.key)||!entry.value||typeof entry.value!=='object'||Array.isArray(entry.value))throw Error('牧场设置备份无效。');
    settings.add(entry.key);
  }
  for(const kind of ['ordinary','ranch']){
    const seen=new Set();
    for(const entry of value[kind]){
      if(!entry||typeof entry.key!=='string'||seen.has(entry.key)||!entry.value)throw Error('计算缓存条目无效。');
      seen.add(entry.key);
      if(kind==='ordinary'){
        const v=entry.value;
        if(!/^ordinary-fit-v1:[a-f0-9]{64}$/.test(entry.key)||v.version!=='ordinary-fit-v1'||!Array.isArray(v.orderIds)||!Array.isArray(v.result?.probabilities)||v.result.probabilities.length!==v.orderIds.length||v.result.probabilities.some(n=>!Number.isFinite(n)||n<0)||Math.abs(v.result.probabilities.reduce((a,b)=>a+b,0)-1)>1e-7)throw Error('普通订单拟合缓存无效。');
      }else{
        let parts;try{parts=JSON.parse(entry.key.slice('ranch-catalog-v3:'.length));}catch{}
        if(!entry.key.startsWith('ranch-catalog-v3:')||!Array.isArray(parts)||JSON.stringify(parts[0])!==JSON.stringify(project.base)||!Number.isInteger(parts[1])||parts[1]<1||parts[1]>project.base.maxLevel||![1,2].includes(entry.value.version)||!Array.isArray(entry.value.results)||!Array.isArray(entry.value.failures)||!Array.isArray(entry.value.quantityFits??[]))throw Error('牧场排程缓存与项目不一致。');
      }
    }
  }
  return value;
}
export async function captureComputeCache(project,storage,{read=readComputeRecords}={}){
  const keys=await computeCacheKeys(project,storage),settings=[];
  for(const key of [ranchSettingsKey(project.base),RANCH_QUANTITY_RULES_KEY]){const raw=storage.getItem(key);if(raw!=null)settings.push({key,value:JSON.parse(raw)});}
  const [ordinary,ranch]=await Promise.all([read('ordinary',keys.ordinary),read('ranch',keys.ranch)]);
  return clone(validateComputeCache({version:1,settings,ordinary,ranch},project));
}
export async function restoreComputeCache(snapshot,{put=putMissingComputeRecords}={}){
  const caches=validateComputeCache(snapshot.computeCache,snapshot.project);if(!caches)return;
  await put('ordinary',caches.ordinary);await put('ranch',caches.ranch);
}
