const number=v=>Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:2}):'—';
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Feedback reports observed misses; it does not claim an approximate fit is infeasible.
export function resultFeedback(r,catalog){
  if(!r||r.matched)return [];
  const c=r.config||{},messages=[];
  if(r.quantization?.continuous?.matched)messages.push(`连续拟合已达标，但 ${number(r.probabilityScale)} 分制取整后偏差超限；优先提高概率精度后重新拟合。`);
  if(r.meanError>Math.max(.5,c.mean*.01))messages.push(`平均工时目标 ${number(c.mean)} 分钟，实际 ${number(r.mean)} 分钟，允许误差 ${number(Math.max(.5,c.mean*.01))} 分钟；可调整均值，或放宽同时约束的来源与波动目标。`);
  if(r.sdError>Math.max(2,c.sigma*.05))messages.push(`工时波动目标 ${number(c.sigma/c.mean*100)}%，实际 ${number(r.sd/r.mean*100)}%；标准差偏差 ${number(r.sdError)} 分钟，允许 ${number(Math.max(2,c.sigma*.05))} 分钟。可调整波动目标，或检查均值与来源的同时约束。`);
  if(c.sourceEnabled){
    const misses=(r.shares||[]).map((v,j)=>({name:catalog.sources[j]?.name||`来源${j+1}`,actual:v*100,target:c.shares?.[j],delta:Math.abs(v*100-c.shares?.[j])})).filter(v=>v.delta>1+1e-9).sort((a,b)=>b.delta-a.delta);
    if(misses.length)messages.push(`来源占比超出 1 个百分点容差：${misses.slice(0,3).map(v=>`${v.name}目标 ${number(v.target)}%，实际 ${number(v.actual)}%`).join('；')}。优先检查这些来源权重；这些实际值不是可达边界。`);
  }
  const mixMisses=(r.actualMix||[]).map((p,j)=>({kind:j+1,target:c.mix?.[j],actual:p*100,delta:Math.abs(p-(c.mix?.[j]||0)/100)})).filter(v=>v.delta>(c.probabilityScale?1/c.probabilityScale+1e-9:1e-7));
  if(mixMisses.length)messages.push(`商品种类占比未满足：${mixMisses.map(v=>`${v.kind} 种商品目标 ${number(v.target)}%，实际 ${number(v.actual)}%`).join('；')}。请提高概率精度后重新拟合。`);
  if(r.converged===false){
    const reasons={iteration_limit:'达到迭代上限',linear_system_failure:'数值方程求解失败',non_descent_direction:'未找到有效更新方向',line_search_failure:'更新步长搜索未通过'};
    messages.push(`求解未收敛：${reasons[r.numericalDiagnostics?.termination]||'未达到收敛条件'}。这不等于已证明目标不可行；先检查其他偏差，再重新拟合。`);
  }
  return messages.length?messages:['部分拟合指标尚未达标，请检查单等级页的目标与实际对照。'];
}

export function renderFitProblems(entries){
  if(!entries.length)return '';
  return `<div class="fit-problems-heading"><strong>需要调整 · ${entries.length} 级</strong><span>点击等级定位配置</span></div><div class="fit-problems-list">${entries.map(entry=>`<div class="fit-problem"><button type="button" data-problem-level="${entry.level}">Lv ${entry.level}<small>${escape(entry.state)}</small></button><div>${entry.messages.map(message=>`<p>${escape(message)}</p>`).join('')}</div></div>`).join('')}</div>`;
}
