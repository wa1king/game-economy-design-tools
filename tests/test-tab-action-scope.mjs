import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {setupFuelRules} from '../orders/fuel-rules-view.js';

const source=file=>fs.readFileSync(new URL('../orders/'+file,import.meta.url),'utf8');
function ancestry(html,id){
  const stack=[],voids=new Set(['input','meta','link','br','hr','img','wbr','area','base','col','embed','param','source','track']);
  for(const [,closing,tag,attrs] of html.matchAll(/<(\/?)([a-z][\w:-]*)([^>]*?)>/gi)){
    if(closing){const index=stack.findLastIndex(node=>node.tag===tag);if(index>=0)stack.length=index;continue;}
    const node={tag,id:attrs.match(/(?:^|\s)id="([^"]+)"/)?.[1],className:attrs.match(/(?:^|\s)class="([^"]+)"/)?.[1]??''};
    if(node.id===id)return [...stack,node];if(!voids.has(tag)&&!attrs.endsWith('/'))stack.push(node);
  }
  throw Error('Missing '+id);
}
test('global headers contain import/export; ordinary batch fitting belongs to the all-level content',()=>{
  const html=source('index.html');
  for(const [file,ids] of [['index.html',['importExcel','exportProject']],['ranch.html',['importButton','exportRanchExcel']]]){
    const page=source(file);for(const id of ids)assert(ancestry(page,id).some(n=>n.tag==='header'));
    const header=page.match(/<header\b[\s\S]*?<\/header>/)[0];for(const label of ['燃料规则','订单规则','拟合全部等级','备份 / 恢复'])assert(!header.includes(label));
  }
  const batch=ancestry(html,'solveAll');assert(batch.some(n=>n.id==='overviewPanel'));assert(!batch.some(n=>n.className.includes('workspace-actionbar')));
  assert(ancestry(html,'solve').some(n=>n.id==='levelWorkspace'));
  assert(ancestry(html,'toggleRules').some(n=>n.className.includes('workspace-actionbar')));
  assert(source('session-backup-view.js').includes("document.querySelector('main .workspace-actionbar .workspace-actions').append(button)"));
});
test('all-level action moves only between dashboard/config panels and is hidden on analysis/custom tabs',()=>{
  class Node{
    constructor(id){this.id=id;this.hidden=false;this.children=[];this.classList={toggle(){}};}
    append(node){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(v=>v!==node);this.children.push(node);node.parentNode=this;}
  }
  const ids=['levelWorkspace','overviewPanel','dashboardPanel','customPanel','viewLevels','viewOverview','viewDashboard','viewCustom','dashboardActions','overviewActions','ordinaryBatchActions'];
  const nodes=new Map(ids.map(id=>[id,new Node(id)])),get=id=>nodes.get(id),batch=get('ordinaryBatchActions');get('overviewActions').append(batch);
  const context={$:get,renderDashboard(){},renderCustomOrders(){}};
  const fn=source('project-app.js').match(/function setView\(view\)\{[\s\S]*?\n\}/)[0];vm.runInNewContext(fn,context);
  for(const view of ['dashboard','levels','custom','overview','dashboard']){
    context.setView(view);
    if(['dashboard','overview'].includes(view)){assert.equal(batch.hidden,false);assert.equal(batch.parentNode.id,view==='dashboard'?'dashboardActions':'overviewActions');}
    else assert.equal(batch.hidden,true);
    assert.equal(get('dashboardActions').children.length+get('overviewActions').children.length,1);
  }
});
test('fuel rules never fall back to the global header when a workspace is missing',()=>{
  const previous=globalThis.document;let inserted=false;
  globalThis.document={getElementById:()=>null,querySelector:selector=>{assert.equal(selector,'main');return null;},body:{insertAdjacentHTML(){inserted=true;}}};
  try{setupFuelRules();assert.equal(inserted,false);}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
  const shell=source('ranch-shell.js');assert(shell.indexOf('setupFuelRules();')>shell.indexOf("main.insertAdjacentHTML('afterbegin'"));
});
