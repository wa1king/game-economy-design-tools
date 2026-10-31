import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ranchExportSheets,downloadRanchWorkbook} from '../orders/ranch-export.js';
import {writeSharedChainSource} from '../orders/shared-chain-source.js';
import {loadRanchWorkspace} from '../orders/ranch-workspace.js';
import {ranchSettingsKey} from '../orders/ranch-import.js';
import {exportProjectWorkbook} from '../orders/project-export.js';
const module={exports:{}};new Function('module','exports',fs.readFileSync(new URL('../orders/vendor/jszip.min.js',import.meta.url),'utf8'))(module,module.exports);const Zip=module.exports;
const base={maxLevel:3,landsByLevel:{1:6,2:6,3:6},sources:[{id:0,name:'田地',level:1},{id:10,name:'工坊',level:2}],products:[{id:1,name:'小麦',buildingId:0,buildingName:'田地',level:1,isCrop:true,stepMinutes:2,analysisBatchYield:1,inputs:[],coinValue:1},{id:2,name:'面粉',buildingId:10,buildingName:'工坊',level:2,isCrop:false,stepMinutes:5,analysisBatchYield:1,inputs:[{id:1,quantity:1}],coinValue:8}]};
const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};writeSharedChainSource(base,'合成数据.xlsx',storage);
async function workspace(){return loadRanchWorkspace({storage,loadCache:async()=>null,workerFactory:()=>{throw Error('export must not solve');}});}
test('exports all grade combinations in separate type sheets, including quantities and pending rows',async()=>{
  const ws=await workspace(),before=JSON.stringify(ws.plans.map(p=>p.groups)),sheets=ranchExportSheets(ws);
  assert.deepEqual(sheets.map(s=>s.name),['等级汇总','同建筑订单','高级加工链订单']);
  for(const [i,type] of ['building','chain'].entries())assert.equal(sheets[i+1].rows.length-1,ws.plans.reduce((n,p)=>n+p.groups.filter(g=>g.types.includes(type)).length,0));
  assert(sheets[1].rows.slice(1).every(r=>r[18]==='未计算'&&r[15]===null));assert.equal(sheets[0].rows.length,7);
  const row=sheets[1].rows[1];assert.equal(row[2],'面粉 × 1 + 面粉 × 1 + 面粉 × 1 + 面粉 × 1');assert.equal(row[19],28);assert.equal(row[21],32);assert.equal(JSON.stringify(ws.plans.map(p=>p.groups)),before);
});
test('exports proven times, bounded results, errors, missing prices and edited quantities without fabricated optima',async()=>{
  const ws=await workspace(),plan=ws.plans[1],g=plan.groups[0];plan.results.set(g.key,{proven:false,optimalMinutes:null,feasibleMinutes:25,lowerMinutes:20});
  let row=ranchExportSheets(ws)[1].rows[1];assert.equal(row[15],null);assert.equal(row[16],25);assert.equal(row[17],20);assert.equal(row[18],'待证明最优');
  plan.results.set(g.key,{proven:true,optimalMinutes:20,feasibleMinutes:20,lowerMinutes:20});assert.equal(ranchExportSheets(ws)[1].rows[1][15],20);
  plan.results.clear();plan.failures.set(g.key,'缺少产能');assert.match(ranchExportSheets(ws)[1].rows[1][18],/缺少产能/);
  storage.setItem(ranchSettingsKey(base),JSON.stringify({quantityEdits:{2:{[g.id]:[2,3,4,5]}}}));const edited=await workspace(),editedPlan=edited.plans[1],editedGroup=editedPlan.groups[0];
  // An old proven cache cannot validate quantities that violate the new rule.
  editedPlan.results.set(editedGroup.key,{proven:true,optimalMinutes:70,feasibleMinutes:70,lowerMinutes:70});
  row=ranchExportSheets(edited)[1].rows[1];assert.deepEqual([row[5],row[8],row[11],row[14]],[2,3,4,5]);assert.equal(row[19],98);
  assert.deepEqual(row.slice(15,18),[null,null,null]);assert.equal(row[18],'相同商品数量不一致，待重新配量');assert.deepEqual(editedGroup.slots.map(v=>v.quantity),[2,3,4,5]);
  const summary=ranchExportSheets(edited)[0].rows.find(r=>r[0]===2&&r[1]==='同建筑');assert.equal(summary[3],0);assert.equal(summary[5],1);assert.equal(summary[7],null);
  storage.setItem(ranchSettingsKey(base),'{}');
});
test('Excel contains complete numeric rows, frozen/filterable headers, and explicit integer display for work and coins',async()=>{
  const ws=await workspace(),sheets=ranchExportSheets(ws),bytes=await exportProjectWorkbook(sheets,Zip),zip=await Zip.loadAsync(bytes);
  const xml=await zip.file('xl/worksheets/sheet2.xml').async('string');assert.match(xml,/<pane ySplit="1"/);assert.match(xml,/<autoFilter/);assert.match(xml,/<c r="T2" s="4"><v>28<\/v>/);assert.match(xml,/<c r="V2" s="4"><v>32<\/v>/);assert.match(xml,/未计算/);
  globalThis.JSZip=Zip;let flushed=false,downloaded=false;await downloadRanchWorkbook({beforeExport:()=>{flushed=true;},load:async()=>{assert(flushed);return ws;},download:(bytes,name)=>{downloaded=true;assert(bytes.length>1000);assert.match(name,/全部等级/);}});assert(downloaded);
});
