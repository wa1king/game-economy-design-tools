import {readSharedChainSource,SHARED_CHAIN_KEY,matchingChainIds} from './shared-chain-source.js';
export const PROJECT_STORAGE_KEY='order-project-v3';
const LEGACY_PROJECT_KEY='taoyuan-order-project-v2';

export function isImportedProject(saved){
  return Boolean(saved?.base?.products?.length&&saved.configs&&
    (saved.origin==='excel-import'||saved.base.schemaVersion==='order-lab-import-v1'||saved.base.source?.snapshot==='用户导入'));
}

// Old application versions can only write the legacy key. Import projects are
// migrated once, while built-in data and old standalone settings are ignored.
export function createProjectStore(storage){
  let expected=storage.getItem(PROJECT_STORAGE_KEY),expectedChain=storage.getItem(SHARED_CHAIN_KEY);
  return {
    load(){
      const raw=expected??storage.getItem(LEGACY_PROJECT_KEY);
      const shared=readSharedChainSource(storage);expectedChain=storage.getItem(SHARED_CHAIN_KEY);
      if(!raw)return shared?{origin:'excel-import',base:shared.base,filename:shared.filename,configs:{},customOrders:{}}:null;
      let saved;try{saved=JSON.parse(raw);}catch{throw Error('已保存项目无法读取，请重新导入 Excel。');}
      if(!isImportedProject(saved))return shared?{origin:'excel-import',base:shared.base,filename:shared.filename,configs:{},customOrders:{}}:null;
      if(!shared)return saved;
      const compatible=matchingChainIds(saved.base,shared.base);
      return compatible?{...saved,base:shared.base,filename:shared.filename}:{...saved,base:shared.base,filename:shared.filename,configs:{},customOrders:{}};
    },
    acceptLatest(){expected=storage.getItem(PROJECT_STORAGE_KEY);expectedChain=storage.getItem(SHARED_CHAIN_KEY);},
    save(project){
      if(storage.getItem(PROJECT_STORAGE_KEY)!==expected||storage.getItem(SHARED_CHAIN_KEY)!==expectedChain)throw Error('另一个页面已更新项目。请刷新本页后继续，当前页面不会覆盖已保存数值。');
      const value=JSON.stringify(project);storage.setItem(PROJECT_STORAGE_KEY,value);expected=value;
    }
  };
}
