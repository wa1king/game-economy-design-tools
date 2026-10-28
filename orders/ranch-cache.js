// Separate, source/capacity/rule-scoped cache. Never writes ordinary project storage.
const dbName='ranch-schedules-v1';
function open(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open(dbName,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('levels');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function transaction(mode,perform){
  const db=await open();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('levels',mode),req=perform(tx.objectStore('levels'));let value;
    req.onsuccess=()=>{value=req.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
export const loadRanchCache=key=>transaction('readonly',store=>store.get(key));
export const saveRanchCache=(key,value)=>transaction('readwrite',store=>store.put(value,key));
export function mergeRanchCacheValue(previous,value){
  const results=new Map(previous?.results??[]),failures=new Map(previous?.failures??[]),quantityFits=new Map(previous?.quantityFits??[]);
  for(const [key,result] of value.results??[]){
    const old=results.get(key);
    if(!old||result.proven||(!old.proven&&Number(result.feasibleMinutes)<=Number(old.feasibleMinutes)))results.set(key,result);
  }
  for(const [key,error] of value.failures??[])if(!results.has(key))failures.set(key,error);
  for(const key of results.keys())failures.delete(key);
  for(const [key,fit] of value.quantityFits??[])quantityFits.set(key,fit);
  return {version:2,results:[...results],failures:[...failures],quantityFits:[...quantityFits]};
}
// Read and merge within one IndexedDB write transaction, so a second view cannot
// overwrite a freshly completed schedule with its older in-memory snapshot.
export async function mergeRanchCache(key,value){
  const db=await open();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('levels','readwrite'),store=tx.objectStore('levels'),req=store.get(key);let merged;
    req.onsuccess=()=>{merged=mergeRanchCacheValue(req.result,value);store.put(merged,key);};
    tx.oncomplete=()=>resolve(merged);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
