import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ranchDashboardRows,ranchDashboardSummary,ranchDashboardTarget,renderRanchBoxPlot,renderRanchMetricTrend,renderRanchHistogram,renderRanchDistributionEmpty,ranchDistributionCSV,ranchLevelLink,formatMinutes} from '../orders/ranch-distribution.js';

let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const group=(key,types)=>({key,id:key,types,slots:[{id:1,quantity:1}]}),plan=(level,groups)=>({level,groups,results:new Map(),failures:new Map(),work:new Map(groups.map((g,i)=>[g.key,100+i*10])),metrics:new Map(groups.map((g,i)=>[g.key,{totalMinutes:100+i*10,complexity:4+i,coinValue:20+i*5}])),capacityError:null});
const p1=plan(1,[group('a',['building']),group('b',['chain']),group('both',['building','chain']),group('pending',['building']),group('failed',['chain'])]),p2=plan(2,[group('c',['building']),group('d',['chain'])]);
p1.results.set('a',{proven:true,optimalMinutes:120});p1.results.set('b',{proven:false,optimalMinutes:null,lowerMinutes:80,feasibleMinutes:140});p1.results.set('both',{proven:true,optimalMinutes:150});p1.failures.set('failed','test');p1.metrics.get('pending').coinValue=null;
p2.results.set('c',{proven:true,optimalMinutes:240});p2.results.set('d',{proven:true,optimalMinutes:270});
const plans=[p1,p2],targets={1:{targetHours:'2',targetTolerance:'15',targetWork:''},2:{targetHours:'4',targetTolerance:'30',targetWork:'500'}};
const rows=ranchDashboardRows(plans,targets);
test('per-level targets are shared across types, preserve a blank work target and use inclusive time ranges',()=>{
  assert.deepEqual(rows[0].target,rows[1].target);assert.equal(rows[0].target.minutes,120);assert.equal(rows[0].target.work,null);assert.equal(rows[2].target.minutes,240);assert.equal(rows[2].target.work,500);
  assert.equal(rows[0].within,1);assert.equal(rows[0].withinShare,.5);assert.equal(rows[3].withinShare,1);assert.equal(ranchDashboardTarget({targetHours:'bad',targetTolerance:'1'}).minutes,null);
});
test('overlapping types do not inflate overall counts or target denominator, missing coins are not zero',()=>{
  const summary=ranchDashboardSummary(plans,targets);assert.equal(summary.total,7);assert.equal(rows.reduce((n,r)=>n+r.total,0),8);assert.equal(summary.proven,4);assert.equal(summary.bounded,1);assert.equal(summary.failed,1);assert.equal(summary.pending,1);assert.equal(summary.within,3);assert.equal(summary.withinShare,.75);assert.equal(summary.missingCoins,1);
  assert.equal(rows[0].coins.n,2);assert.equal(rows[0].coins.mean,25);assert.equal(rows[0].missingCoins,1);assert.equal(ranchDashboardSummary(plans,targets,'chain').total,4);
});
test('box plots show configured targets instead of a hardcoded six-hour line and link each type to single-level analysis',()=>{
  const opt=renderRanchBoxPlot(rows,'optimized'),work=renderRanchBoxPlot(rows,'work');assert(opt.includes('Lv 1 目标 120 ± 15'));assert(opt.includes('Lv 2 目标 240 ± 30'));assert(!opt.includes('6 小时'));assert.equal((opt.match(/class="ranch-target-band"/g)||[]).length,2);assert.equal((work.match(/class="ranch-work-target"/g)||[]).length,1);assert(work.includes('累计工时目标 500'));
  for(const type of ['building','chain'])assert(opt.includes(`ranch.html?level=2&amp;type=${type}`));assert(!/NaN|Infinity/.test(opt+work));
});
test('an uncalculated or bounded-only overview has an actionable empty state instead of blank axes',()=>{
  const pendingPlan=plan(1,[group('a',['building']),group('b',['chain'])]);pendingPlan.results.set('b',{proven:false,lowerMinutes:2,feasibleMinutes:8});
  const empty=renderRanchBoxPlot(ranchDashboardRows([pendingPlan],targets),'optimized');assert(!empty.includes('<svg'));assert(empty.includes('待计算 1'));assert(empty.includes('待证明最优 1'));assert(empty.includes('data-calculate-ranch'));
  const none=renderRanchBoxPlot(ranchDashboardRows([plan(1,[])],targets),'optimized');assert(none.includes('暂无符合规则'));assert(!none.includes('data-calculate-ranch'));assert(!none.includes('<svg'));
  const overlap=renderRanchBoxPlot(ranchDashboardRows([plan(1,[group('shared',['building','chain'])])],targets),'optimized');assert(overlap.includes('待计算 1'));assert(!overlap.includes('待计算 2'));
});
test('auxiliary trends include visible point values and omit missing prices without connecting through missing samples',()=>{
  for(const metric of ['coins','complexity']){const trend=renderRanchMetricTrend(rows,metric);assert(trend.includes('distribution-point-label'));assert(trend.includes('#28795f'));assert(trend.includes('#a8773b'));assert(trend.includes('ranch.html?level=2&amp;type=chain'));assert(!/NaN|Infinity/.test(trend));}
  const csv=ranchDistributionCSV(rows);assert(csv.includes('优化目标(分)'));assert(csv.includes('平均累计复杂度'));assert(csv.includes('缺少单价组数'));assert(!csv.includes('"null"'));
});

