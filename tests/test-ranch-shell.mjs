import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Isolated DOM simulation; never reads a real browser or user project storage.
const source=fs.readFileSync(new URL('../orders/ranch-shell.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');

function harness({existing=false,view='dashboard',filename='测试项目.xlsx'}={}){
  const elements=new Map(),events=new Map(),documentEvents=new Map(),insertions=[];
  class Element{
    constructor(id='',html=''){this.id=id;this.html=html;this.children=html?[{}]:[];this.listeners=new Map();this.hidden=true;this.textContent='';this.title='';}
    set innerHTML(html){this.html=html;this.children=html?[{}]:[];if(html.includes('id="shellProjectName"'))elements.set('shellProjectName',new Element('shellProjectName'));}
    get innerHTML(){return this.html;}
    querySelector(selector){if(selector==='.brand')return brand;if(selector==='.order-system-switch')return this.html.includes('order-system-switch')?{}:null;return null;}
    insertAdjacentHTML(position,html){insertions.push({position,html});if(this===brand)header.html+=html;if(html.includes('id="ranchNavigation"'))elements.set('ranchNavigation',new Element('ranchNavigation',html));}
    addEventListener(type,fn){this.listeners.set(type,fn);}
  }
  const header=new Element('ranchShell',existing?'<div class="brand">Existing brand</div><button id="importButton">导入 Excel</button>':''),brand=new Element(),message=new Element('message');
  elements.set('ranchShell',header);elements.set('message',message);
  const window={location:{href:'http://example.test/orders/ranch.html',origin:'http://example.test'},addEventListener:(type,fn)=>events.set(type,fn)};
  const document={body:{dataset:{ranchView:view}},getElementById:id=>elements.get(id)??null,addEventListener:(type,fn)=>documentEvents.set(type,fn)};
  vm.runInNewContext(source,{document,window,URL,ranchSource:()=>({filename})});
  const nav=elements.get('ranchNavigation');
  const linkFor=(href,attributes='',label='')=>({href,attributes,label,getAttribute:name=>name==='href'?href:null,hasAttribute:name=>attributes.includes(name),target:''});
  const links=[...nav.html.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map(([,href,attributes,label])=>linkFor(href,attributes,label));
  const click=async(index=0,extra={})=>{
    const event={target:{closest:()=>typeof index==='string'?linkFor(index):links[index]},prevented:false,preventDefault(){this.prevented=true;},button:0,...extra};
    const result=documentEvents.get('click')(event);return {event,result};
  };
  return {elements,header,nav,links,events,window,click,insertions};
}

test('empty and populated headers share the same three tabs and exactly one active view',()=>{
  for(const existing of [false,true])for(const [view,label] of [['dashboard','全部等级面板'],['config','全部等级配置'],['analysis','单等级分析']]){
    const h=harness({existing,view});assert.deepEqual(h.links.map(link=>link.label),['全部等级面板','全部等级配置','单等级分析']);assert.deepEqual(h.links.filter(link=>link.attributes.includes('aria-current')).map(link=>link.label),[label]);assert.equal((h.header.html.match(/class="order-system-switch"/g)||[]).length,1);
    if(existing)assert(h.header.html.includes('id="importButton"'),'the existing import action must survive');
  }
});

test('generated header provides the import and rule deep links and displays the current source safely',()=>{
  const h=harness({filename:'<导入项目>'});assert(h.header.html.includes('href="ranch.html?import=1"'));assert(h.header.html.includes('href="ranch.html?settings=1"'));assert.equal(h.elements.get('shellProjectName').textContent,'<导入项目>');
  h.events.get('ranch:source')({detail:{filename:'更新后的项目.xlsx'}});assert.equal(h.elements.get('shellProjectName').textContent,'更新后的项目.xlsx');
});

test('workspace navigation waits for pending edits and cache writes before changing location',async()=>{
  const h=harness({existing:true,view:'analysis'});let release,calls=0;h.window.ranchBeforeNavigate=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const {event,result}=await h.click(1);assert.equal(event.prevented,true);assert.equal(calls,1);assert.equal(h.window.location.href,'http://example.test/orders/ranch.html');release();await result;assert.equal(h.window.location.href,'http://example.test/orders/ranch-config.html');
});

test('failed navigation flush retains the current view and surfaces the failure',async()=>{
  const h=harness();h.window.ranchBeforeNavigate=async()=>{throw Error('保存失败');};const {event,result}=await h.click();await result;assert(event.prevented);assert.equal(h.window.location.href,'http://example.test/orders/ranch.html');assert.equal(h.elements.get('message').hidden,false);assert.equal(h.elements.get('message').textContent,'保存失败');
});

test('modified navigation clicks keep their native open-in-new-tab behavior',async()=>{
  for(const modifier of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{button:1}]){const h=harness();let calls=0;h.window.ranchBeforeNavigate=async()=>{calls++;};const {event,result}=await h.click(1,modifier);await result;assert.equal(event.prevented,false);assert.equal(calls,0);}
});

test('system switches and header deep links also flush while external and anchor links stay native',async()=>{
  for(const href of ['./','ranch.html?import=1','ranch.html?settings=1']){const h=harness();let calls=0;h.window.ranchBeforeNavigate=async()=>{calls++;};const {event,result}=await h.click(href);await result;assert(event.prevented);assert.equal(calls,1);assert.equal(h.window.location.href,new URL(href,'http://example.test/orders/ranch.html').href);}
  for(const href of ['https://elsewhere.test/','#section']){const h=harness();let calls=0;h.window.ranchBeforeNavigate=async()=>{calls++;};const {event,result}=await h.click(href);await result;assert.equal(event.prevented,false);assert.equal(calls,0);}
});
