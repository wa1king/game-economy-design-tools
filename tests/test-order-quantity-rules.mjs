import {saveRanchTargets,readRanchTarget} from '../orders/ranch-workspace.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_CROP_QUANTITY,readRanchSettings,saveRanchQuantityRules,fillMissingOrdinaryCropQuantity,RANCH_QUANTITY_RULES_KEY} from '../orders/order-quantity-rules.js';
import {DEFAULT_RULES} from '../orders/order-engine.js';
import {prepareRanch} from '../orders/ranch-engine.js';
import {generateRanchLevelGroups} from '../orders/ranch-catalog.js';
import {buildRanchDistributionPlans} from '../orders/ranch-distribution.js';
const memory=()=>{const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
test('saved quantities always outrank defaults, and loading settings is read-only',()=>{
  for(const quantity of [4,6,7,9]){
    const storage=memory(),saved={cropQuantity:quantity,productQuantity:3,quantityTargetsByLevel:{20:{targetHours:'8'}},quantityEdits:{20:{g:[7,2,3,4]}}};storage.setItem('project',JSON.stringify(saved));
    const before=[...storage.data];for(let i=0;i<3;i++){const loaded=readRanchSettings(storage,'project');assert.equal(loaded.cropQuantity,quantity);assert.deepEqual(loaded.quantityTargetsByLevel,saved.quantityTargetsByLevel);assert.deepEqual(loaded.quantityEdits,saved.quantityEdits);}assert.deepEqual([...storage.data],before);
  }
  const empty=memory();assert.equal(readRanchSettings(empty,'newProject').cropQuantity,6);assert.equal(empty.data.size,0,'reading a default must never persist it as a user preference');
});
test('an untagged preference created by older code cannot mask a saved project input',()=>{
  const storage=memory();storage.setItem(RANCH_QUANTITY_RULES_KEY,JSON.stringify({cropQuantity:6,productQuantity:1}));storage.setItem('project',JSON.stringify({cropQuantity:7,productQuantity:4}));
  assert.equal(readRanchSettings(storage,'project').cropQuantity,7);assert.equal(readRanchSettings(storage,'project').productQuantity,4);
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
test('ordinary saved rules retain all inputs without any seven-to-six migration',()=>{
  for(const cropQuantity of [4,6,7,9,0,'']){const project={rules:{cropQuantity,productQuantity:3},configs:{1:{mean:0}}};assert.equal(fillMissingOrdinaryCropQuantity(project),project);assert.equal(project.rules.cropQuantity,cropQuantity);}
  assert.equal(fillMissingOrdinaryCropQuantity({rules:{productQuantity:2}}).rules.cropQuantity,6);
});
test('invalid saved quantities remain visible for validation instead of becoming defaults',()=>{
  const storage=memory();storage.setItem('project',JSON.stringify({cropQuantity:0,productQuantity:''}));assert.equal(readRanchSettings(storage,'project').cropQuantity,0);assert.equal(readRanchSettings(storage,'project').productQuantity,'');
});

test('ordinary, ranch catalogue and all-level generation share a six-crop default',()=>{
  assert.equal(DEFAULT_CROP_QUANTITY,6);assert.equal(DEFAULT_RULES.cropQuantity,6);
  const base={maxLevel:1,landsByLevel:{1:12},sources:[{id:0,name:'农田',level:1},{id:1,name:'工坊',level:1}],products:Array.from({length:4},(_,i)=>({id:i+1,name:'商品'+i,buildingId:i===3?1:0,buildingName:i===3?'工坊':'农田',level:1,stepMinutes:2,isCrop:i!==3,analysisBatchYield:1,inputs:i===3?[{id:1,quantity:1},{id:2,quantity:1},{id:3,quantity:1}]:[]}))};
  base.sources.push({id:2,name:'高级工坊',level:1});base.products.push({id:5,name:'最终品',buildingId:2,buildingName:'高级工坊',level:1,stepMinutes:5,isCrop:false,analysisBatchYield:1,inputs:[{id:4,quantity:1},{id:3,quantity:1}]});
  const model=prepareRanch(base),groups=generateRanchLevelGroups(model,1).groups,plans=buildRanchDistributionPlans(base);let crops=0;
  for(const g of [...groups,...plans[0].groups])for(const slot of g.slots)if(model.by.get(slot.id).isCrop){assert.equal(slot.quantity,6);crops++;}assert(crops>0);
});

test('editing a level target must preserve the saved quantity instead of substituting a default',()=>{
  const storage=memory();storage.setItem('project',JSON.stringify({cropQuantity:7}));const settings=readRanchSettings(storage,'project'),ws={base:{maxLevel:1},settings,storageKey:'project',services:{storage}};
  saveRanchTargets(ws,[{level:1,key:'targetHours',value:'5'}]);assert.equal(ws.settings.cropQuantity,7);assert.equal(JSON.parse(storage.getItem('project')).cropQuantity,7);
});

test('zero tolerance and an explicit automatic work target survive reading unchanged',()=>{
  const value=readRanchTarget({quantityTargetsByLevel:{3:{targetHours:'5',targetTolerance:'0',targetWork:'',fitCropMax:'18',fitProductMax:'9',quantityBudget:'6000'}}},3);
  assert.equal(value.targetTolerance,'0');assert.equal(value.targetWork,'');assert.equal(value.targetHours,'5');assert.equal(value.fitCropMax,'18');
});

test('the latest explicitly applied shared input overrides stale per-recipe values and survives reads',()=>{
  const storage=memory();storage.setItem('oldRecipe',JSON.stringify({cropQuantity:7,productQuantity:1}));saveRanchQuantityRules({cropQuantity:6,productQuantity:1},storage);
  const before=[...storage.data];assert.equal(readRanchSettings(storage,'oldRecipe').cropQuantity,6);assert.equal(readRanchSettings(storage,'newRecipe').cropQuantity,6);assert.deepEqual([...storage.data],before);
});
