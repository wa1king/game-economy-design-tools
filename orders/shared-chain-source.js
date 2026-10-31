import {buildCatalog} from './order-engine.js';
import {prepareRanch} from './ranch-engine.js';
import {ranchSettingsKey,canMigrateRanchSettings} from './ranch-import.js';

export const SHARED_CHAIN_KEY='order-shared-chain-v1';
const read=(storage,key)=>{try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}};
export const matchingChainIds=(a,b)=>canMigrateRanchSettings(a,b);

// Import data has one owner. Ordinary fitting and ranch scheduling retain their
// independent settings/caches; an import never runs either calculation.
export function readSharedChainSource(storage=globalThis.localStorage){
  const shared=read(storage,SHARED_CHAIN_KEY);if(shared?.base)return shared;
  const ranch=read(storage,'ranch-source-v1'),ordinary=read(storage,'order-project-v3')??read(storage,'taoyuan-order-project-v2');
  const candidate=ranch?.kind==='import'&&ranch.base?ranch:ordinary?.origin==='excel-import'||ordinary?.base?.schemaVersion==='order-lab-import-v1'?ordinary:null;
  if(!candidate?.base)return null;
  writeSharedChainSource(candidate.base,candidate.filename,storage);return read(storage,SHARED_CHAIN_KEY);
}

export function writeSharedChainSource(base,filename,storage=globalThis.localStorage){
  if(!base?.products?.length||!Array.isArray(base.sources))throw Error('没有可导入的加工链路数据。');
  buildCatalog(base);prepareRanch(base);
  const next={version:1,base:structuredClone(base),filename:filename??base.filename??'加工链路.xlsx'};
  const old=read(storage,SHARED_CHAIN_KEY),ranch=read(storage,'ranch-source-v1'),ordinary=read(storage,'order-project-v3');
  if(old&&JSON.stringify(old.base)===JSON.stringify(next.base)&&old.filename===next.filename)return old;
  // Keep one restore point without replacing the ordinary project's guarded save.
  storage.setItem('order-shared-chain-before-import-v1',JSON.stringify({shared:old,ranch,ordinary}));
  const previous=old?.base??(ranch?.kind==='import'?ranch.base:ordinary?.base);
  const key=ranchSettingsKey(base);
  if(previous&&matchingChainIds(previous,base)&&storage.getItem(key)==null){
    const settings=storage.getItem(ranchSettingsKey(previous));if(settings!=null)storage.setItem(key,settings);
  }
  storage.setItem(SHARED_CHAIN_KEY,JSON.stringify(next));
  return next;
}
