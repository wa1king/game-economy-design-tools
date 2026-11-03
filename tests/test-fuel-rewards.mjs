import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fuelRules,readFuelRules,writeFuelRules,fuelReward,ordinaryFuelReward,ranchFuelReward,summarizeFuel} from '../orders/fuel-rewards.js';
import {buildCatalog} from '../orders/order-engine.js';
import {summarizeOrderOutcomes} from '../orders/order-outcomes.js';
import {summarizeCoins,renderCoinAnalysis,renderCoinBreakdown} from '../orders/coin-analysis.js';
import {projectExportSheets,worksheetXML,exportProjectWorkbook} from '../orders/project-export.js';
import {ranchExportSheets} from '../orders/ranch-export.js';
import {ranchDashboardRows,ranchDashboardSummary} from '../orders/ranch-distribution.js';
import {writeSharedChainSource} from '../orders/shared-chain-source.js';
import {loadRanchWorkspace} from '../orders/ranch-workspace.js';
import {ranchSettingsKey} from '../orders/ranch-import.js';
import {createSessionSnapshot,restoreSessionSnapshot} from '../orders/session-snapshot.js';
import {setupFuelRules} from '../orders/fuel-rules-view.js';
import {toCSV,toJSON} from '../orders/export.js';
const memory=()=>{const m=new Map();return {get length(){return m.size;},getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]};};
const priced=new Map([[1,{id:1,name:'甲',coinValue:19}],[2,{id:2,name:'乙',coinValue:21}]]);
const items=id=>[{id,quantity:1}];
const base={maxLevel:2,landsByLevel:{1:6,2:6},sources:[{id:0,name:'农田',level:1},{id:10,name:'工坊',level:2}],products:[{id:1,name:'麦',buildingId:0,buildingName:'农田',level:1,isCrop:true,stepMinutes:2,analysisBatchYield:1,inputs:[],coinValue:1},{id:2,name:'粉',buildingId:10,buildingName:'工坊',level:2,isCrop:false,stepMinutes:5,analysisBatchYield:1,inputs:[{id:1,quantity:1}],coinValue:19}]};
test('rules default only when absent, preserve user input, and reject invalid exchange rates',()=>{
  const storage=memory();assert.deepEqual(readFuelRules(storage),{coinsPerFuel:10});
  writeFuelRules({coinsPerFuel:'7.5'},storage);assert.equal(readFuelRules(storage).coinsPerFuel,7.5);
  writeSharedChainSource(base,'source.xlsx',storage);assert.equal(readFuelRules(storage).coinsPerFuel,7.5);
  for(const value of [0,-1,Infinity,NaN,'',null])assert.throws(()=>fuelRules({coinsPerFuel:value}));
  assert.equal(readFuelRules(storage).coinsPerFuel,7.5);
});
test('each award floors independently, including zero, missing prices and exact decimal boundaries',()=>{
  assert.equal(fuelReward(19),1);assert.equal(fuelReward(20),2);assert.equal(fuelReward(9.999999999999998),0);
  assert.equal(fuelReward(0),0);assert.equal(fuelReward(null),null);assert.equal(fuelReward(-1),null);
  assert.equal(fuelReward(.6,{coinsPerFuel:.2}),3);assert.equal(fuelReward(1e-7,{coinsPerFuel:1e-8}),10);
  assert.equal(ordinaryFuelReward({items:items(1)},priced),9); // 19*5 = 95
  const group={slots:Array.from({length:4},()=>({id:1,quantity:1}))};
  assert.deepEqual(ranchFuelReward(group,priced),{values:[1,1,1,1],total:4});
  assert.notEqual(ranchFuelReward(group,priced).total,fuelReward(76));
  assert.equal(ranchFuelReward({slots:[...group.slots.slice(0,3),{id:99,quantity:1}]},priced).total,null);
});
test('means weight individually rounded fuel, not the rounded mean coins; missing prices suppress totals',()=>{
  const rows=[{items:items(1),weight:1},{items:items(2),weight:3}];
  assert.equal(summarizeFuel(rows,priced).mean,1.75);
  assert.equal(fuelReward(summarizeCoins(rows,priced).mean),2);
  assert.equal(summarizeFuel([...rows,{items:items(99),weight:0}],priced).mean,1.75);
  assert.equal(summarizeFuel([...rows,{items:items(99),weight:1}],priced).mean,null);
  const ranch=summarizeCoins([{items:Array.from({length:4},()=>({id:1,quantity:1})),weight:1}],priced,{equalWeight:true});
  assert.equal(ranch.fuel.mean,4);assert.match(renderCoinAnalysis(ranch,{ranch:true}),/平均 <strong>4<\/strong>燃料/);
  assert.match(renderCoinBreakdown(items(1),priced,{multiplier:5}),/9<\/b> 燃料/);
});

