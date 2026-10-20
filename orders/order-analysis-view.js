import {summarizeOrderOutcomes} from './order-outcomes.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:d}):'—';
const pct=v=>num(v*100,2)+'%';
const empty='<p class="analysis-empty">拟合后显示订单结果</p>';
const metrics=['常见订单工时','平均累计复杂度','含作物订单'];

export function matchesOutcomeFilter(order,filter,products){
  if(!filter)return true;
  if(filter.kind==='complexity')return order.cumulativeComplexity===filter.value;
  if(filter.kind==='product')return order.items.some(item=>item.id===filter.value);
  const cropCount=order.items.filter(item=>{const p=products.get(item.id);return p&&(p.isCrop||p.category==='田地作物'||p.category==='特殊作物');}).length;
  return filter.value==='pure'?cropCount===order.items.length:filter.value==='mixed'?cropCount>0&&cropCount<order.items.length:filter.value==='none'?cropCount===0:cropCount>0;
}

export function createOutcomeAnalysis(onFilter){
  const $=id=>document.getElementById(id);let data=null,type='all',sort='probability',direction='desc';
  function clear(){
    data=null;$('metrics').innerHTML=metrics.map(label=>`<div><small>${label}</small><strong>—</strong></div>`).join('');
    for(const id of ['complexityStats','complexityBars','cropPattern','cropDemandRows','productAppearanceRows'])$(id).innerHTML='';
    $('complexityBars').innerHTML=empty;$('productAppearanceSummary').textContent='';$('cropDemandSummary').textContent='';
  }
  function render(catalog,result,level){
    data=summarizeOrderOutcomes(catalog,result,level);if(data.empty){clear();return;}
    const {time:t,complexity:c}=data.stats;
    const values=[
      [metrics[0],num(t.p50),'分钟',`中位数 · 中间 80%：${num(t.p10,0)}–${num(t.p90,0)} 分钟`],
      [metrics[1],num(c.mean),'',`中位数 ${num(c.p50,0)} · 90% 订单不超过 ${num(c.p90,0)}`],
      [metrics[2],num(data.directCropOrderProbability*100,1),'%',`直接索要作物 · 纯作物 ${pct(data.pureCropOrderProbability)}`]
    ];
    $('metrics').innerHTML=values.map(([name,value,unit,sub])=>`<div><small>${name}</small><strong>${value}<em>${unit}</em></strong><span class="sub">${sub}</span></div>`).join('');
    $('complexityStats').innerHTML=[['平均',c.mean],['中位数',c.p50],['90%不超过',c.p90],['最小',c.min],['最大',c.max]].map(([label,v])=>`<span>${label}<b>${num(v)}</b></span>`).join('');
    const max=Math.max(...data.complexityDistribution.map(v=>v.probability),.001);
    $('complexityBars').innerHTML=data.complexityDistribution.map(v=>`<button type="button" data-complexity="${v.complexity}" title="复杂度 ${v.complexity} · ${pct(v.probability)} · 点击查看订单" aria-label="复杂度 ${v.complexity}，生成概率 ${pct(v.probability)}，查看订单"><span class="complexity-value">${num(v.probability*100,v.probability<.001?2:1)}%</span><i style="height:${Math.max(2,v.probability/max*105)}px"></i><b>${v.complexity}</b></button>`).join('');
    const cropSegments=[['pure','纯作物',data.pureCropOrderProbability],['mixed','作物 + 加工品',data.mixedCropOrderProbability],['none','不直接要作物',data.noCropOrderProbability]];
    $('cropPattern').innerHTML=`<div class="crop-stack" role="group" aria-label="作物订单构成，合计100%">${cropSegments.filter(v=>v[2]>0).map(([key,label,p])=>`<button type="button" class="crop-segment ${key}" style="width:${p*100}%" data-crop="${key}" data-label="${label}" title="${label} ${pct(p)} · 查看订单" aria-label="${label} ${pct(p)}，查看订单"></button>`).join('')}</div><div class="crop-legend">${cropSegments.map(([key,label,p])=>`<button type="button" data-crop="${key}" data-label="${label}"><i class="${key}"></i><span>${label}</span><b>${pct(p)}</b></button>`).join('')}</div>`;
    $('cropDemandSummary').textContent=`含直接交付与加工原料 · ${data.crops.length} 种作物`;
    $('cropDemandRows').innerHTML=[...data.crops].sort((a,b)=>b.totalDemandPer100Orders-a.totalDemandPer100Orders).map(p=>`<tr><th scope="row"><button type="button" class="analysis-product" data-product="${p.id}" data-name="${esc(p.name)}" title="查看直接索取该作物的订单">${esc(p.name)}</button></th><td>${pct(p.directOrderProbability)}</td><td>${pct(p.chainOrderProbability)}</td><td>${num(p.directQuantityPer100Orders)}</td><td>${num(p.processingQuantityPer100Orders)}</td><td><b>${num(p.totalDemandPer100Orders)}</b></td><td>${num(p.productionMinutesPer100Orders,0)}</td></tr>`).join('')||'<tr><td colspan="7" class="analysis-empty">当前等级没有作物</td></tr>';
    const zero=data.products.filter(p=>p.directOrderProbability===0).length;
    $('productAppearanceSummary').textContent=`${data.products.length} 种已解锁 · ${zero} 种未被直接索取`;
    renderProducts();
  }
  function renderProducts(){
    if(!data)return;
    const values=data.products.filter(p=>type==='all'||(type==='crop'?p.isCrop:!p.isCrop));
    const key=sort==='probability'?'directOrderProbability':sort==='quantity'?'directQuantityPer100Orders':sort==='coinValue'?'coinValue':'level';
    values.sort((a,b)=>{if(key==='coinValue'){if(!Number.isFinite(a[key]))return Number.isFinite(b[key])?1:a.id-b.id;if(!Number.isFinite(b[key]))return -1;}return (direction==='desc'?-1:1)*(a[key]-b[key])||a.id-b.id;});
    $('productAppearanceRows').innerHTML=values.map(p=>`<tr><th scope="row"><button type="button" class="analysis-product" data-product="${p.id}" data-name="${esc(p.name)}" title="查看直接索取该商品的订单">${esc(p.name)}</button>${p.level===data.level?'<small class="new-product">本级新解锁</small>':''}</th><td>${esc(p.buildingName||'—')}</td><td>${p.level}</td><td class="appearance-probability" style="--probability:${p.directOrderProbability*100}%">${pct(p.directOrderProbability)}</td><td>${num(p.directQuantityPer100Orders)}</td><td>${num(p.cumulativeComplexity,0)}</td><td>${num(p.unitCumulativeMinutes)}</td><td title="${esc([p.coinValueStatus,p.coinValueSource].filter(Boolean).join(' · '))}">${num(p.coinValue,4)}${Number.isFinite(p.coinValue)&&p.coinValueStatus?.includes('估算')?' <small class="coin-estimate">估</small>':''}</td></tr>`).join('')||'<tr><td colspan="8" class="analysis-empty">没有对应商品</td></tr>';
  }
  $('productTypeFilter').onchange=e=>{type=e.target.value;renderProducts();};
  $('productAppearanceSort').onchange=e=>{sort=e.target.value;renderProducts();};
  $('productAppearanceDirection').onchange=e=>{direction=e.target.value;renderProducts();};
  $('levelWorkspace').addEventListener('click',event=>{
    const complexity=event.target.closest('[data-complexity]'),crop=event.target.closest('[data-crop]'),product=event.target.closest('[data-product]');
    if(complexity)onFilter({kind:'complexity',value:Number(complexity.dataset.complexity),label:`累计复杂度 ${complexity.dataset.complexity}`});
    else if(crop)onFilter({kind:'crop',value:crop.dataset.crop,label:crop.dataset.label});
    else if(product)onFilter({kind:'product',value:Number(product.dataset.product),label:`直接索取：${product.dataset.name}`});
  });
  return {render,clear,getSummary:()=>data};
}
