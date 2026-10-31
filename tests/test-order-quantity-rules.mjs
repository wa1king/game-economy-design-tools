import {saveRanchTargets} from '../orders/ranch-workspace.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_CROP_QUANTITY,readRanchSettings,saveRanchQuantityRules,migrateOrdinaryCropQuantity,RANCH_QUANTITY_RULES_KEY} from '../orders/order-quantity-rules.js';
import {DEFAULT_RULES} from '../orders/order-engine.js';
import {prepareRanch} from '../orders/ranch-engine.js';
import {generateRanchLevelGroups} from '../orders/ranch-catalog.js';
import {buildRanchDistributionPlans} from '../orders/ranch-distribution.js';
const memory=()=>{const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
test('legacy built-in seven becomes six once and keeps all level targets and manual quantities',()=>{
  const s=memory(),old={cropQuantity:7,productQuantity:1,quantityTargetsByLevel:{20:{targetHours:'8'}},quantityEdits:{20:{g:[7,2,3,4]}}};s.setItem('sourceA',JSON.stringify(old));
  const value=readRanchSettings(s,'sourceA');assert.equal(value.cropQuantity,6);assert.deepEqual(value.quantityTargetsByLevel,old.quantityTargetsByLevel);assert.deepEqual(value.quantityEdits,old.quantityEdits);assert.equal(JSON.parse(s.getItem('ranch-quantity-rules-before-v2')).settings.cropQuantity,7);
  assert.equal(readRanchSettings(s,'sourceA').cropQuantity,6);assert.equal(readRanchSettings(s,'newRecipeHash').cropQuantity,6);assert.equal(JSON.parse(s.getItem('sourceA')).cropQuantity,7,'raw historical settings remain available');
});
test('explicit later rule edits survive reload and different import fingerprints without being forced back to six',()=>{
  const s=memory();readRanchSettings(s,'sourceA');saveRanchQuantityRules({cropQuantity:9,productQuantity:2},s);
  assert.equal(readRanchSettings(s,'sourceA').cropQuantity,9);assert.equal(readRanchSettings(s,'sourceB').productQuantity,2);
  saveRanchQuantityRules({cropQuantity:7,productQuantity:1},s);assert.equal(readRanchSettings(s,'sourceC').cropQuantity,7);assert.equal(JSON.parse(s.getItem(RANCH_QUANTITY_RULES_KEY)).cropQuantity,7);
});
test('non-default historical quantities are respected and invalid edits do not replace saved rules',()=>{
  const s=memory();s.setItem('existing',JSON.stringify({cropQuantity:4,productQuantity:3}));assert.equal(readRanchSettings(s,'existing').cropQuantity,4);
  assert.throws(()=>saveRanchQuantityRules({cropQuantity:0,productQuantity:1},s));assert.equal(readRanchSettings(s,'existing').cropQuantity,4);
});
test('ordinary legacy rules migrate once while deliberate new seven and other quantities remain valid',()=>{
  const old={rules:{cropQuantity:7,productQuantity:1},configs:{20:{mean:300}}},next=migrateOrdinaryCropQuantity(old);assert.equal(next.rules.cropQuantity,6);assert.equal(old.rules.cropQuantity,7);assert.equal(next.configs,old.configs);assert.equal(migrateOrdinaryCropQuantity({...next,rules:{...next.rules,cropQuantity:7}}).rules.cropQuantity,7);assert.equal(migrateOrdinaryCropQuantity({rules:{cropQuantity:5}}).rules.cropQuantity,5);
});
test('ordinary, ranch catalogue and all-level generation share a six-crop default',()=>{
  assert.equal(DEFAULT_CROP_QUANTITY,6);assert.equal(DEFAULT_RULES.cropQuantity,6);
  const base={maxLevel:1,landsByLevel:{1:12},sources:[{id:0,name:'农田',level:1},{id:1,name:'工坊',level:1}],products:Array.from({length:4},(_,i)=>({id:i+1,name:'商品'+i,buildingId:i===3?1:0,buildingName:i===3?'工坊':'农田',level:1,stepMinutes:2,isCrop:i!==3,analysisBatchYield:1,inputs:i===3?[{id:1,quantity:1},{id:2,quantity:1},{id:3,quantity:1}]:[]}))};
  base.sources.push({id:2,name:'高级工坊',level:1});base.products.push({id:5,name:'最终品',buildingId:2,buildingName:'高级工坊',level:1,stepMinutes:5,isCrop:false,analysisBatchYield:1,inputs:[{id:4,quantity:1},{id:3,quantity:1}]});
  const model=prepareRanch(base),groups=generateRanchLevelGroups(model,1).groups,plans=buildRanchDistributionPlans(base);let crops=0;
  for(const g of [...groups,...plans[0].groups])for(const slot of g.slots)if(model.by.get(slot.id).isCrop){assert.equal(slot.quantity,6);crops++;}assert(crops>0);
});

test('editing a level target cannot restore an old recipe-scoped crop count',()=>{
  const storage=memory();storage.setItem('project',JSON.stringify({cropQuantity:7}));const settings=readRanchSettings(storage,'project'),ws={base:{maxLevel:1},settings,storageKey:'project',services:{storage}};
  saveRanchTargets(ws,[{level:1,key:'targetHours',value:'5'}]);assert.equal(ws.settings.cropQuantity,6);assert.equal(JSON.parse(storage.getItem('project')).cropQuantity,6);
});
