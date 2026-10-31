import test from 'node:test';
import assert from 'node:assert/strict';
import {readSharedChainSource,writeSharedChainSource,SHARED_CHAIN_KEY} from '../orders/shared-chain-source.js';
import {createProjectStore} from '../orders/project-storage.js';
import {ranchSource} from '../orders/ranch-workspace.js';
import {ranchSettingsKey} from '../orders/ranch-import.js';
const base={maxLevel:2,landsByLevel:{1:6,2:12},sources:[{id:0,name:'田地',level:1},{id:10,name:'工坊',level:1}],products:[{id:1,name:'作物',buildingId:0,buildingName:'田地',level:1,isCrop:true,stepMinutes:2,analysisBatchYield:1,inputs:[],coinValue:1},{id:2,name:'商品',buildingId:10,buildingName:'工坊',level:1,isCrop:false,stepMinutes:5,analysisBatchYield:1,inputs:[{id:1,quantity:1}],coinValue:8}]};
const memory=entries=>{const map=new Map(entries);return {map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};
test('one explicit import is authoritative for ordinary and ranch, with both settings retained',()=>{
  const ordinary={origin:'excel-import',filename:'旧表.xlsx',base,configs:{1:{mean:17}},customOrders:{1:['x']}},s=memory([['order-project-v3',JSON.stringify(ordinary)]]);
  readSharedChainSource(s);const key=ranchSettingsKey(base),settings={quantityTargetsByLevel:{1:{targetHours:'7'}},quantityEdits:{1:{group:[2,3,4,5]}}};s.setItem(key,JSON.stringify(settings));
  const changed=structuredClone(base);changed.products[1].stepMinutes=9;changed.products[1].name='正式名称';
  writeSharedChainSource(changed,'新表.xlsx',s);
  assert.deepEqual(ranchSource(s).base,changed);assert.deepEqual(createProjectStore(s).load().base,changed);
  assert.deepEqual(createProjectStore(s).load().configs,ordinary.configs);assert.deepEqual(createProjectStore(s).load().customOrders,ordinary.customOrders);
  assert.deepEqual(JSON.parse(s.getItem(ranchSettingsKey(changed))),settings);assert.equal(JSON.parse(s.getItem('order-shared-chain-before-import-v1')).ordinary.filename,'旧表.xlsx');
});
test('first legacy migration uses the explicit ranch import once, then never resurrects the stale copy',()=>{
  const old=structuredClone(base);old.products[1].name='旧占位名';const s=memory([['ranch-source-v1',JSON.stringify({kind:'import',base,filename:'已导入.xlsx'})],['order-project-v3',JSON.stringify({origin:'excel-import',base:old,configs:{}})]]);
  assert.equal(createProjectStore(s).load().base.products[1].name,'商品');
  const next=structuredClone(base);next.products[1].name='另一次导入';writeSharedChainSource(next,'更新.xlsx',s);
  assert.equal(ranchSource(s).base.products[1].name,'另一次导入');assert.equal(readSharedChainSource(s).filename,'更新.xlsx');
});
test('stale ordinary tabs cannot overwrite a newer import, and incompatible datasets reset only ordinary configuration',()=>{
  const s=memory();writeSharedChainSource(base,'初始.xlsx',s);const store=createProjectStore(s),p=store.load();
  const next=structuredClone(base);next.products[1].id=12;writeSharedChainSource(next,'另一个.xlsx',s);
  assert.throws(()=>store.save(p),/另一个页面/);assert.deepEqual(createProjectStore(s).load().configs,{});assert.equal(JSON.parse(s.getItem(SHARED_CHAIN_KEY)).base.products[1].id,12);
});
test('invalid recipes fail before replacement, and equal imports do not invalidate the source',()=>{
  const s=memory();writeSharedChainSource(base,'原表.xlsx',s);const before=s.getItem(SHARED_CHAIN_KEY);writeSharedChainSource(base,'原表.xlsx',s);assert.equal(s.getItem(SHARED_CHAIN_KEY),before);
  const invalid=structuredClone(base);invalid.products[1].inputs=[{id:999,quantity:1}];assert.throws(()=>writeSharedChainSource(invalid,'坏表.xlsx',s));assert.equal(s.getItem(SHARED_CHAIN_KEY),before);
});
