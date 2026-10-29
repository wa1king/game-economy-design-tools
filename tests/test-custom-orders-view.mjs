import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildCatalog,levelInfo} from '../orders/order-engine.js';
import * as custom from '../orders/custom-orders.js';
import {renderOrderItems} from '../orders/item-info.js';
import {ordinaryOrderReward,unitCoinValue} from '../orders/coin-values.js';
const source=fs.readFileSync(new URL('../orders/custom-orders-view.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function createCustomOrdersView','function createCustomOrdersView')+'\nglobalThis.create=createCustomOrdersView;';
function harness(){
 const elements=new Map(),listeners=new Map(),modes=[];
 class Element{
  constructor(id=''){this.id=id;this.dataset={};this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.events=new Map();this.classList={toggle(){}};}
  set innerHTML(value){this.html=value;if(this.id==='customPanel')for(const [,id] of value.matchAll(/id="([^"]+)"/g))elements.set(id,new Element(id));}
  get innerHTML(){return this.html??'';}
  querySelector(selector){return elements.get(selector.slice(1));}
  querySelectorAll(){return modes;}
  addEventListener(type,fn){if(this.id==='customPanel')listeners.set(type,fn);else this.events.set(type,fn);}
  setAttribute(){}
 }
 const root=new Element('customPanel');elements.set('customPanel',root);
 for(const mode of ['pick','overview']){const e=new Element();e.dataset.customMode=mode;modes.push(e);}
 const c=buildCatalog({maxLevel:2,sources:[{id:0,name:'农田'}],products:[{id:1,name:'小麦',level:1,buildingId:0,isCrop:true,stepMinutes:2,analysisBatchYield:1,coinValue:1,inputs:[]},{id:2,name:'玉米',level:2,buildingId:0,isCrop:true,stepMinutes:5,analysisBatchYield:1,coinValue:2,inputs:[]}]});
 let selection=custom.normalizeCustomOrders(),busy=false,failSave=false;
 const context={document:{getElementById:()=>root},...custom,renderOrderItems,ordinaryOrderReward,unitCoinValue};vm.runInNewContext(source,context);
 const view=context.create({getCatalog:()=>c,getSelection:()=>selection,getInfo:level=>levelInfo(c,level),isBusy:()=>busy,getTiming:()=>({proven:true,optimalMinutes:12}),onChange:next=>{if(failSave)throw Error('另一个页面已更新项目');selection=next;}});view.render();
 const click=dataset=>listeners.get('click')({target:{closest:()=>({dataset,disabled:false})}});
 return {view,elements,root,get selection(){return selection;},click,setBusy:value=>busy=value,setSelection:value=>{selection=custom.normalizeCustomOrders(value);view.render();},setSaveFailure:value=>failSave=value};
}
test('select, reorder and remove tasks update the chosen panel and all-level overview',()=>{
 const h=harness();h.click({customAdd:'S1-1'});assert.deepEqual([...h.selection.levels[1]],['S1-1']);assert.equal(h.elements.get('customPickedCount').textContent,1);
 assert(!h.root.innerHTML.includes('<th>种类</th>'));assert(h.elements.get('customLibraryRows').innerHTML.includes('custom-optimal">12</td>'));assert(h.elements.get('customPickedRows').innerHTML.includes('优化 12 分'));
 h.elements.get('customLevel').value='2';h.elements.get('customLevel').onchange();h.click({customAdd:'S1-1'});h.click({customAdd:'S1-2'});h.click({customUp:'S1-2'});
 assert.deepEqual([...h.selection.levels[2]],['S1-2','S1-1']);assert(h.elements.get('customOverviewRows').innerHTML.includes('Lv 2'));assert(h.elements.get('customSummary').textContent.includes('共 3 个任务'));
 h.click({customRemove:'S1-2'});assert.deepEqual([...h.selection.levels[2]],['S1-1']);
 h.click({customMode:'overview'});assert.equal(h.elements.get('customOverview').hidden,false);h.click({customOpen:'1'});assert.equal(h.elements.get('customLevel').value,1);assert.equal(h.elements.get('customPick').hidden,false);
});
test('library filter, add-page and clear act only on the current level',()=>{
 const h=harness();h.elements.get('customLevel').value='2';h.elements.get('customLevel').onchange();const search=h.elements.get('customSearch');search.value='玉米';search.events.get('input')();
 h.elements.get('customAddPage').onclick();assert(h.selection.levels[2].every(id=>id.includes('2')));assert.equal(h.selection.levels[1],undefined);
 h.elements.get('customClear').onclick();assert.equal(h.selection.levels[2],undefined);
});
test('failed saves and busy operations do not show an unsaved choice as selected',()=>{
 const h=harness();h.setSaveFailure(true);h.click({customAdd:'S1-1'});assert.equal(h.selection.levels[1],undefined);assert(h.elements.get('customMessage').textContent.includes('另一个页面'));
 h.setSaveFailure(false);h.setBusy(true);h.click({customAdd:'S1-1'});assert.equal(h.selection.levels[1],undefined);assert(h.elements.get('customMessage').textContent.includes('等待'));
});

test('overview shows each selected order contents and timing in three slots, rather than aggregate-only columns',()=>{
 const h=harness();
 h.setSelection({version:1,levels:{2:['S1-1','S1-2','S2-1-2']}});
 h.click({customMode:'overview'});
 const html=h.elements.get('customOverviewRows').innerHTML;
 assert(!h.root.innerHTML.includes('平均优化时间'));
 for(const label of ['订单 1','订单 2','订单 3'])assert(h.root.innerHTML.includes(label));
 assert.equal((html.match(/class="custom-overview-order"/g)||[]).length,3);
 assert.equal((html.match(/class="custom-overview-order custom-overview-empty"/g)||[]).length,3);
 assert.equal((html.match(/class="custom-overview-items"/g)||[]).length,3);
 assert.equal((html.match(/优化 <b>12 分<\/b>/g)||[]).length,3);
 assert(html.includes('小麦<span>×7</span>'));assert(html.includes('玉米<span>×7</span>'));
 assert(html.includes('累计 49 分'));assert(html.includes('复杂度 2'));assert(html.includes('金币'));
 assert(html.includes('data-product-id="1"')); // Same hover detail hook as the order library.
});

test('overview wraps extra saved orders to another row and retains unavailable selections',()=>{
 const h=harness();
 h.setSelection({version:1,levels:{2:['S1-1','S1-2','S2-1-2','missing-order']}});
 const html=h.elements.get('customOverviewRows').innerHTML;
 assert(html.includes('rowspan="2"'));assert(html.includes('custom-overview-continuation'));
 assert(html.includes('订单 4 · missing-order'));assert(html.includes('当前等级或规则下不可用'));
 assert.equal((html.match(/data-custom-open="2"/g)||[]).length,1);
 assert.equal((html.match(/class="custom-overview-items"/g)||[]).length,3);
});
