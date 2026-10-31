import {eligibleOrder} from './probability-floor.js';
import {renderOrderItems} from './item-info.js';

export function createOrderSampler(catalog,result,random=Math.random){
  if(result.blocked||result.probabilities?.length!==catalog.orders.length)throw Error('当前等级没有有效拟合结果。');
  const entries=[];let total=0;
  catalog.orders.forEach((order,i)=>{
    const probability=result.probabilities[i];
    if(!Number.isFinite(probability)||probability<0)throw Error('拟合概率无效。');
    if(!probability)return;
    if(!eligibleOrder(order,result.config))throw Error('拟合结果包含当前等级不可生成的订单。');
    total+=probability;entries.push({order,probability,upper:total});
  });
  if(!entries.length||Math.abs(total-1)>1e-7)throw Error('拟合概率合计不为 100%，请重新拟合。');
  return ()=>{
    const u=random();if(!Number.isFinite(u)||u<0||u>=1)throw Error('随机数必须在 [0,1) 范围内。');
    const target=u*total;let lo=0,hi=entries.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(target<entries[mid].upper)hi=mid;else lo=mid+1;}
    return entries[lo];
  };
}

export function createOrderSimulator(api){
  const $=id=>document.getElementById(id),dialog=$('orderSimulatorDialog');
  let sampler,activeResult,activeCatalog,draws=0,board=[];
  const fmt=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:0});
  const ready=()=>{const s=api.getState();return s.valid&&s.result&&!s.result.blocked;};
  function render(){
    const s=api.getState();
    $('simulationMeta').textContent=`Lv ${s.level} · ${s.result?.probabilityScale?fmt(s.result.probabilityScale)+' 分制':'连续概率'} · 已抽取 ${draws} 单`;
    const digits=s.result?.probabilityScale?Math.max(2,Math.log10(s.result.probabilityScale)-2):5;
    const products=new Map(s.catalog.products.map(p=>[p.id,p]));
    $('simulationOrders').innerHTML=board.map(({order,probability},i)=>`<article class="simulation-order"><div class="simulation-card-heading"><span>订单 ${String(i+1).padStart(2,'0')}</span><span class="simulation-kind">${order.itemTypes} 种商品</span></div><div class="simulation-items">${renderOrderItems(order,products)}</div><div class="simulation-card-metrics"><span>累计工时 <b>${fmt(order.cumulativeMinutes)}</b> 分</span><span>复杂度 <b>${order.cumulativeComplexity}</b></span></div><div class="simulation-card-footer"><span title="本订单在当前拟合结果中的生成概率">概率 ${(probability*100).toFixed(digits)}%</span><button type="button" class="simulation-replace" data-replace-order="${i}" aria-label="刷新第 ${i+1} 个订单">↻ 换一单</button></div></article>`).join('');
  }
  function ensureSampler(){
    const s=api.getState();
    if(!ready())return false;
    if(activeResult!==s.result||activeCatalog!==s.catalog){sampler=createOrderSampler(s.catalog,s.result);activeResult=s.result;activeCatalog=s.catalog;draws=0;board=[];}
    return true;
  }
  function refresh(){
    if(!ensureSampler())return;
    api.hideItemInfo();board=Array.from({length:Number($('simulationCount').value)},()=>sampler());draws+=board.length;render();
  }
  $('openOrderSimulator').onclick=()=>{if(!ensureSampler())return;refresh();dialog.showModal();};
  $('refreshSimulation').onclick=refresh;$('simulationCount').onchange=refresh;
  $('simulationOrders').addEventListener('click',event=>{
    const button=event.target.closest('[data-replace-order]');if(!button||!ensureSampler())return;
    const index=Number(button.dataset.replaceOrder);api.hideItemInfo();board[index]=sampler();draws++;render();
    $('simulationOrders').querySelector(`[data-replace-order="${index}"]`)?.focus();
  });
  $('closeOrderSimulator').onclick=()=>dialog.close();dialog.addEventListener('close',()=>api.hideItemInfo());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  return {sync(){
    $('openOrderSimulator').disabled=!ready();$('openOrderSimulator').title=ready()?'按当前拟合概率独立抽样':'请先拟合当前等级，参数修改后需重新拟合';
    if(!ready()&&dialog.open)dialog.close();
  }};
}
