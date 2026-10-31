import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createConfigClipboard} from '../orders/config-clipboard.js';

const html=fs.readFileSync(new URL('../orders/ranch-config.html',import.meta.url),'utf8'),source=fs.readFileSync(new URL('../orders/ranch-config-app.js',import.meta.url),'utf8');
const context=vm.createContext({console,AbortController,createConfigClipboard});
vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),context);
const evaluate=(expression,args={})=>{Object.assign(context,args);return vm.runInContext(expression,context);};
const columns=evaluate('RANCH_CONFIG_COLUMNS'),defaults={targetHours:'6',targetTolerance:'30',targetWork:'',fitCropMax:'42',fitProductMax:'12',quantityBudget:'2500'};
let checks=0;const test=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
const plan=(level,count=2)=>({level,groups:Array.from({length:count},(_,i)=>({id:'G'+i,key:'L'+level+'G'+i})),results:new Map(),failures:new Map(),capacityError:null});

await test('rows preserve raw input text and separate proof from completed feasible schedules',()=>{
  const p=plan(3);p.results.set('L3G0',{proven:true,optimalMinutes:0});p.results.set('L3G1',{proven:false,optimalMinutes:5,feasibleMinutes:20});
  const status=evaluate('ranchConfigRowState(p)',{p});assert.equal(status.done,2);assert.equal(status.proven,1);assert.equal(status.kind,'warn');
  p.results.set('L3G1',{proven:false,optimalMinutes:5});assert.equal(evaluate('ranchConfigRowState(p)').done,1);p.results.set('L3G1',{proven:true,optimalMinutes:NaN});assert.equal(evaluate('ranchConfigRowState(p)').proven,1);
  const row=evaluate('renderRanchConfigRow(p,target)',{target:{...defaults,targetHours:'6.50'}});assert(row.includes('value="6.50"'));assert(row.includes('placeholder="自动"'));assert(row.includes('ranch.html?level=3'));assert(!row.includes('quantityBudget'));
});
await test('a numeric downward fill includes current level only through the final level',()=>{
  const edits=evaluate("ranchConfigColumnFill('targetWork','',2,4)");assert.deepEqual(JSON.parse(JSON.stringify(edits)),[2,3,4].map(level=>({level,key:'targetWork',value:''})));assert.throws(()=>evaluate("ranchConfigColumnFill('unknown',1,1,4)"),/无效/);
});
await test('target and quantity errors stay visible even when a prior schedule was proven',()=>{
  const p=plan(2);for(const group of p.groups)p.results.set(group.key,{proven:true,optimalMinutes:50});p.targetError='缺少自动累计工时基线';let state=evaluate('ranchConfigRowState(p)',{p});assert.equal(state.text,'目标待调整');assert.equal(state.detail,p.targetError);assert.equal(state.proven,2);
  delete p.targetError;p.quantityErrors=new Map([['G0','数量上限无法覆盖目标'],['G1','搜索预算不足']]);state=evaluate('ranchConfigRowState(p)');assert.equal(state.text,'2 组配量失败');assert(state.detail.includes('数量上限无法覆盖目标'));p.quantityErrors.clear();assert.equal(evaluate('ranchConfigRowState(p)').kind,'good');
});

