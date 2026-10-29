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
    querySelector(selector){if(selector==='.brand')return brand;if(selector==='.order-system-switch')return this.html.includes('order-system-switch')?{}:null;if(selector==='.workspace-actionbar')return this.html.includes('class="workspace-actionbar"')?{}:null;return null;}
    insertAdjacentHTML(position,html){insertions.push({element:this,position,html});if(this===brand)header.html+=html;else if(position==='afterbegin')this.html=html+this.html;else this.html+=html;const navigation=html.match(/<nav id="ranchNavigation"[\s\S]*?<\/nav>/);if(navigation){const nav=new Element('ranchNavigation',navigation[0]);nav.parent=this;elements.set('ranchNavigation',nav);}}
    addEventListener(type,fn){this.listeners.set(type,fn);}
  }
  const header=new Element('ranchShell',existing?'<div class="brand">Existing brand</div>':''),brand=new Element(),message=new Element('message');
  const main=new Element('main',existing?'<section class="workspace-actionbar" aria-label="牧场订单操作"><div class="workspace-actions"><button id="importButton">导入 Excel / 结果</button><button id="exportButton">导出需求组</button></div></section><section id="content">内容</section>':'<section id="content">内容</section>');
  elements.set('ranchShell',header);elements.set('message',message);
  const window={location:{href:'http://example.test/orders/ranch.html',origin:'http://example.test'},addEventListener:(type,fn)=>events.set(type,fn)};
  const document={body:{dataset:{ranchView:view}},getElementById:id=>elements.get(id)??null,querySelector:selector=>selector==='main'?main:null,addEventListener:(type,fn)=>documentEvents.set(type,fn)};
  vm.runInNewContext(source,{document,window,URL,ranchSource:()=>({filename})});
  const nav=elements.get('ranchNavigation');
  const linkFor=(href,attributes='',label='')=>({href,attributes,label,getAttribute:name=>name==='href'?href:null,hasAttribute:name=>attributes.includes(name),target:''});
  const links=[...nav.html.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map(([,href,attributes,label])=>linkFor(href,attributes,label));
  const click=async(index=0,extra={})=>{
    const event={target:{closest:()=>typeof index==='string'?linkFor(index):links[index]},prevented:false,preventDefault(){this.prevented=true;},button:0,...extra};
    const result=documentEvents.get('click')(event);return {event,result};
  };
  return {elements,header,main,nav,links,events,window,click,insertions};
}

test('empty and populated shells keep dedicated actions inside main after the same three workspace tabs',()=>{
  for(const existing of [false,true])for(const [view,label] of [['dashboard','全部等级面板'],['config','全部等级配置'],['analysis','单等级分析']]){
    const h=harness({existing,view});assert.deepEqual(h.links.map(link=>link.label),['全部等级面板','全部等级配置','单等级分析']);assert.deepEqual(h.links.filter(link=>link.attributes.includes('aria-current')).map(link=>link.label),[label]);assert.equal((h.header.html.match(/class="order-system-switch"/g)||[]).length,1);
    assert(!/importButton|exportButton|shell-action|workspace-actionbar|ranchNavigation/.test(h.header.html),'header must contain only brand and shared system navigation');assert.equal(h.nav.parent,h.main);assert.equal((h.main.html.match(/class="workspace-actionbar"/g)||[]).length,1);assert(h.main.html.indexOf('id="ranchNavigation"')<h.main.html.indexOf('class="workspace-actionbar"'));assert(h.main.html.indexOf('class="workspace-actionbar"')<h.main.html.indexOf('id="content"'));
    if(existing){assert(h.main.html.includes('id="importButton"'),'existing analysis actions must survive');assert.equal((h.main.html.match(/id="importButton"/g)||[]).length,1);assert(!h.main.html.includes('href="ranch.html?import=1"'),'do not duplicate the existing action bar with generated links');}
  }
  for(const file of ['index.html','ranch.html']){const html=fs.readFileSync(new URL('../orders/'+file,import.meta.url),'utf8'),header=html.match(/<header\b[\s\S]*?<\/header>/)?.[0]??'',main=html.match(/<main\b[\s\S]*?<\/main>/)?.[0]??'';assert(!/id="(?:importExcel|importButton|exportProject|exportButton|solveAll|toggleRules|readProject)"/.test(header),file+' must not leave dedicated actions in the header');assert(main.includes('class="workspace-actionbar"'));}
});

test('generated content action bar provides the import and rule deep links and displays the current source safely',()=>{
  const h=harness({filename:'<导入项目>'});assert(h.main.html.includes('href="ranch.html?import=1"'));assert(h.main.html.includes('href="ranch.html?settings=1"'));assert.equal(h.elements.get('shellProjectName').textContent,'<导入项目>');
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

test('system switches and content action deep links also flush while external and anchor links stay native',async()=>{
  for(const href of ['./','ranch.html?import=1','ranch.html?settings=1']){const h=harness();let calls=0;h.window.ranchBeforeNavigate=async()=>{calls++;};const {event,result}=await h.click(href);await result;assert(event.prevented);assert.equal(calls,1);assert.equal(h.window.location.href,new URL(href,'http://example.test/orders/ranch.html').href);}
  for(const href of ['https://elsewhere.test/','#section']){const h=harness();let calls=0;h.window.ranchBeforeNavigate=async()=>{calls++;};const {event,result}=await h.click(href);await result;assert.equal(event.prevented,false);assert.equal(calls,0);}
});
