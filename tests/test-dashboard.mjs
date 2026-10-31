import assert from 'node:assert/strict';
import {dashboardRows,createLevelDashboard} from '../orders/level-dashboard.js';
import {buildCatalog,levelInfo} from '../orders/order-engine.js';
const configs=Array.from({length:5},()=>({revision:2,weights:{farm:3,mill:1}}));
const saved=new Map([[1,{revision:2,result:{matched:true}}],[2,{revision:2,result:{matched:false}}],[3,{revision:1,result:{matched:true}}],[4,{revision:2,result:{matched:true}}]]);
const api={getCatalog:()=>({maxLevel:5,sources:[{id:'farm'},{id:'mill'}]}),getConfig:l=>configs[l-1],getInfo:()=>({active:[true,true]}),getResult:l=>saved.get(l),getError:l=>l===4?'infeasible':null};
const before=JSON.stringify(configs),rows=dashboardRows(api);
assert.deepEqual(rows.map(r=>r.state),['matched','approximate','stale','blocked','empty']);
assert.equal(rows.filter(r=>r.r).length,2,'Only fresh, error-free results enter charts');
assert.deepEqual(rows[0].targets,[75,25]);
assert.equal(JSON.stringify(configs),before,'Normalized display must preserve raw inputs');
api.getIssue=l=>l===1?{message:'invalid target'}:null;
assert.equal(dashboardRows(api)[0].r,null,'Invalid targets must not display current results');
console.log('Dashboard: fresh/stale/blocked/missing states and raw source weights verified.');

const catalog=buildCatalog({maxLevel:2,sources:[{id:'farm',name:'农田'},{id:'mill',name:'磨坊'}],products:[
  {id:1,name:'麦',level:1,buildingId:'farm',category:'田地作物',stepMinutes:2,analysisBatchYield:1,coinValue:2.13,inputs:[]},
  {id:2,name:'粉',level:1,buildingId:'mill',stepMinutes:5,analysisBatchYield:1,coinValue:10.3,inputs:[{id:1,quantity:2}]}
]},{cropQuantity:7});
const target={revision:0,mean:10000,variance:100,mix:[2,0,0],weights:{farm:3,mill:1},sourceEnabled:false};
const fitted={matched:true,config:{level:1},probabilities:[.25,.75],mean:10.25,sd:2,actualMix:[1,0,0],shares:[.6,.4],tv:.04};
let current=fitted,busy=false,opened=null;
const renderApi={getCatalog:()=>catalog,getConfig:()=>target,getInfo:l=>levelInfo(catalog,l),getResult:l=>l===1&&current?{revision:0,result:current}:null,getError:()=>null,isBusy:()=>busy,onOpen:l=>{opened=l;}};
const sourceSelect={};
const handlers={};
const root={innerHTML:'',addEventListener(type,handler){handlers[type]=handler;},querySelector(){return sourceSelect;}};
const previousDocument=globalThis.document;
try{
  globalThis.document={getElementById:()=>root};
  const dashboard=createLevelDashboard(renderApi),snapshot=JSON.stringify({catalog,target,fitted});
  dashboard.render();
  assert(root.innerHTML.includes('订单体验趋势'));
  assert(root.innerHTML.includes('dash-custom-table'));
  renderApi.getSelection=()=>({levels:{1:['S1-1']}});dashboard.render();
  const comparison=root.innerHTML.match(/<table class="dash-custom-table">[\s\S]*?<tbody><tr>([\s\S]*?)<\/tr>/)[1];
  assert(comparison.includes('data-product-id="1"'));assert(comparison.includes('dash-custom-mean">14</td>'));assert(comparison.includes('dash-normal-mean" title="剔除本级定制订单后，按剩余生成概率重新加权">9</td>'));assert(comparison.includes('dash-custom-delta">+5</td>'));
  delete renderApi.getSelection;dashboard.render();
  assert(root.innerHTML.includes('Lv 1 · 中位数 9 分钟'),'Time trends must use weighted outcome quantiles, not the input mean');
  assert(!root.innerHTML.includes('P90')&&!root.innerHTML.includes('90%上限'),'Outcome trends no longer display P90');
  assert(root.innerHTML.includes('Lv 1 · 平均数 10 分钟'),'Mean must use final generated probabilities, not the target of 10000');
  assert(root.innerHTML.includes('Lv 1 · 平均数 1.75'));
  assert(root.innerHTML.includes('Lv 1 · 中位数 2'),'Complexity trend retains the weighted median');
  assert(root.innerHTML.includes('Lv 1 · 含作物订单概率 25%'));
  assert(root.innerHTML.includes('Lv 1 · 平均金币奖励 57 金币/单'),'Reward trend uses final probability weights and the existing payout formula');
  assert(root.innerHTML.includes('拟合校验'),'Target acceptance stays available below outcome trends');
  const validationRow=root.innerHTML.match(/<table class="dash-results">[\s\S]*?<tbody><tr>([\s\S]*?)<\/tr>/)[1];
  const validationCells=[...validationRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match=>match[1]);
  assert.equal(validationCells[5],'0','Dashboard mix deviation must compare actual probabilities with normalized weights, not raw editor numbers');
  assert.equal(JSON.stringify({catalog,target,fitted}),snapshot,'Viewing trends must not rewrite project data');
  let prevented=false;
  const keyboard={key:'Enter',target:{closest:selector=>selector==='circle[data-open]'?{dataset:{open:'1'}}:null},preventDefault(){prevented=true;}};
  handlers.keydown(keyboard);
  assert.equal(opened,1,'Keyboard activation of a trend point opens its level');
  assert(prevented,'Keyboard activation must prevent the default page action');
  busy=true;opened=null;handlers.keydown(keyboard);
  assert.equal(opened,null,'Trend navigation is disabled while fitting');
  busy=false;
  current=null;dashboard.render();
  assert.equal((root.innerHTML.match(/拟合后显示趋势/g)||[]).length,3,'Empty levels must display three safe empty charts');
}finally{
  if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
}
console.log('Dashboard: weighted outcome trends, crop appearance, empty results and non-mutating render verified.');