// This DOM and all stored values are synthetic. No browser or user storage access.
class Element{
  constructor(doc,dataset={}){this.ownerDocument=doc;this.dataset=dataset;this.listeners={};this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.title='';this.attrs={};this.classes=new Set();this.classList={add:(...names)=>names.forEach(v=>this.classes.add(v)),remove:(...names)=>names.forEach(v=>this.classes.delete(v)),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  emit(name,event={}){const e={target:this,preventDefault(){},stopPropagation(){},...event};for(const fn of this.listeners[name]??[])fn(e);return e;}
  setAttribute(key,value){this.attrs[key]=value;}
  removeAttribute(key){delete this.attrs[key];}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  contains(value){return value===this;}
  closest(){return null;}
  matches(){return false;}
  focus(){this.ownerDocument.activeElement=this;}
}
function createDocument(){
  const doc={listeners:{},addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);},activeElement:null,elements:new Map(),getElementById(id){return this.elements.get(id);}};
  for(const match of html.matchAll(/\bid="([^"]+)"/g)){assert(!doc.elements.has(match[1]),'duplicate id');doc.elements.set(match[1],new Element(doc));}
  const body=doc.getElementById('ranchConfigRows'),head=doc.getElementById('ranchConfigHead');body.rows=new Map();body.inputs=new Map();body.cells=[];
  Object.defineProperty(body,'innerHTML',{get(){return this.markup??'';},set(value){this.markup=value;this.rows.clear();this.inputs.clear();this.cells=[];
    for(const [,levelString,rowHtml]of value.matchAll(/<tr data-level="(\d+)">([\s\S]*?)<\/tr>/g)){
      const level=Number(levelString),row=new Element(doc,{level:levelString}),rowHead=new Element(doc,{selectRow:levelString}),outputs=new Map(['data-done-count','data-proven-count','data-row-state'].map(k=>[k,new Element(doc)]));row.rowHead=rowHead;rowHead.closest=()=>rowHead;
      row.querySelector=selector=>outputs.get(selector.slice(1,-1))??null;this.rows.set(level,row);
      for(const [,key,val]of rowHtml.matchAll(/<input type="number" data-level="\d+" data-key="([^"]+)" value="([^"]*)"/g)){
        const cell=new Element(doc),input=new Element(doc,{level:levelString,key});input.value=val;input.type='number';input.tagName='INPUT';input.validity={badInput:false};input.matches=selector=>selector.startsWith('input[');input.closest=selector=>selector==='td'?cell:null;cell.querySelector=()=>input;input.focus=()=>{doc.activeElement=input;body.emit('focusin',{target:input});};input.cell=cell;this.inputs.set(level+':'+key,input);this.cells.push(cell);
      }
    }
  }});
  body.querySelector=selector=>{
    const row=selector.match(/^tr\[data-level="(\d+)"\]$/);if(row)return body.rows.get(Number(row[1]));
    const input=selector.match(/^input\[data-level="(\d+)"\]\[data-key="([^"]+)"\]$/);if(input)return body.inputs.get(input[1]+':'+input[2]);return null;
  };
  body.querySelectorAll=selector=>selector==='[data-select-row]'?[...body.rows.values()].map(r=>r.rowHead):selector==='input[data-key]'?[...body.inputs.values()]:selector==='.matrix-cell-selected,.matrix-cell-anchor'?body.cells.filter(c=>c.classes.size):[];
  body.contains=value=>value===body||[...body.inputs.values()].includes(value);
  head.cells=columns.map(key=>new Element(doc,{selectColumn:key}));head.all=new Element(doc,{selectAll:''});head.querySelectorAll=selector=>selector==='[data-select-column]'?head.cells:[];head.querySelector=selector=>selector==='[data-select-all]'?head.all:null;
  return doc;
}
function setup({empty=false,failLoad=false,holdAfterAbort=false}={}){
  const doc=createDocument(),workspace={base:{maxLevel:3},filename:'synthetic.xlsx',settings:{quantityTargetsByLevel:{1:{targetHours:'6.50'}}},plans:[plan(1,0),plan(2),plan(3)]};let writes=0,loads=0,watch=null,unwatched=false,pending=null;const runs=[];
  function read(settings,level){return {...defaults,...settings.quantityTargetsByLevel?.[level]};}
  function save(ws,cells){
    const draft=structuredClone(ws.settings);for(const {level,key,value} of cells){const n=Number(value);if(!columns.includes(key)||!Number.isInteger(level)||level<1||level>3)throw Error('无效单元格');if(!(key==='targetWork'&&value==='')&&(!Number.isFinite(n)||(key==='targetTolerance'?n<0:n<=0)))throw Error('需要正数；允许偏差可为 0');if(key.startsWith('fit')&&!Number.isInteger(n))throw Error('数量上限需要整数');((draft.quantityTargetsByLevel??={})[level]??={})[key]=String(value);}
    ws.settings=draft;writes++;watch?.();
  }
  const api={document:doc,createConfigClipboard,readRanchTarget:read,loadRanchWorkspace:async()=>{loads++;if(failLoad)throw Error('导入配方不完整');return empty?null:workspace;},saveRanchTargets:save,watchRanchWorkspace:callback=>{watch=callback;return ()=>{unwatched=true;};},calculateRanchWorkspace:(ws,options)=>{runs.push(options);return new Promise((resolve,reject)=>{pending={resolve,reject,options};options.signal.addEventListener('abort',()=>{if(!holdAfterAbort)resolve();});});}};
  const page=evaluate('createRanchConfigPage(api)',{api});
  return {doc,workspace,page,runs,get writes(){return writes;},get loads(){return loads;},get pending(){return pending;},get unwatched(){return unwatched;},notify:()=>watch(),input:(level,key)=>doc.getElementById('ranchConfigRows').inputs.get(level+':'+key),get:id=>doc.getElementById(id)};
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const s=setup();await s.page.ready;const body=s.get('ranchConfigRows'),head=s.get('ranchConfigHead');
await test('opening configuration loads every level without changing targets, quantities or solving',()=>{
  assert.equal(s.runs.length,0);assert.equal(s.writes,0);assert.equal(s.loads,1);assert.equal(s.get('ranchConfigWorkspace').hidden,false);assert.equal(s.get('ranchConfigEmpty').hidden,true);assert.equal(s.input(1,'targetHours').value,'6.50');assert.equal(body.rows.size,3);assert.equal(body.rows.get(1).querySelector('[data-row-state]').textContent,'暂无组合');
});
function headerClick(dataset,shiftKey=false){const cell=new Element(s.doc,dataset);cell.closest=()=>cell;head.emit('click',{target:cell,shiftKey});}
function copied(){let text='';body.emit('copy',{target:body,clipboardData:{setData:(_,value)=>{text=value;}}});return text;}
function pasted(text){body.emit('paste',{target:s.doc.activeElement,clipboardData:{getData:()=>text}});}
await test('column headers, Shift multi-column, row headers and corner select correct numeric rectangles',()=>{
  headerClick({selectColumn:'targetHours'});assert.equal(copied(),'6.50\r\n6\r\n6');headerClick({selectColumn:'targetWork'},true);assert(copied().split('\r\n').every(row=>row.split('\t').length===3));
  const row=body.rows.get(2).rowHead;body.emit('click',{target:row});assert.equal(copied().split('\r\n').length,1);assert.equal(copied().split('\t').length,5);headerClick({selectAll:''});assert.equal(copied().split('\r\n').length,3);assert(copied().split('\r\n').every(row=>row.split('\t').length===5));
});
await test('multi-cell paste is atomic and leaves original values untouched when any target is invalid',()=>{
  headerClick({selectColumn:'targetHours'});pasted('8');assert.equal(s.writes,1);assert([1,2,3].every(level=>s.input(level,'targetHours').value==='8'));assert.equal(s.loads,1,'own writes should not reload');
  headerClick({selectColumn:'fitCropMax'});const before=JSON.stringify(s.workspace.settings);pasted('4\n0\n5');assert.equal(JSON.stringify(s.workspace.settings),before);assert.equal(s.input(1,'fitCropMax').value,'42');assert(s.get('ranchConfigMessage').textContent.includes('正数'));
});
await test('Ctrl+Enter fills current and later rows and blank cumulative target selects automatic mode',()=>{
  const input=s.input(2,'targetTolerance');input.value='45';body.emit('keydown',{target:input,key:'Enter',ctrlKey:true});assert.equal(s.input(1,'targetTolerance').value,'30');assert.equal(s.input(2,'targetTolerance').value,'45');assert.equal(s.input(3,'targetTolerance').value,'45');
  const work=s.input(2,'targetWork');work.value='';body.emit('keydown',{target:work,key:'Enter',ctrlKey:true});assert.equal(s.workspace.settings.quantityTargetsByLevel[2].targetWork,'');assert.equal(s.workspace.settings.quantityTargetsByLevel[3].targetWork,'');assert.equal(s.runs.length,0);
});
await test('an invalid direct edit is visible and blocks running until corrected',async()=>{
  const input=s.input(2,'targetHours');input.value='0';s.doc.activeElement=input;body.emit('change',{target:input});assert.equal(input.attrs['aria-invalid'],'true');assert.equal(s.get('ranchConfigError').hidden,false);await s.page.run('schedule');assert.equal(s.runs.length,0);
  input.value='5.50';body.emit('change',{target:input});assert.equal(input.attrs['aria-invalid'],undefined);assert.equal(s.workspace.settings.quantityTargetsByLevel[2].targetHours,'5.50');
});
await test('current-quantity calculation delegates to shared runner and pausing preserves partial results',async()=>{
  s.doc.activeElement=null;const running=s.page.run('schedule');await flush();assert.equal(s.runs[0].mode,'schedule');assert.equal(s.input(2,'targetHours').disabled,true);assert.equal(s.get('pauseRanchLevels').hidden,false);
  const p=s.workspace.plans[1];p.results.set(p.groups[0].key,{proven:true,optimalMinutes:123});s.pending.options.onProgress({level:2,index:1,total:4,message:'Lv 2 · 1 / 4'});s.pending.options.onChange();assert.equal(body.rows.get(2).querySelector('[data-done-count]').textContent,'1 / 2');assert.equal(s.get('ranchConfigProgressText').textContent,'Lv 2 · 1 / 4');
  s.get('pauseRanchLevels').onclick();await running;assert(s.runs[0].signal.aborted);assert.equal(s.get('resumeRanchLevels').hidden,false);assert.equal(s.input(2,'targetHours').disabled,false);assert.equal(p.results.size,1);
});
await test('continue retains calculation mode and fitting calls the quantity runner explicitly',async()=>{
  const resumed=s.get('resumeRanchLevels').onclick();await flush();assert.equal(s.runs[1].mode,'schedule');s.pending.resolve();await resumed;assert.equal(s.get('resumeRanchLevels').hidden,true);const fit=s.get('fitRanchLevels').onclick();await flush();assert.equal(s.runs[2].mode,'quantity');s.pending.resolve();await fit;assert.equal(s.get('ranchConfigProgressText').textContent,'本轮计算完成');
});
await test('runner failures appear in row status and the completion summary with actionable reasons',async()=>{
  const running=s.page.run('quantity');await flush();s.workspace.plans[1].targetError='自动累计工时暂无最优基线，请填写累计工时目标';s.workspace.plans[2].quantityErrors=new Map([['G0','本组数量上限无法达到目标']]);s.pending.options.onChange();s.pending.resolve({failed:2});await running;
  assert.equal(body.rows.get(2).querySelector('[data-row-state]').textContent,'目标待调整');assert.equal(body.rows.get(3).querySelector('[data-row-state]').textContent,'1 组配量失败');assert.equal(s.get('ranchConfigProgressText').textContent,'本轮完成 · 2 项需处理');assert(s.get('ranchConfigError').textContent.includes('Lv 2'));assert(s.get('ranchConfigError').textContent.includes('填写累计工时目标'));assert(s.get('ranchConfigError').textContent.includes('数量上限'));
  delete s.workspace.plans[1].targetError;s.workspace.plans[2].quantityErrors.clear();
});
await test('external updates reload automatically except during editing and calculation',async()=>{
  s.doc.activeElement=s.input(2,'targetHours');const before=s.loads;s.notify();await flush();assert.equal(s.loads,before);assert.equal(s.get('ranchConfigChanged').hidden,false);s.doc.activeElement=null;body.emit('focusout');await flush();assert.equal(s.loads,before+1);assert.equal(s.get('ranchConfigChanged').hidden,true);
  const running=s.page.run('schedule');await flush();s.notify();await flush();assert.equal(s.loads,before+1);s.pending.resolve();await running;await flush();assert.equal(s.loads,before+2);
});
await test('navigation commits a focused raw input and refuses invalid unsaved values',async()=>{
  const clean=setup();await clean.page.ready;const input=clean.input(2,'targetHours');input.value='4.50';clean.doc.activeElement=input;await clean.page.beforeNavigate();assert.equal(clean.workspace.settings.quantityTargetsByLevel[2].targetHours,'4.50');assert.equal(clean.writes,1);clean.page.dispose();
  const bad=setup();await bad.page.ready;const badInput=bad.input(2,'targetHours');badInput.value='0';bad.doc.activeElement=badInput;await assert.rejects(bad.page.beforeNavigate(),/正数/);assert.equal(bad.writes,0);assert.equal(badInput.attrs['aria-invalid'],'true');assert.equal(bad.get('ranchConfigError').hidden,false);bad.page.dispose();
});
await test('export flush commits inputs without preventing later calculations on the same page',async()=>{
  const state=setup();await state.page.ready;const input=state.input(2,'targetHours');input.value='5';state.doc.activeElement=input;
  await state.page.beforeNavigate({leaving:false});assert.equal(state.workspace.settings.quantityTargetsByLevel[2].targetHours,'5');
  const running=state.page.run('schedule');await flush();assert.equal(state.runs.length,1);state.pending.resolve();await running;state.page.dispose();
});
await test('navigation aborts work and waits until its pending persistence has completed before resolving',async()=>{
  const state=setup({holdAfterAbort:true});await state.page.ready;const running=state.page.run('quantity');await flush();const p=state.workspace.plans[1];p.results.set(p.groups[0].key,{proven:true,optimalMinutes:55});state.pending.options.onChange();let saved=false,navigated=false;
  const leaving=state.page.beforeNavigate().then(()=>{assert(saved,'navigation must wait for saved runner results');navigated=true;});await flush();assert(state.pending.options.signal.aborted);assert.equal(navigated,false);assert.equal(p.results.size,1);assert.equal(state.get('pauseRanchLevels').hidden,false);
  saved=true;state.pending.resolve({stopped:true});await leaving;await running;assert.equal(navigated,true);assert.equal(state.get('ranchConfigProgressText').textContent,'已暂停，已完成结果已保留');state.page.dispose();
});
await test('a failed navigation flush blocks leaving and shows the storage failure',async()=>{
  const state=setup({holdAfterAbort:true});await state.page.ready;const running=state.page.run('schedule');await flush();const leaving=state.page.beforeNavigate();state.pending.reject(Error('结果保存失败'));await assert.rejects(leaving,/结果保存失败/);await running;assert.equal(state.get('ranchConfigError').textContent,'结果保存失败');assert.equal(state.get('ranchConfigProgressText').textContent,'已停止，部分结果未保存');state.page.dispose();
});
await test('pagehide disposal aborts work as a best-effort fallback',async()=>{
  const state=setup();await state.page.ready;const running=state.page.run('schedule');await flush();state.page.dispose();assert(state.pending.options.signal.aborted);await running;assert(state.unwatched);assert(source.includes('window.ranchBeforeNavigate=options=>page.beforeNavigate(options)'));assert(source.includes("window.addEventListener('pagehide',()=>page.dispose()"));
});
await test('empty project and import failures have explicit states and do not start work',async()=>{
  const empty=setup({empty:true});await empty.page.ready;assert.equal(empty.get('ranchConfigEmpty').hidden,false);assert.equal(empty.get('ranchConfigWorkspace').hidden,true);assert.equal(empty.runs.length,0);
  const failed=setup({failLoad:true});await failed.page.ready;assert.equal(failed.get('ranchConfigError').textContent,'导入配方不完整');assert.equal(failed.get('ranchConfigWorkspace').hidden,true);empty.page.dispose();failed.page.dispose();s.page.dispose();assert(s.unwatched);
});
console.log(checks+' ranch config checks passed');
