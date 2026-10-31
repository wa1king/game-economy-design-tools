import {DEFAULT_CROP_QUANTITY,readRanchSettings} from '../orders/order-quantity-rules.js';
import {writeSharedChainSource} from '../orders/shared-chain-source.js';
import {RANCH_RULES_FORM} from '../orders/ranch-rules-dialog.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {prepareRanch} from '../orders/ranch-engine.js';
import {generateRanchLevelGroups} from '../orders/ranch-catalog.js';
import {ranchBrowserScope,ranchSchemeStep} from '../orders/ranch-browser.js';
import {ranchChainData,renderRanchChain} from '../orders/ranch-chain.js';
import {layoutRanchChain} from '../orders/ranch-chain-layout.js';
import {ranchCapacities,groupMetrics,solveRanchGroup} from '../orders/ranch-engine.js';
import {ranchDemandKey,ranchPermutations,remapRanchResult} from '../orders/ranch-catalog.js';
import {setupRanchChains} from '../orders/ranch-chain.js';
import {quantityGroup,quantityOptions,estimateRanchWorkRatio} from '../orders/ranch-quantity.js';
import {renderOrderItems} from '../orders/item-info.js';
import {calculateRanchImport,canMigrateRanchSettings,backupRanchBeforeImport,ranchSettingsKey,ranchImportCacheKey,readRanchResultBundle} from '../orders/ranch-import.js';
import {mergeRanchCacheValue} from '../orders/ranch-cache.js';
import {mergeRanchSettings,readRanchTarget,validateRanchTarget,ranchFitIsCurrent} from '../orders/ranch-workspace.js';
const p=(id,b,level=1,inputs=[])=>({id,name:'商品'+id,buildingId:b,buildingName:'建筑'+b,level,stepMinutes:5,analysisBatchYield:1,isCrop:b===0,inputs:inputs.map(([id,quantity])=>({id,quantity}))});
const base={maxLevel:20,sources:[{id:0,name:'田地',level:1},{id:10,name:'磨坊',level:2},{id:20,name:'厨房',level:4}],products:[p(1,0),p(2,0),p(3,0),p(4,0),p(5,10,2,[[1,1]]),p(6,10,2,[[2,1]]),p(7,10,3,[[1,1],[2,1]]),p(8,10,3,[[3,1]]),p(9,20,5,[[5,1],[6,1],[3,1]]),p(10,20,6,[[7,1],[8,1],[4,1]])]};
const model=prepareRanch(base),catalog=generateRanchLevelGroups(model,20,{allowRepeated:false});
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
test('same-building route narrows first to building then exactly its available schemes',()=>{
  const s=ranchBrowserScope(model,catalog.families,catalog.groups,{type:'building',buildingId:10});
  assert.deepEqual(s.buildings.map(b=>b.id),[10,20]);assert.equal(s.family.id,'b10');assert.equal(s.groups.length,35);assert(s.groups.every(g=>g.slots.every(v=>model.by.get(v.id).buildingId===10)));
});
test('advanced chains group final products by their actual producing building',()=>{
  const a=ranchBrowserScope(model,catalog.families,catalog.groups,{type:'chain',buildingId:20,familyId:'p9'}),b=ranchBrowserScope(model,catalog.families,catalog.groups,{type:'chain',buildingId:20,familyId:'p10'});
  assert.deepEqual(a.buildings.map(v=>v.id),[20]);assert.deepEqual(a.families.map(v=>v.anchorId),[9,10]);assert(a.groups.length>0&&b.groups.length>0);assert(a.groups.every(g=>g.slots.some(v=>v.id===9)));assert(b.groups.every(g=>g.slots.some(v=>v.id===10)));
});
test('scope changes retain shared catalogue membership without dropping or copying groups',()=>{
  const reached=new Set();for(const type of ['building','chain'])for(const f of catalog.families.filter(f=>f.type===type)){
    const owner=model.by.get(f.anchorId??f.productIds[0]).buildingId,s=ranchBrowserScope(model,catalog.families,catalog.groups,{type,buildingId:owner,familyId:f.id});
    for(const g of s.groups){assert(catalog.groups.includes(g));reached.add(g.id);}
  }assert.equal(reached.size,catalog.groups.length);
  const fallback=ranchBrowserScope(model,catalog.families,catalog.groups,{type:'chain',buildingId:999,familyId:'deleted'});assert.equal(fallback.building.id,20);assert.equal(fallback.family.id,'p9');
});
test('no valid four-item family gives an explicit empty navigation state',()=>{
  const early=generateRanchLevelGroups(model,1,{allowRepeated:false}),s=ranchBrowserScope(model,early.families,early.groups,{type:'chain'});assert.equal(s.building,null);assert.equal(s.family,null);assert.deepEqual(s.groups,[]);
});
test('previous and next scheme controls stay within the current scope',()=>{
  const rows=catalog.groups.slice(0,3);assert.equal(ranchSchemeStep(rows,rows[0].id,-1),rows[0]);assert.equal(ranchSchemeStep(rows,rows[1].id,1),rows[2]);assert.equal(ranchSchemeStep(rows,rows[2].id,1),rows[2]);assert.equal(ranchSchemeStep([],null,1),null);
});
test('compact graph preserves every node, recipe, count and workshop color',()=>{
  for(const group of catalog.groups){const d=ranchChainData(model,group,20),before=JSON.stringify(d),a=layoutRanchChain(d),b=layoutRanchChain(d,{overview:true});assert.equal(a.edges.length,b.edges.length);assert.deepEqual([...a.positions.keys()].sort(),[...b.positions.keys()].sort());assert(b.height<a.height);assert.equal(JSON.stringify(d),before);const html=renderRanchChain(d,{overview:true});assert(html.includes('data-auto-fit="true"'));assert(!html.includes('解锁等级 · 新建筑'));for(const n of d.nodes)assert(html.includes(`fill="${n.color}"`));}
});
test('page keeps catalogue and tuning collapsed after the always-visible scheme graph',()=>{
  const html=fs.readFileSync(new URL('../orders/ranch.html',import.meta.url),'utf8')+'<dialog id="ranchRulesDialog">'+RANCH_RULES_FORM+'</dialog>',ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(v=>v[1]);assert.equal(new Set(ids).size,ids.length);
  assert(!html.includes('id="allType"'));assert(html.indexOf('id="chainGraph"')<html.indexOf('id="catalogDetails"'));assert(html.includes('<section id="groupDetails"'));for(const id of ['targetDetails','catalogDetails'])assert(html.includes(`<details id="${id}" class="secondary-section">`));
  const sidebar=html.slice(html.indexOf('<aside class="plan-sidebar">'),html.indexOf('</aside>'));
  for(const id of ['buildingNav','productNav','schemeNav','slots'])assert(sidebar.includes(`id="${id}"`));
  assert(!sidebar.includes('id="chainGraph"'));assert(!html.includes('id="schemeSelect"'));
  assert(html.includes('id="chainGraph" class="chain-graph"></div></section><section id="scheduleDetails" class="panel schedule-panel">'),'schedule must directly follow the processing graph');
  assert(!html.includes('<details id="scheduleDetails"'));
  const app=fs.readFileSync(new URL('../orders/ranch-app.js',import.meta.url),'utf8');for(const v of app.matchAll(/\$\('([^']+)'\)/g))assert(ids.includes(v[1]),'missing DOM binding '+v[1]);new vm.Script(app.replace(/^import .*;\r?\n/gm,''));
});
// Minimal DOM/event simulation, not browser execution. Exercise the actual app
// handlers using isolated memory storage and a worker stub, never user projects.
{
  const html=fs.readFileSync(new URL('../orders/ranch.html',import.meta.url),'utf8')+'<dialog id="ranchRulesDialog">'+RANCH_RULES_FORM+'</dialog>',elements=new Map();
  const attributes=str=>Object.fromEntries([...str.matchAll(/([\w-]+)="([^"]*)"/g)].map(v=>[v[1],v[2]]));
  class Element{
    constructor(tag,attrs={}){this.tag=tag;this.id=attrs.id;this._value=attrs.value??'';this._html='';this.inputs=[];this.buttons=[];this.checked=false;this.open=false;this.hidden=false;this.disabled=false;this.dataset={};this.handlers={};this.style={};this.classList={toggle(){}};}
    set innerHTML(value){this._html=value;this.inputs=[...value.matchAll(/<input\b([^>]*)>/g)].map(v=>{const a=attributes(v[1]),e=new Element('input',a);e.dataset={quantity:a['data-quantity'],cap:a['data-cap']};return e;});this.buttons=[...value.matchAll(/<button\b([^>]*)>/g)].map(v=>{const a=attributes(v[1]),e=new Element('button',a);e.dataset.browseScheme=a['data-browse-scheme'];return e;});if(this.tag==='select'){const opts=[...value.matchAll(/<option\b([^>]*)>(.*?)<\/option>/g)];this._value=attributes(opts.find(v=>/selected/.test(v[1]))?.[1]??opts[0]?.[1]??'').value??'';}}
    get innerHTML(){return this._html;}
    set value(v){this._value=String(v);}get value(){return this._value;}
    querySelectorAll(query){return query.includes('input')?this.inputs:query==='[data-browse-scheme]'?this.buttons:[];}
    addEventListener(name,fn){this.handlers[name]=fn;}
    setAttribute(name,value){this[name]=value;}
    scrollIntoView(){}
    focus(){this.focused=true;}
  }
  for(const m of html.matchAll(/<(\w+)\b([^>]*\bid="[^"]+"[^>]*)>/g)){const a=attributes(m[2]),e=new Element(m[1],a);elements.set(e.id,e);}
  for(const id of ['searchLimit','sort','direction','quantityBudget']){const pattern=new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`);elements.get(id).innerHTML=html.match(pattern)[1];}
  const isolatedBase={...base,landsByLevel:{20:30}},memory=new Map([['ranch-source-v1',JSON.stringify({kind:'import',base:isolatedBase,filename:'synthetic.xlsx'})]]),posts=[],scheduleCache=new Map(),notices=[];
  const context=vm.createContext({estimateRanchWorkRatio,ranchFitIsCurrent,DEFAULT_CROP_QUANTITY,readRanchSettings,console,createRanchLevelCatalog:()=>({refresh(){}}),structuredClone,prepareRanch,ranchCapacities,groupMetrics,solveRanchGroup,generateRanchLevelGroups,ranchDemandKey,ranchPermutations,remapRanchResult,ranchBrowserScope,ranchSchemeStep,ranchChainData,renderRanchChain,setupRanchChains,quantityGroup,quantityOptions,renderOrderItems,calculateRanchImport,canMigrateRanchSettings,backupRanchBeforeImport,ranchSettingsKey,ranchImportCacheKey,readRanchResultBundle,
    setupItemInfo:base=>({products:new Map(base.products.map(p=>[p.id,p])),hide(){}}),createProjectStore:()=>({load:()=>null}),writeSharedChainSource:(b,n)=>writeSharedChainSource(b,n,{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}),readChainExcel:async file=>file.base,loadRanchCache:async key=>scheduleCache.get(key),saveRanchCache:async(key,value)=>{scheduleCache.set(key,value);},performance:{now:()=>1000},crypto:{getRandomValues:a=>{a[0]=0;}},setTimeout:()=>1,clearTimeout(){},
    mergeRanchSettings,readRanchTarget,validateRanchTarget,notifyRanchChange(...args){notices.push(args);},watchRanchWorkspace(){},ranchSource:()=>JSON.parse(memory.get('order-shared-chain-v1')||memory.get('ranch-source-v1')||'null'),mergeRanchCache:async(key,value)=>scheduleCache.set(key,mergeRanchCacheValue(scheduleCache.get(key),value)),Worker:class{postMessage(v){posts.push(v);}terminate(){}},localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)},window:{addEventListener(){}},document:{getElementById:id=>elements.get(id),querySelector:()=>new Element('main'),querySelectorAll:q=>q==='#slots input'?elements.get('slots').inputs:[]}});
  vm.runInContext(fs.readFileSync(new URL('../orders/ranch-app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,''),context);
  await vm.runInContext('rebuild()',context);
  test('app opens a scheme graph without generating the collapsed full table',()=>{
    assert.equal(elements.get('message').textContent,'');assert(elements.get('chainGraph').innerHTML.includes('data-auto-fit="true"'));assert.equal(elements.get('rows').innerHTML,'');assert.equal(elements.get('family').value,'b10');assert.equal(posts.length,0,'opening a viewer must not schedule arbitrary quantities');
  });
  test('single-group calculation starts target-driven fitting without an initial scheduling pass',()=>{
    elements.get('fitOne').onclick();assert(posts.length,elements.get('message').textContent);assert.equal(posts.at(-1).mode,'quantity');assert(posts.at(-1).options.targetWorkMinutes>0);vm.runInContext('stop()',context);
  });
  elements.get('level').value='1';elements.get('level').onchange();await Promise.resolve();
  test('crop-only early levels show an empty same-building view with no stale graph or solve action',()=>{
    assert.equal(vm.runInContext('groups.length',context),0);assert.equal(elements.get('chainGraph').innerHTML,'');assert.equal(elements.get('fitOne').disabled,true);assert.equal(elements.get('family').value,'');assert(elements.get('buildingNav').innerHTML.includes('暂无'));
  });
  elements.get('level').value='20';elements.get('level').onchange();await new Promise(resolve=>setTimeout(resolve,0));
  test('actual building, chain product and next-scheme handlers update the persistent viewer',()=>{
    elements.get('buildingNav').onclick({target:{closest:()=>({dataset:{browseBuilding:'10'}})}});assert.equal(elements.get('family').value,'b10');assert(elements.get('groupTitle').textContent.includes('磨坊'));
    elements.get('chainType').onclick();assert.equal(elements.get('family').value,'p9');assert.equal(elements.get('productFilterRow').hidden,false);
    elements.get('productNav').onclick({target:{closest:()=>({dataset:{browseFamily:'p10'}})}});assert.equal(elements.get('family').value,'p10');const old=vm.runInContext('current.id',context),next=vm.runInContext('entries()[1].g.id',context);elements.get('schemeNav').onclick({target:{closest:()=>({dataset:{browseScheme:next}})}});assert.notEqual(vm.runInContext('current.id',context),old);assert(elements.get('groupMeta').textContent.includes('方案 2'));
    const selected=vm.runInContext('current.id',context);vm.runInContext('renderSelected(); renderTable()',context);assert.equal(vm.runInContext('current.id',context),selected);
    assert.equal(elements.get('rows').innerHTML,'');assert(memory.get(vm.runInContext('storageKey',context)).includes('"familyId":"p10"'));
  });
  test('four identical goods allow independent quantity edits and retain all delivery slots',()=>{
    elements.get('buildingType').onclick();elements.get('buildingNav').onclick({target:{closest:()=>({dataset:{browseBuilding:'10'}})}});
    const id=vm.runInContext('viewRows.find(g=>g.slots.every(v=>v.id===5)).id',context);
    elements.get('schemeNav').onclick({target:{closest:()=>({dataset:{browseScheme:id}})}});
    vm.runInContext('stop()',context);
    const inputs=elements.get('slots').inputs;inputs[0].value='3';elements.get('slots').handlers.change({target:inputs[0]});
    assert.equal(vm.runInContext('JSON.stringify(current.slots.map(v=>v.quantity))',context),'[3,1,1,1]');
    assert.equal(vm.runInContext('ranchChainData(model,current,level).nodes.find(n=>n.id===5).delivered',context),6);
    assert.equal(vm.runInContext('JSON.stringify(ranchChainData(model,current,level).nodes.find(n=>n.id===5).deliverySlots)',context),'[0,1,2,3]');
    vm.runInContext('stop()',context);const second=elements.get('slots').inputs[1];second.value='2';elements.get('slots').handlers.change({target:second});
    assert.equal(vm.runInContext('JSON.stringify(current.slots.map(v=>v.quantity))',context),'[3,2,1,1]');
    elements.get('chainType').onclick();
  });
  test('optional table search cannot silently filter the primary scheme browser',()=>{
    const selected=vm.runInContext('current.id',context),size=vm.runInContext('viewRows.length',context);elements.get('search').value='no such product';elements.get('search').oninput();assert.equal(vm.runInContext('current.id',context),selected);assert.equal(vm.runInContext('viewRows.length',context),size);assert.equal(elements.get('shuffle').disabled,false);elements.get('search').value='';elements.get('search').oninput();
  });
  test('level and compact graph toggles keep quantities and the selected scheme unchanged',()=>{
    const before=vm.runInContext('JSON.stringify(current.slots)',context);elements.get('levelGraph').onclick();assert(!elements.get('chainGraph').innerHTML.includes('data-auto-fit="true"'));elements.get('compactGraph').onclick();assert(elements.get('chainGraph').innerHTML.includes('data-auto-fit="true"'));assert.equal(vm.runInContext('JSON.stringify(current.slots)',context),before);
    elements.get('catalogDetails').open=true;elements.get('catalogDetails').ontoggle();assert(elements.get('rows').innerHTML.includes('data-select='));
  });
  test('left scheme tabs expose selection and support keyboard navigation without rebuilding the tabs',()=>{
    const nav=elements.get('schemeNav'),buttons=nav.buttons,selected=buttons.find(v=>v['aria-pressed']==='true');assert(selected);
    let prevented=false;nav.handlers.keydown({key:'Home',target:{closest:()=>selected},preventDefault(){prevented=true;}});assert(prevented);assert.equal(nav.buttons,buttons);assert.equal(buttons[0]['aria-pressed'],'true');assert(buttons[0].focused);
    nav.handlers.keydown({key:'ArrowRight',target:{closest:()=>buttons[0]},preventDefault(){}});assert.equal(buttons[1]['aria-pressed'],'true');assert.equal(buttons[0]['aria-pressed'],'false');
  });
  test('joint schedule renders beside the current graph without opening a details panel',()=>{
    assert.equal(elements.get('scheduleDetails').tag,'section');assert.equal(elements.get('scheduleDetails').open,false);
    vm.runInContext('results.set(current.key,solveRanchGroup(model,current,level,capacities));renderSelected()',context);assert(elements.get('schedule').innerHTML.includes('<svg'));assert.equal(elements.get('completion').hidden,false);
  });
  test('repeated local saves retain another page target edits and synchronize stale input values',()=>{
    vm.runInContext('stop();persist()',context);const key=vm.runInContext('storageKey',context),latest=JSON.parse(memory.get(key));
    latest.quantityTargetsByLevel[20].targetHours='8';latest.quantityTargets={...latest.quantityTargetsByLevel[20]};latest.quantityTargetsByLevel[19]={...latest.quantityTargetsByLevel[20],targetHours:'7.5'};memory.set(key,JSON.stringify(latest));
    assert.notEqual(elements.get('targetHours').value,'8');
    vm.runInContext('persist();persist()',context);const saved=JSON.parse(memory.get(key));assert.equal(saved.quantityTargetsByLevel[20].targetHours,'8');assert.equal(saved.quantityTargetsByLevel[19].targetHours,'7.5');assert.equal(elements.get('targetHours').value,'8');
  });
  {
    vm.runInContext('stop()',context);const key=vm.runInContext('storageKey',context),cacheKey=vm.runInContext('cacheKey',context),selected=vm.runInContext('structuredClone(current)',context),updated=quantityGroup(selected,[4,3,2,1]),latest=JSON.parse(memory.get(key));
    latest.quantityEdits[20][selected.id]=[4,3,2,1];memory.set(key,JSON.stringify(latest));const capacities=vm.runInContext('structuredClone(capacities)',context),result=solveRanchGroup(model,updated,20,capacities);
    await vm.runInContext('cacheQueue',context);scheduleCache.set(cacheKey,mergeRanchCacheValue(scheduleCache.get(cacheKey),{results:[[updated.key,result]]}));
    // A local save may have already merged the new settings before the storage
    // event is handled; synchronization must still refresh the visible group.
    vm.runInContext('persist()',context);await vm.runInContext('cacheQueue',context);const postsBefore=posts.length,noticesBefore=notices.length;await vm.runInContext('syncRanchView()',context);await vm.runInContext('cacheQueue',context);
    test('cross-page quantity updates refresh the selected graph and joint schedule without starting another solve',()=>{
      assert.equal(vm.runInContext('current.id',context),selected.id);assert.equal(vm.runInContext('current.key',context),updated.key);assert.equal(vm.runInContext('JSON.stringify(current.slots.map(s=>s.quantity))',context),'[4,3,2,1]');assert.equal(posts.length,postsBefore);assert.equal(vm.runInContext('resultFor(current).totalMinutes',context),result.totalMinutes);assert(elements.get('chainGraph').innerHTML.includes('<svg'));
    });
    test('reading another page updates emits no write notification that could cause refresh loops',()=>{assert.equal(notices.length,noticesBefore);});
    await vm.runInContext('window.ranchBeforeNavigate()',context);
    test('navigation flush retains the newest shared quantities and targets',()=>{
      const saved=JSON.parse(memory.get(key));assert.deepEqual(saved.quantityEdits[20][selected.id],[4,3,2,1]);assert.equal(saved.quantityTargetsByLevel[20].targetHours,'8');assert(scheduleCache.get(cacheKey).results.some(([k])=>k===updated.key));
    });
  }
  {
    const before=memory.get('ranch-source-v1'),newBase={...structuredClone(base),landsByLevel:Object.fromEntries(Array.from({length:20},(_,i)=>[i+1,30]))};newBase.products.forEach(p=>{p.coinValue=p.id;});
    const postsBefore=posts.length;
    elements.get('importFile').files=[{name:'新表.xlsx',size:1000,base:newBase}];await elements.get('importFile').onchange();await vm.runInContext('cacheQueue',context);await new Promise(resolve=>setTimeout(resolve,0));
    test('Excel import shares source, preserves targets and quantities, and does not run all-level solves',()=>{
      assert.equal(elements.get('workspace').inert,false);assert.equal(elements.get('importButton').disabled,false);
      assert.equal(JSON.parse(memory.get('order-shared-chain-v1')).filename,'新表.xlsx');assert.equal(elements.get('sourceMeta').textContent,'10 商品 · 10 个已定价');
      assert.equal(JSON.stringify(JSON.parse(memory.get('order-shared-chain-before-import-v1')).ranch),before);
      assert.equal(posts.length,postsBefore);assert.equal(vm.runInContext('results.size',context),0);
      const settings=JSON.parse(memory.get(vm.runInContext('storageKey',context)));assert.equal(settings.quantityTargetsByLevel[20].targetHours,'8');
    });
    const cacheKey=vm.runInContext('cacheKey',context),group=vm.runInContext('current',context),fake=solveRanchGroup(prepareRanch(newBase),group,20,vm.runInContext('capacities',context),{timeLimitMs:30,nodeLimit:100});
    scheduleCache.set(cacheKey,{version:2,results:[[group.key,fake]],failures:[],quantityFits:[]});
    elements.get('importFile').files=[{name:'新表.xlsx',size:1000,base:newBase}];await elements.get('importFile').onchange();await vm.runInContext('cacheQueue',context);await new Promise(resolve=>setTimeout(resolve,0));
    test('same-source reimport retains matching cached schedules without recomputing',()=>{assert.equal(vm.runInContext('results.size',context),1);assert.equal(posts.length,postsBefore);});
  }
}
console.log(count+' scheme browser checks passed');
