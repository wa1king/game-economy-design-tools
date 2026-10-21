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
