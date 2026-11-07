import {PROJECT_STORAGE_KEY} from './project-storage.js';
import {fetchSharedSession,restoreSessionSnapshot} from './session-snapshot.js';
import {restoreComputeCache} from './session-compute-cache.js';

const pending=new WeakMap();
export function ensureSharedSession({storage=globalThis.localStorage,fetchSession=fetchSharedSession,restoreCache=restoreComputeCache}={}){
  const occupied=()=>[PROJECT_STORAGE_KEY,'order-shared-chain-v1','ranch-source-v1','taoyuan-order-project-v2'].some(key=>storage.getItem(key)!==null);
  if(occupied())return Promise.resolve({restored:false,reason:'existing-project'});
  if(pending.has(storage))return pending.get(storage);
  const job=(async()=>{
    const snapshot=await fetchSession();if(!snapshot||occupied())return {restored:false};
    await restoreCache(snapshot);
    if(occupied())return {restored:false,reason:'existing-project'};
    return restoreSessionSnapshot(storage,snapshot);
  })().finally(()=>pending.delete(storage));
  pending.set(storage,job);return job;
}
