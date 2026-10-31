import {availableAt} from './order-engine.js';
const VERSION='ordinary-fit-v1',vectors=['probabilities','continuousProbabilities','integerWeights'];
function database(){return new Promise((resolve,reject)=>{const req=indexedDB.open('ordinary-order-fits',1);req.onupgradeneeded=()=>req.result.createObjectStore('results');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function transact(mode,key,value){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('results',mode),store=tx.objectStore('results'),req=mode==='readonly'?store.get(key):store.put(value,key);let result;req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
const persistent={get:key=>transact('readonly',key),set:(key,value)=>transact('readwrite',key,value)};
export function fitCacheInput(catalog,c){
  const orders=catalog.orders.filter(o=>availableAt(o,c.level)).map(o=>[o.id,o.itemTypes,o.items,o.cumulativeMinutes,o.sourceMinutes]).sort((a,b)=>a[0].localeCompare(b[0]));
  return JSON.stringify([VERSION,c.level,catalog.sources.map(s=>s.id),orders,{mix:c.mix,mean:c.mean,variance:c.variance,sigma:c.sigma,sourceEnabled:Boolean(c.sourceEnabled),shares:c.sourceEnabled?c.shares:null,shapeStrength:c.shapeStrength,probabilityScale:c.probabilityScale,minimumOrderWeight:Boolean(c.minimumOrderWeight)}]);
}
export async function fitCacheKey(catalog,config){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fitCacheInput(catalog,config)));return VERSION+':'+Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');}
function pack(catalog,result){
  const selected=catalog.orders.map((o,i)=>({id:o.id,i})).filter(({i})=>vectors.some(v=>result[v]?.[i]>0)),compact={...result};
  for(const v of vectors)if(result[v]!=null)compact[v]=selected.map(({i})=>result[v][i]);
  return {version:VERSION,orderIds:selected.map(o=>o.id),result:compact};
}
function unpack(catalog,config,entry){
  if(entry?.version!==VERSION||!Array.isArray(entry.orderIds)||!entry.result)return null;
  const by=new Map(catalog.orders.map((o,i)=>[o.id,i]));if(new Set(entry.orderIds).size!==entry.orderIds.length||entry.orderIds.some(id=>!by.has(id)))return null;
  const result=structuredClone(entry.result);if(result.blocked||!Array.isArray(result.probabilities))return null;
  for(const v of vectors)if(result[v]!=null){if(!Array.isArray(result[v])||result[v].length!==entry.orderIds.length||result[v].some(n=>!Number.isFinite(n)||n<0))return null;const full=catalog.orders.map(()=>0);entry.orderIds.forEach((id,i)=>{full[by.get(id)]=result[v][i];});result[v]=full;}
  if(Math.abs(result.probabilities.reduce((a,b)=>a+b,0)-1)>1e-7)return null;
  result.config=structuredClone(config);return result;
}
export function createFitCache({storage=persistent,onError=()=>{}}={}){
  const memory=new Map();
  return {
    async get(catalog,config){try{const key=await fitCacheKey(catalog,config),entry=memory.get(key)??await storage.get(key);if(!entry)return null;const result=unpack(catalog,config,entry);if(result)memory.set(key,entry);return result;}catch(e){onError(e);return null;}},
    async save(catalog,config,result){const key=await fitCacheKey(catalog,config),entry=pack(catalog,result);memory.set(key,entry);try{await storage.set(key,entry);return true;}catch(e){onError(e);return false;}}
  };
}