test('ordinary outcome cache refreshes by conversion rule with identical input and fit objects',()=>{
  const storage=memory(),previous=globalThis.localStorage;globalThis.localStorage=storage;
  try{
    const catalog=buildCatalog(base),result={config:{level:2},probabilities:catalog.orders.map((_,i)=>i===0?1:0)};
    const before=JSON.stringify(result),a=summarizeOrderOutcomes(catalog,result,2);
    writeFuelRules({coinsPerFuel:1},storage);const b=summarizeOrderOutcomes(catalog,result,2);
    assert.notEqual(a,b);assert.equal(a.stats.coinReward.mean,b.stats.coinReward.mean);
    assert.equal(a.stats.fuelReward.mean,Math.floor(b.stats.fuelReward.mean/10));assert.equal(JSON.stringify(result),before);
    assert.equal(summarizeOrderOutcomes(catalog,result,2),b);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});
test('single-level CSV and JSON include fuel counts alongside the conversion rule',()=>{
  const catalog=buildCatalog(base),result={config:{level:2,mix:[20,40,40]},probabilities:catalog.orders.map(()=>1/catalog.orders.length)};
  const json=JSON.parse(toJSON(catalog,result)),csv=toCSV(catalog,result),products=new Map(catalog.products.map(p=>[p.id,p]));
  assert.equal(json.fuelRules.coinsPerFuel,10);assert(csv.includes('燃料奖励'));assert(csv.includes('兑换1燃料所需金币'));
  for(const order of json.orders)assert.equal(order.fuelReward,ordinaryFuelReward(order,products));
});
test('ordinary workbook appends fuel in both order sheets and summary, retaining numeric cells',async()=>{
  const catalog=buildCatalog(base),order=catalog.orders.find(o=>o.items.length===1&&o.items[0].id===2),products=new Map(catalog.products.map(p=>[p.id,p]));
  const result={config:{level:2},probabilities:catalog.orders.map(o=>o.id===order.id?1:0)};
  const outcome=summarizeOrderOutcomes(catalog,result,2),project={configs:{2:{mean:1,spreadPercent:1}},customOrders:{version:1,levels:{2:[order.id]}},probabilityScale:100};
  const sheets=projectExportSheets(catalog,project,[{level:2,status:'matched',fit:{orders:[{...order,probability:1,relativeWeight:100,weightScale:100,generationAllowed:true}]},dashboard:{outcome}}]);
  for(const sheet of sheets.filter(s=>['概率订单','定制订单'].includes(s.name))){
    const index=sheet.rows[0].indexOf('燃料奖励');assert(index>0);assert.equal(sheet.rows[1][index],ordinaryFuelReward(order,products));assert.equal(sheet.rows[1][index+1],10);
    assert.match(worksheetXML(sheet),/<v>9<\/v>/);
  }
  const summary=sheets.find(s=>s.name==='总面板统计');assert.equal(summary.rows[1][summary.rows[0].indexOf('平均燃料奖励')],9);
  const module={exports:{}};new Function('module','exports',fs.readFileSync(new URL('../orders/vendor/jszip.min.js',import.meta.url),'utf8'))(module,module.exports);
  const bytes=await exportProjectWorkbook(sheets,module.exports),zip=await module.exports.loadAsync(bytes);assert.match(await zip.file('xl/worksheets/sheet1.xml').async('string'),/燃料奖励/);
});
test('ranch details and statistics use per-slot flooring and only actual admitted groups',async()=>{
  const storage=memory();writeSharedChainSource(base,'synthetic.xlsx',storage);storage.setItem(ranchSettingsKey(base),JSON.stringify({objective:'coins',quantityTargetsByLevel:{2:{targetCoins:'76',coinTolerance:'0'}}}));
  const ws=await loadRanchWorkspace({storage,loadCache:async()=>null,workerFactory:()=>{throw Error('fuel must never solve');}}),plan=ws.plans.find(p=>p.level===2),group=plan.groups[0];
  plan.results.set(group.key,{proven:true,optimalMinutes:20,feasibleMinutes:20,lowerMinutes:20});
  const targets={2:{objective:'coins',targetCoins:76,coinTolerance:0}},row=ranchDashboardRows(ws.plans,targets).find(r=>r.level===2&&r.type==='building');
  assert.equal(row.accepted,1);assert.equal(row.fuel.mean,4);assert.equal(ranchDashboardSummary(ws.plans,targets).fuel.mean,4);
  const before=JSON.stringify(group),sheets=ranchExportSheets(ws),actual=sheets.find(s=>s.name==='实际同建筑订单');
  assert.equal(actual.rows.length,2);
  for(const letter of 'ABCD')assert.equal(actual.rows[1][actual.rows[0].indexOf(letter+'燃料奖励')],1);
  assert.equal(actual.rows[1][actual.rows[0].indexOf('四单燃料奖励合计')],4);
  const summary=sheets[0];assert.equal(summary.rows.find(r=>r[0]===2&&r[1]==='同建筑')[summary.rows[0].indexOf('实际订单平均燃料奖励')],4);
  assert.equal(ranchDashboardSummary(ws.plans,targets,'all',{coinsPerFuel:5}).fuel.mean,12);assert.equal(JSON.stringify(group),before);
});
test('fuel rule dialog saves one global rule and emits only a presentation refresh',()=>{
  const storage=memory(),previousStorage=globalThis.localStorage,previousDocument=globalThis.document,previousWindow=globalThis.window;
  const elements=new Map(),events=[],element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
  globalThis.localStorage=storage;
  globalThis.document={getElementById:id=>elements.get(id),createElement:()=>({}),head:{append(){}},body:{insertAdjacentHTML:()=>{for(const id of ['fuelRulesDialog','fuelCoinsPerUnit','fuelRulesError','openFuelRules','fuelRuleExample','closeFuelRules','fuelRulesForm'])element(id);}},querySelector:()=>({insertAdjacentHTML(){}})};
  globalThis.window={dispatchEvent:e=>events.push(e.type),addEventListener(){}};
  try{setupFuelRules();element('openFuelRules').onclick();assert.equal(element('fuelCoinsPerUnit').value,10);element('fuelCoinsPerUnit').value='8';element('fuelRulesForm').onsubmit({preventDefault(){}});assert.equal(readFuelRules(storage).coinsPerFuel,8);assert.deepEqual(events,['orders:fuel-changed']);assert.equal(element('fuelRulesDialog').open,false);}
  finally{for(const [key,value] of [['localStorage',previousStorage],['document',previousDocument],['window',previousWindow]])if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
test('backups retain the global rule and old snapshots never reset existing user input',()=>{
  const storage=memory();writeFuelRules({coinsPerFuel:7.5},storage);
  const config={mix:[20,40,40],mean:10,variance:1,weights:{0:1,10:1}},project={origin:'excel-import',base,activeLevel:1,configs:{1:structuredClone(config),2:structuredClone(config)}};
  const snapshot=createSessionSnapshot(project,storage);assert.equal(snapshot.fuelRules.coinsPerFuel,7.5);
  const destination=memory();restoreSessionSnapshot(destination,snapshot);assert.equal(readFuelRules(destination).coinsPerFuel,7.5);
  writeFuelRules({coinsPerFuel:3},destination);const old={...snapshot};delete old.fuelRules;
  restoreSessionSnapshot(destination,old,{overwrite:true});assert.equal(readFuelRules(destination).coinsPerFuel,3);
});
