import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {buildCatalog,levelInfo} from '../orders/order-engine.js';
import {normalizeCustomOrders,editCustomOrders,customOrdersAt,filterCustomLibrary,customOrderOverview} from '../orders/custom-orders.js';
import {projectExportSheets,exportProjectWorkbook} from '../orders/project-export.js';
import {createSessionSnapshot,restoreSessionSnapshot,validateSessionSnapshot} from '../orders/session-snapshot.js';
import {createProjectStore,PROJECT_STORAGE_KEY} from '../orders/project-storage.js';
const base={maxLevel:3,sources:[{id:0,name:'农田'},{id:1,name:'磨坊'},{id:2,name:'糖坊'}],products:[
 {id:1,name:'小麦',level:1,buildingId:0,isCrop:true,stepMinutes:2,analysisBatchYield:1,coinValue:2,inputs:[]},
 {id:2,name:'玉米<&',level:2,buildingId:0,isCrop:true,stepMinutes:5,analysisBatchYield:1,coinValue:3,inputs:[]},
 {id:3,name:'面粉',level:2,buildingId:1,stepMinutes:10,analysisBatchYield:1,coinValue:10,inputs:[{id:1,quantity:2}]},
 {id:4,name:'糖',level:2,buildingId:2,stepMinutes:20,analysisBatchYield:1,coinValue:20,inputs:[{id:2,quantity:1}]}
]};
const catalog=()=>buildCatalog(base,{cropQuantity:6,maxKinds:3});
const project=c=>({schemaVersion:'order-project-v3',origin:'excel-import',filename:'测试.xlsx',base,rules:c.rules,activeLevel:1,probabilityScale:10000,customOrders:normalizeCustomOrders(),configs:Object.fromEntries([1,2,3].map(level=>[level,{mean:20,variance:4,spreadPercent:10,mix:[20,40,40],weights:{0:3,1:1,2:1},sourceEnabled:false,revision:0}]))});
test('selection is per level, ordered, deduplicated and independent of the probability configuration',()=>{
 const c=catalog(),p=project(c),before=JSON.stringify(p.configs);
 let s=editCustomOrders(null,c,2,'add',['S1-1','S1-2','S1-1']);assert.deepEqual(s.levels[2],['S1-1','S1-2']);
 s=editCustomOrders(s,c,2,'up',['S1-2']);assert.deepEqual(s.levels[2],['S1-2','S1-1']);
 s=editCustomOrders(s,c,1,'add',['S1-1']);s=editCustomOrders(s,c,2,'remove',['S1-1']);assert.deepEqual(s.levels,{1:['S1-1'],2:['S1-2']});
 assert.equal(JSON.stringify(p.configs),before);assert.throws(()=>editCustomOrders(s,c,1,'add',['S1-2']),/候选库/);
 assert.deepEqual(editCustomOrders(s,c,2,'clear').levels,{1:['S1-1']});
});
test('library filters combine names, sources, kind counts, work, complexity and chosen state, then sort',()=>{
 const c=catalog(),by=new Map(c.products.map(p=>[p.id,p])),orders=levelInfo(c,2).orders;
 const filtered=filterCustomLibrary(orders,by,{search:'小麦',kinds:2,source:'0',minTime:1,maxTime:1000,minComplexity:1,maxComplexity:6,selected:'no',sort:'cumulativeMinutes',direction:'desc'},new Set(['S1-1']));
 assert(filtered.length);assert(filtered.every(o=>o.itemTypes===2&&o.description.includes('小麦')));
 assert(filtered.every((o,i)=>i===0||o.cumulativeMinutes<=filtered[i-1].cumulativeMinutes));
 assert.deepEqual(filterCustomLibrary(orders,by,{selected:'yes'},new Set(['S1-1'])).map(o=>o.id),['S1-1']);
 assert.deepEqual(filterCustomLibrary(orders,by,{minTime:100,maxTime:1}),[]);
});
test('unavailable selections are retained, visible in overview and block Excel export',()=>{
 const c=catalog(),p=project(c);p.customOrders={version:1,levels:{1:['S1-2'],2:['deleted-order']}};
 assert.equal(customOrdersAt(c,p.customOrders,1)[0].order,null);
 assert.deepEqual(customOrderOverview(c,p.customOrders).map(r=>r.invalid),[1,1,0]);
 assert.throws(()=>projectExportSheets(c,p,[{level:1,status:'not_fitted',fit:null},{level:2,status:'not_fitted',fit:null}]),/2 项定制/);
 const limited=buildCatalog({...base,maxLevel:20},{singleWindow:1});assert.equal(customOrdersAt(limited,{levels:{3:['S1-2']}},3)[0].order,null);
});
test('project storage and full backups preserve custom tasks and reject malformed definitions',()=>{
 const c=catalog(),p=project(c);p.customOrders=editCustomOrders(null,c,2,'add',['S1-2','S1-1']);
 const m=new Map(),storage={get length(){return m.size;},getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]};
 const store=createProjectStore(storage);store.save(p);assert.deepEqual(createProjectStore(storage).load().customOrders,p.customOrders);
 const snapshot=createSessionSnapshot(p,storage);restoreSessionSnapshot(storage,snapshot,{overwrite:true});assert.deepEqual(JSON.parse(storage.getItem(PROJECT_STORAGE_KEY)).customOrders,p.customOrders);
 const bad=structuredClone(snapshot);bad.project.customOrders.levels[1]=[null];assert.throws(()=>validateSessionSnapshot(bad),/定制订单/);
});
test('Excel sheets keep custom tasks separate and export no stale probability results',async()=>{
 const c=catalog(),p=project(c);p.customOrders=editCustomOrders(null,c,2,'add',['S1-2','S1-1']);
 const o=c.orders.find(o=>o.id==='S1-1');
 const levels=[{level:1,status:'matched',fit:{orders:[{...o,probability:1,relativeWeight:10000,weightScale:10000,generationAllowed:true}]}},{level:2,status:'not_fitted',fit:null},{level:3,status:'blocked',fit:null}];
 const sheets=projectExportSheets(c,p,levels);
 assert.deepEqual(sheets.map(s=>s.name),['概率订单','定制订单','等级配置']);assert.equal(sheets[0].rows.length,2);assert.equal(sheets[1].rows.length,3);assert.equal(sheets[2].rows.length,4);
 assert.deepEqual(sheets[1].rows.slice(1).map(r=>r.slice(0,3)),[[2,1,'S1-2'],[2,2,'S1-1']]);
 assert(!sheets[1].rows[0].includes('生成概率'));assert.equal(sheets[2].rows[2][1],'未拟合 / 结果待更新');
 const module={exports:{}};new Function('module','exports',fs.readFileSync(new URL('../orders/vendor/jszip.min.js',import.meta.url),'utf8'))(module,module.exports);const Zip=module.exports;
 const bytes=await exportProjectWorkbook(sheets,Zip),zip=await Zip.loadAsync(bytes);
 const workbook=await zip.file('xl/workbook.xml').async('string'),custom=await zip.file('xl/worksheets/sheet2.xml').async('string');
 assert(workbook.includes('定制订单'));assert(custom.includes('玉米&lt;&amp;'));assert(custom.includes('ySplit="1"'));assert(!custom.includes('<f>'));
 if(process.env.CUSTOM_EXPORT_QA)fs.writeFileSync(process.env.CUSTOM_EXPORT_QA,bytes);
});
