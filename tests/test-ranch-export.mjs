import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ranchExportSheets,downloadRanchWorkbook} from '../orders/ranch-export.js';
import {writeSharedChainSource} from '../orders/shared-chain-source.js';
import {loadRanchWorkspace} from '../orders/ranch-workspace.js';
import {ranchSettingsKey} from '../orders/ranch-import.js';
import {exportProjectWorkbook} from '../orders/project-export.js';
import {solveRanchGroup} from '../orders/ranch-engine.js';
const module={exports:{}};new Function('module','exports',fs.readFileSync(new URL('../orders/vendor/jszip.min.js',import.meta.url),'utf8'))(module,module.exports);const Zip=module.exports;
const base={maxLevel:3,landsByLevel:{1:6,2:6,3:6},sources:[{id:0,name:'田地',level:1},{id:10,name:'工坊',level:2}],products:[{id:1,name:'小麦',buildingId:0,buildingName:'田地',level:1,isCrop:true,stepMinutes:2,analysisBatchYield:1,inputs:[],coinValue:1},{id:2,name:'面粉',buildingId:10,buildingName:'工坊',level:2,isCrop:false,stepMinutes:5,analysisBatchYield:1,inputs:[{id:1,quantity:1}],coinValue:8}]};
const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};writeSharedChainSource(base,'合成数据.xlsx',storage);
async function workspace(){return loadRanchWorkspace({storage,loadCache:async()=>null,workerFactory:()=>{throw Error('export must not solve');}});}