// DOM/event simulation only: no browser, real project data, or real storage.
const html=fs.readFileSync(new URL('../orders/ranch-distribution.html',import.meta.url),'utf8'),app=fs.readFileSync(new URL('../orders/ranch-distribution-app.js',import.meta.url),'utf8'),elements=new Map();
class Element{constructor(){this.value='';this.hidden=false;this.disabled=false;this.innerHTML='';this.textContent='';this.dataset={};this.events={};this.classList={toggle(){}};}setAttribute(){}addEventListener(type,fn){this.events[type]=fn;}click(){}}
for(const match of html.matchAll(/\bid="([^"]+)"/g)){assert(!elements.has(match[1]));elements.set(match[1],new Element());}
for(const match of app.matchAll(/\$\('([^']+)'\)/g))assert(elements.has(match[1]),'missing element '+match[1]);
assert(html.includes('data-ranch-view="dashboard"'));assert(html.includes('ranch-config.html'));assert(!app.includes('new Worker'));assert(!app.includes('saveRanchCache'));
let loadCount=0,watchCallback,watchDisposed=false,activeCall=null,lastCSV='',loadValue={filename:'mock.xlsx',base:{maxLevel:2,products:[{}]},settings:{level:2},plans:structuredClone(plans)},failNext=false;
const typeButtons=['all','building','chain'].map(type=>{const e=new Element();e.dataset.type=type;return e;}),events=[],windowHandlers={},calls=[];
const context=vm.createContext({console,structuredClone,AbortController,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},setTimeout,clearTimeout,
  ranchDashboardRows,ranchDashboardSummary,renderRanchBoxPlot,renderRanchMetricTrend,renderRanchHistogram,renderRanchDistributionEmpty,ranchDistributionCSV,ranchLevelLink,formatMinutes,
  loadRanchWorkspace:async()=>{loadCount++;return loadValue;},readRanchTarget:(settings,level)=>targets[level],watchRanchWorkspace:callback=>{watchCallback=callback;return()=>{watchDisposed=true;};},
  calculateRanchWorkspace:async(workspace,options)=>{calls.push({workspace,options});if(failNext){failNext=false;throw Error('模拟计算失败');}return new Promise(resolve=>{activeCall={workspace,options,resolve};options.signal.addEventListener('abort',resolve,{once:true});});},
  document:{getElementById:id=>elements.get(id),querySelectorAll:selector=>selector==='[data-type]'?typeButtons:[],createElement:()=>new Element()},
  window:{dispatchEvent:event=>events.push(event),addEventListener:(name,fn)=>windowHandlers[name]=fn},
  URL:{createObjectURL:()=>'',revokeObjectURL(){}},Blob:class{constructor(parts){lastCSV=parts.join('');}}
});
vm.runInContext(app.replace(/^\uFEFF?import .*;\r?\n/gm,''),context);
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};await flush();
test('dashboard loads shared results with no automatic calculation or settings write',()=>{
  assert.equal(calls.length,0);assert.equal(loadCount,1);assert.equal(elements.get('distributionWorkspace').hidden,false);assert.equal(elements.get('distributionError').hidden,true);assert.equal(elements.get('distributionLevel').value,'2');assert(elements.get('distributionRows').innerHTML.includes('ranch.html?level=2&amp;type=chain'));assert.equal(events[0].type,'ranch:source');
});
test('type and level controls remain compact filters, while direct links open scheme details',()=>{
  typeButtons[2].onclick();assert(!elements.get('distributionRows').innerHTML.includes('distribution-type-building'));assert(elements.get('distributionRows').innerHTML.includes('distribution-type-chain'));
  elements.get('distributionLevel').value='1';elements.get('distributionLevel').onchange();assert(elements.get('selectedDistributionMeta').textContent.includes('高级加工链'));typeButtons[0].onclick();
});
const run=elements.get('calculateDistribution').onclick();await flush();
test('calculate delegates to target-driven quantity fitting and disables duplicate actions',()=>{
  assert.equal(calls.length,1);assert.equal(activeCall.options.mode,'quantity');assert.equal(activeCall.workspace,loadValue);assert.equal(elements.get('calculateDistribution').disabled,true);assert.equal(elements.get('pauseDistribution').hidden,false);assert.equal(elements.get('pauseDistribution').disabled,false);
  activeCall.options.onProgress({level:2,index:1,total:2,message:'计算 Lv 2 · 1 / 2'});assert.equal(elements.get('distributionProgress').textContent,'计算 Lv 2 · 1 / 2');
});
activeCall.workspace.plans[0].results.set('pending',{proven:true,optimalMinutes:120});activeCall.options.onChange();elements.get('pauseDistribution').onclick();await run;await flush();
test('pause aborts the shared task while retaining its partial results in the overview',()=>{
  assert(activeCall.options.signal.aborted);assert.equal(elements.get('calculateDistribution').disabled,false);assert.equal(elements.get('pauseDistribution').hidden,true);assert(elements.get('distributionSummary').innerHTML.includes('5'));assert(elements.get('distributionProgress').textContent.includes('已暂停'));
});
watchCallback();await flush();
test('idle cross-page updates reload shared results and export the current type and targets',()=>{
  assert.equal(loadCount,2);elements.get('downloadDistribution').onclick();assert(lastCSV.includes('同建筑'));assert(lastCSV.includes('高级加工链'));assert(lastCSV.includes('优化目标(分)'));
});
const next=elements.get('calculateDistribution').onclick();await flush();watchCallback();assert.equal(loadCount,2);activeCall.resolve();await next;await flush();
test('external updates wait until active calculation finishes and pause is re-enabled for later runs',()=>{
  assert.equal(loadCount,3);assert.equal(elements.get('calculateDistribution').disabled,false);assert.equal(elements.get('pauseDistribution').hidden,true);
});
failNext=true;await elements.get('calculateDistribution').onclick();await flush();
test('runner errors are visible and leave a retryable page',()=>{assert.equal(elements.get('distributionError').hidden,false);assert.equal(elements.get('distributionError').textContent,'模拟计算失败');assert.equal(elements.get('calculateDistribution').disabled,false);});
loadValue=null;await elements.get('reloadDistribution').onclick();
test('missing project has an import entry, no stale results and no calculation',()=>{assert.equal(elements.get('distributionEmpty').hidden,false);assert.equal(elements.get('distributionWorkspace').hidden,true);assert.equal(elements.get('calculateDistribution').disabled,true);assert(html.includes('导入 Excel →'));windowHandlers.pagehide();assert.equal(watchDisposed,true);});
console.log(checks+' ranch dashboard checks passed');