function admit(ws,level){
  const plan=ws.plans.find(p=>p.level===level),group=plan.groups[0],result=solveRanchGroup(ws.model,group,level,plan.capacities);
  assert(result.proven);plan.results.set(group.key,result);ws.settings.quantityTargetsByLevel??={};ws.settings.quantityTargetsByLevel[level]={targetHours:String(result.optimalMinutes/60),targetTolerance:'0'};
  return {plan,group,result};
}
const cell=(sheet,row,label)=>sheet.rows[row][sheet.rows[0].indexOf(label)];
test('exports exactly a level summary and one actual-order sheet, retaining empty headers without calculating',async()=>{
  const ws=await workspace(),before=JSON.stringify(ws.plans.map(p=>p.groups)),sheets=ranchExportSheets(ws);
  assert.deepEqual(sheets.map(s=>s.name),['等级汇总','全部实际订单']);assert.equal(sheets[0].rows.length,7);assert.equal(sheets[1].rows.length,1);
  assert.deepEqual(sheets[1].rows[0],['等级','订单内容','A商品 ID','A商品','A数量','A燃料奖励','B商品 ID','B商品','B数量','B燃料奖励','C商品 ID','C商品','C数量','C燃料奖励','D商品 ID','D商品','D数量','D燃料奖励','四单燃料奖励合计','联合优化时间（分钟）','累计工时（分钟）','累计复杂度','田地工时（分钟）','工坊工时（分钟）']);
  assert.equal(JSON.stringify(ws.plans.map(p=>p.groups)),before);
});
test('one table includes all admitted levels and both categories once, with aligned products, fuel and resource work',async()=>{
  const ws=await workspace(),first=admit(ws,2),second=admit(ws,3);first.group.types.push('chain');second.group.types=['chain'];
  const before=JSON.stringify(ws.plans.map(p=>p.groups)),sheets=ranchExportSheets(ws),actual=sheets[1];
  assert.equal(actual.rows.length,3);assert.deepEqual(actual.rows.slice(1).map(row=>row[0]),[2,3]);
  assert.equal(cell(actual,1,'订单内容'),'面粉 × 1 + 面粉 × 1 + 面粉 × 1 + 面粉 × 1');
  for(const letter of 'ABCD'){assert.equal(cell(actual,1,letter+'商品 ID'),2);assert.equal(cell(actual,1,letter+'商品'),'面粉');assert.equal(cell(actual,1,letter+'数量'),1);assert.equal(cell(actual,1,letter+'燃料奖励'),0);}
  assert.equal(cell(actual,1,'四单燃料奖励合计'),0);assert.equal(cell(actual,1,'联合优化时间（分钟）'),first.result.optimalMinutes);
  assert.equal(cell(actual,1,'累计工时（分钟）'),28);assert.equal(cell(actual,1,'累计复杂度'),8);assert.equal(cell(actual,1,'田地工时（分钟）'),8);assert.equal(cell(actual,1,'工坊工时（分钟）'),20);
  assert.equal(JSON.stringify(ws.plans.map(p=>p.groups)),before);
});
test('bounded, failed, outside-target, unequal-quantity and missing-price presets never enter actual exports',async()=>{
  const ws=await workspace(),{plan,group,result}=admit(ws,2);assert.equal(ranchExportSheets(ws)[1].rows.length,2);
  plan.results.set(group.key,{proven:false,optimalMinutes:null,feasibleMinutes:25,lowerMinutes:20});assert.equal(ranchExportSheets(ws)[1].rows.length,1);
  plan.results.delete(group.key);plan.failures.set(group.key,'缺少产能');assert.equal(ranchExportSheets(ws)[1].rows.length,1);
  plan.failures.clear();plan.results.set(group.key,result);ws.settings.quantityTargetsByLevel[2].targetHours='6';assert.equal(ranchExportSheets(ws)[1].rows.length,1);assert.equal(plan.results.get(group.key),result);
  storage.setItem(ranchSettingsKey(base),JSON.stringify({quantityEdits:{2:{[group.id]:[2,3,4,5]}}}));
  try{const edited=await workspace(),p=edited.plans[1],g=p.groups[0];p.results.set(g.key,result);assert.equal(ranchExportSheets(edited)[1].rows.length,1);assert.deepEqual(g.slots.map(v=>v.quantity),[2,3,4,5]);}finally{storage.setItem(ranchSettingsKey(base),'{}');}
  const missing=await workspace();for(const model of new Set([missing.model,...missing.plans.map(p=>p.model)]))model.by.get(2).coinValue=null;
  admit(missing,2);assert.equal(ranchExportSheets(missing)[1].rows.length,1);
});
test('two-sheet Excel retains numeric fuel and work, frozen/filterable headers and saved edits',async()=>{
  const ws=await workspace();admit(ws,2);const sheets=ranchExportSheets(ws),bytes=await exportProjectWorkbook(sheets,Zip),zip=await Zip.loadAsync(bytes);
  const xml=await zip.file('xl/worksheets/sheet2.xml').async('string'),workbook=await zip.file('xl/workbook.xml').async('string');
  assert.equal((workbook.match(/<sheet /g)||[]).length,2);assert.match(workbook,/全部实际订单/);assert.equal(zip.file('xl/worksheets/sheet3.xml'),null);
  assert.match(xml,/<pane ySplit="1"/);assert.match(xml,/<autoFilter/);assert.match(xml,/<c r="F2" s="4"><v>0<\/v>/);assert.match(xml,/<c r="S2" s="4"><v>0<\/v>/);assert.match(xml,/<c r="U2" s="4"><v>28<\/v>/);assert(!xml.includes('未计算'));assert(!xml.includes('金币总值'));
  if(process.env.RANCH_EXPORT_QA)fs.writeFileSync(process.env.RANCH_EXPORT_QA,bytes);
  const previous=globalThis.JSZip;globalThis.JSZip=Zip;
  try{let flushed=false,downloaded=false;await downloadRanchWorkbook({beforeExport:()=>{flushed=true;},load:async()=>{assert(flushed);return ws;},download:(data,name)=>{downloaded=true;assert(data.length>1000);assert.match(name,/全部等级/);}});assert(downloaded);}
  finally{if(previous===undefined)delete globalThis.JSZip;else globalThis.JSZip=previous;}
});
