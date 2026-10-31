import {resultFeedback,renderFitProblems} from './fit-feedback.js';
import {normalizedSourceWeights} from './order-engine.js';
import {normalizedMixWeights} from './mix-weights.js';
import {spreadPercent,actualSpread} from './time-spread.js';
import {summarizeOrderOutcomes} from './order-outcomes.js';
import {customOrderTimeComparison} from './custom-order-comparison.js';
import {renderOrderItems} from './item-info.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:d}):'—';
const states={matched:'目标达标',approximate:'近似解',blocked:'需调整',stale:'待更新',empty:'未计算'};

export function dashboardRows(api){
  const catalog=api.getCatalog();
  return Array.from({length:catalog.maxLevel},(_,i)=>{
    const level=i+1,c=api.getConfig(level),info=api.getInfo(level),saved=api.getResult(level),error=api.getError(level)||api.getIssue?.(level)?.message;
    const fresh=!!saved&&saved.revision===(c.revision||0),r=fresh&&!error?saved.result:null;
    const state=error?'blocked':r?(r.matched?'matched':'approximate'):saved?'stale':'empty';
    const targets=normalizedSourceWeights(catalog.sources.map(s=>Number(c.weights[s.id]??1)),info.active);
    return {level,c,info,r,error,state,targets};
  });
}

function trend(rows,series,label,fixedMax=null,{width=600,height=220,ticks=4,emptyText='拟合后显示趋势'}={}){
  const W=Math.max(260,Math.round(width),rows.length*26+68),H=height,p={l:52,r:16,t:28,b:42},w=W-p.l-p.r,h=H-p.t-p.b;
  const axisDigits=series.some(s=>/分钟|金币/.test(s.unit||''))?0:2;
  const values=rows.flatMap(row=>series.map(s=>s.get(row))).filter(Number.isFinite);
  const rawStep=Math.max(1,...values)*1.08/ticks,magnitude=10**Math.floor(Math.log10(rawStep));
  const step=[1,2,2.5,5,10].find(v=>v*magnitude>=rawStep)*magnitude,max=fixedMax??step*ticks;
  const x=i=>p.l+i*w/Math.max(1,rows.length-1),y=v=>p.t+h-v/max*h;
  let svg=`<svg viewBox="0 0 ${W} ${H}" style="min-width:${W}px" role="group" aria-label="${esc(label)}"><title>${esc(label)}</title>`;
  if(!values.length)return svg+`<text x="${W/2}" y="${H/2}" text-anchor="middle">${esc(emptyText)}</text></svg>`;
  for(let j=0;j<=ticks;j++)svg+=`<line x1="${p.l}" y1="${y(max*j/ticks)}" x2="${W-p.r}" y2="${y(max*j/ticks)}" stroke="#e5ebe6"/><text x="${p.l-8}" y="${y(max*j/ticks)+4}" text-anchor="end">${num(max*j/ticks,axisDigits)}</text>`;
  const pointLabels=[];
  const draw=({get,color,dashed,name,unit=''})=>{
    let path='';rows.forEach((row,i)=>{const v=get(row);path+=Number.isFinite(v)?`${i&&Number.isFinite(get(rows[i-1]))?'L':'M'}${x(i)},${y(v)} `:'';});
    svg+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" ${dashed?'stroke-dasharray="5 4"':''}/>`;
    rows.forEach((row,i)=>{const v=get(row);if(Number.isFinite(v)){
      const title=`Lv ${row.level} · ${name} ${num(v,axisDigits)}${unit} · 查看单级`;
      svg+=`<circle data-open="${row.level}" role="button" tabindex="0" aria-label="${esc(title)}" cx="${x(i)}" cy="${y(v)}" r="4" fill="${color}"><title>${esc(title)}</title></circle>`;
      pointLabels.push({i,x:x(i),y:y(v),text:num(v,axisDigits)+(unit==='%'?'%':''),color,side:series.length>1&&!dashed?1:-1});
    }});
  };
  series.forEach(draw);
  // Keep every value visible. Prefer opposite sides for the two series, stagger
  // neighbours, and move labels into free lanes without covering other markers.
  const placed=[],overlaps=(a,b)=>a.left<b.right+3&&a.right>b.left-3&&a.top<b.bottom+3&&a.bottom>b.top-3;
  pointLabels.sort((a,b)=>a.i-b.i).forEach(point=>{
    const textWidth=[...point.text].reduce((n,c)=>n+(c===','||c==='.'?3:6),0),anchor=point.i===0?'start':point.i===rows.length-1?'end':'middle';
    const left=point.x-(anchor==='end'?textWidth:anchor==='middle'?textWidth/2:0),right=left+textWidth;
    const offsets=[point.side*(13+point.i%2*14),point.side*(27+point.i%2*14),-point.side*13,-point.side*27,...Array.from({length:8},(_,i)=>[point.side*(41+i*14),-point.side*(41+i*14)]).flat()];
    let chosen;
    for(const offset of offsets){
      const baseline=Math.max(12,Math.min(H-25,point.y+offset)),box={left,right,top:baseline-10,bottom:baseline+2};
      if(placed.some(other=>overlaps(box,other))||pointLabels.some(other=>overlaps(box,{left:other.x-4,right:other.x+4,top:other.y-4,bottom:other.y+4})))continue;
      chosen={baseline,...box};break;
    }
    chosen??={baseline:Math.max(12,Math.min(H-25,point.y+offsets[0])),left,right,top:point.y+offsets[0]-10,bottom:point.y+offsets[0]+2};
    placed.push(chosen);
    svg+=`<text class="dash-point-value" x="${point.x}" y="${chosen.baseline}" text-anchor="${anchor}" style="--point-color:${point.color}" aria-hidden="true">${esc(point.text)}</text>`;
  });
  const labelEvery=Math.max(1,Math.ceil((rows.length-1)/Math.max(1,Math.floor(w/34))));
  rows.forEach((row,i)=>{if(i===0||i===rows.length-1||(i%labelEvery===0&&rows.length-1-i>=labelEvery))svg+=`<text x="${x(i)}" y="${H-7}" text-anchor="middle">${row.level}</text>`;});
  return svg+'</svg>';
}

export function createLevelDashboard(api){
  const root=document.getElementById('dashboardContent');let sourceMode='actual',renderedWidth=0;
  function render(){
    const width=root.clientWidth||1200;renderedWidth=root.clientWidth||0;
    const columns=typeof window!=='undefined'&&window.innerWidth<1100?1:2;
    const chartSize={width:(width-(columns-1)*14)/columns-34};
    const rows=dashboardRows(api),catalog=api.getCatalog(),fresh=rows.filter(row=>row.r),counts=Object.fromEntries(Object.keys(states).map(s=>[s,rows.filter(row=>row.state===s).length]));
    const products=new Map(catalog.products.map(p=>[p.id,p])),byId=new Map(catalog.orders.map(o=>[o.id,o])),selection=api.getSelection?.();
    for(const row of rows){row.outcome=row.r?summarizeOrderOutcomes(catalog,row.r,row.level):null;row.customComparison=customOrderTimeComparison(catalog,selection,row.level,row.r,byId);}
    const problems=rows.flatMap(row=>row.error?[{level:row.level,state:'无法拟合',messages:[row.error]}]:row.r&&!row.r.matched?[{level:row.level,state:'近似解',messages:resultFeedback(row.r,catalog)}]:[]);
    const dualLegend=()=>'<div class="dash-legend"><span class="dash-average" title="按订单实际生成概率加权">平均数</span><span class="dash-result" title="按订单实际生成概率计算的50%分位数">中位数</span></div>';
    const series=(name,get,unit='')=>({name,get,unit,color:'#27775c'});
    root.innerHTML=`<section class="dash-overview" aria-label="等级状态总览"><div class="dash-overview-heading"><h2>全部等级面板</h2><span class="hint">${rows.length} 级 · 有效结果 ${fresh.length} 级</span></div>
      <div class="dash-status-summary">${Object.entries(states).map(([key,label])=>`<span class="dash-status-count ${key}${counts[key]?'':' is-zero'}"><i aria-hidden="true"></i><span>${label}</span><b>${counts[key]}</b></span>`).join('')}</div>
      <nav class="dash-levels" aria-label="按等级查看结果">${rows.map(row=>`<button class="dash-level ${row.state}" data-open="${row.level}" aria-label="Lv ${row.level} · ${states[row.state]} · 查看单级" title="Lv ${row.level} · ${esc(row.error||states[row.state])}" ${api.isBusy?.()?'disabled':''}><b>${row.level}</b></button>`).join('')}</nav></section>
      <section class="fit-problems" ${problems.length?'':'hidden'}>${renderFitProblems(problems)}</section>
      <article class="panel dash-custom-comparison"><div class="panel-heading"><h3>定制订单 · 累计工时对照 <small>分钟</small></h3><span class="hint">定制等权 · 非定制按生成概率加权</span></div><div class="dash-scroll"><table class="dash-custom-table"><thead><tr><th>等级</th><th>定制订单内容</th><th>定制平均</th><th>非定制平均</th><th>差值 · 定制 − 非定制</th><th></th></tr></thead><tbody>${rows.map(row=>{
        const v=row.customComparison,delta=v.delta==null?null:Math.round(v.customMean)-Math.round(v.normalMean);
        return `<tr><th>Lv ${row.level}</th><td class="dash-custom-orders">${v.entries.length?v.entries.map(entry=>entry.order?`<div class="dash-custom-order"><span class="dash-custom-sequence">${entry.sequence}</span><span>${renderOrderItems(entry.order,products,{newAtLevel:row.level})}</span><small>${num(entry.order.cumulativeMinutes,0)} 分</small></div>`:`<div class="dash-custom-unavailable">${esc(entry.id)} · 当前规则下不可用</div>`).join(''):'<span class="hint">未配置</span>'}</td><td class="dash-custom-mean">${v.invalid?'含不可用订单':num(v.customMean,0)}</td><td class="dash-normal-mean" title="剔除本级定制订单后，按剩余生成概率重新加权">${row.r?v.normalMean==null?'无非定制概率':num(v.normalMean,0):row.state==='stale'?'结果待更新':'待拟合'}</td><td class="dash-custom-delta">${delta==null?'—':(delta>0?'+':'')+num(delta,0)}</td><td><button class="text-button" data-custom-level="${row.level}">挑选订单 →</button></td></tr>`;
      }).join('')}</tbody></table></div></article>
      <section class="dash-charts" aria-label="订单体验趋势"><article class="panel dash-trend"><div class="panel-heading"><h3>累计工时 <small>分钟</small></h3>${dualLegend()}</div>${trend(rows,[{...series('平均数',row=>row.outcome?.stats.time.mean,' 分钟'),color:'#477ea5'},series('中位数',row=>row.outcome?.stats.time.p50,' 分钟')],'各等级累计工时：平均数与中位数',null,chartSize)}</article>
      <article class="panel dash-trend"><div class="panel-heading"><h3>累计复杂度</h3>${dualLegend()}</div>${trend(rows,[{...series('平均数',row=>row.outcome?.stats.complexity.mean),color:'#477ea5'},series('中位数',row=>row.outcome?.stats.complexity.p50)],'各等级累计复杂度：平均数与中位数',null,chartSize)}</article>
      <article class="panel dash-reward"><div class="panel-heading"><h3>平均金币奖励 <small>金币/单</small></h3><span class="hint">概率加权 · 物品价值 × 5</span></div>${trend(rows,[series('平均金币奖励',row=>row.outcome?.stats.coinReward.mean,' 金币/单')],'各等级订单平均金币奖励',null,{...chartSize,height:150,ticks:3,emptyText:'导入金币单价并拟合后显示'})}</article>
      <article class="panel dash-crop"><div class="panel-heading"><h3>含作物订单概率 <small>%</small></h3><span class="hint">订单直接索取</span></div>${trend(rows,[series('含作物订单概率',row=>row.outcome?row.outcome.directCropOrderProbability*100:null,'%')],'各等级直接索取作物的订单概率',100,{...chartSize,height:150,ticks:2})}</article></section>
      <article class="panel dash-sources"><div class="panel-heading"><h3>来源工时占比</h3><select aria-label="总面板来源显示" id="dashboardSourceMode"><option value="actual" ${sourceMode==='actual'?'selected':''}>实际占比 %</option><option value="delta" ${sourceMode==='delta'?'selected':''}>目标偏差 · 百分点</option></select></div><div class="dash-scroll dash-source-scroll"><table class="dash-heatmap"><thead><tr><th>来源 / 等级</th>${rows.map(row=>`<th>${row.level}</th>`).join('')}</tr></thead><tbody>${catalog.sources.map((source,j)=>`<tr><th>${esc(source.name)}</th>${rows.map(row=>{
        const active=!!row.r&&row.info.active[j],show=active&&(sourceMode==='actual'||row.c.sourceEnabled),v=show?(sourceMode==='actual'?row.r.shares[j]*100:row.r.shares[j]*100-row.targets[j]):null;
        const title=active?`Lv ${row.level} · ${source.name} · 实际 ${num(row.r.shares[j]*100)}% · ${row.c.sourceEnabled?'目标 '+num(row.targets[j])+'%':'未约束'}`:`Lv ${row.level} · ${states[row.state]}${row.r?' / 来源未启用':''}`;
        const color=show?(sourceMode==='actual'?`rgba(39,119,92,${.05+Math.min(1,v/100)*.65})`:`rgba(${Math.abs(v)>1?'194,115,66':'39,119,92'},${.08+Math.min(1,Math.abs(v)/10)*.6})`):'';
        return `<td title="${esc(title)}" style="background:${color}">${show?num(v):'—'}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div></article>
      <article class="panel dash-validation"><div class="panel-heading"><h3>拟合校验</h3><span class="hint">目标 / 实际</span></div><div class="dash-scroll"><table class="dash-results"><thead><tr><th>等级</th><th>状态</th><th>候选订单</th><th>非零订单</th><th>均值 · 分钟</th><th>工时波动 %</th><th>种类最大偏差<br>百分点</th><th>来源最大偏差<br>百分点</th><th title="按最终生成概率加权；订单奖励=交付物品金币总值×5">平均金币奖励</th><th>工时形态</th><th></th></tr></thead><tbody>${rows.map(row=>{
        const r=row.r,mixTargets=normalizedMixWeights(row.c.mix,row.info.counts),mixError=r?Math.max(...r.actualMix.map((v,j)=>Math.abs(v*100-mixTargets[j]))):null,sourceError=r&&row.c.sourceEnabled?Math.max(...r.shares.map((v,j)=>row.info.active[j]?Math.abs(v*100-row.targets[j]):0)):null;
        return `<tr><th>Lv ${row.level}</th><td><span class="dash-status ${row.state}" title="${esc(row.error||'')}">${states[row.state]}</span></td><td>${num(row.info.orders.length)}</td><td>${r?num(r.quantization?.nonZeroOrders??r.probabilities.filter(v=>v>0).length):'—'}</td><td>${num(row.c.mean,0)} / <b>${r?num(r.mean,0):'—'}</b></td><td>${num(spreadPercent(row.c))} / <b>${r?num(actualSpread(r)):'—'}</b></td><td>${num(mixError)}</td><td>${r&&!row.c.sourceEnabled?'未约束':num(sourceError)}</td><td title="${row.outcome?.coinRewardCoverage.missingOrderCount?'有 '+row.outcome.coinRewardCoverage.missingOrderCount+' 张可生成订单缺少金币单价':'按最终生成概率加权 · 物品金币总值×5'}">${row.outcome?.coinRewardCoverage.missingOrderCount?'缺少单价':num(row.outcome?.stats.coinReward.mean,0)}</td><td>${esc(r?.shapeAssessment?.label||'—')}</td><td><button class="text-button" data-open="${row.level}">查看单级</button></td></tr>`;
      }).join('')}</tbody></table></div></article>`;
    root.querySelector('#dashboardSourceMode').onchange=e=>{sourceMode=e.target.value;render();};
  }
  root.addEventListener('click',event=>{const open=event.target.closest('[data-open]');if(open&&!api.isBusy())api.onOpen(Number(open.dataset.open));const problem=event.target.closest('[data-problem-level]');if(problem&&!api.isBusy())api.onAdjust?.(Number(problem.dataset.problemLevel));const custom=event.target.closest('[data-custom-level]');if(custom&&!api.isBusy())api.onCustom?.(Number(custom.dataset.customLevel));});
  root.addEventListener('keydown',event=>{
    if(!['Enter',' '].includes(event.key))return;
    const point=event.target.closest('circle[data-open]');
    if(point&&!api.isBusy()){event.preventDefault();api.onOpen(Number(point.dataset.open));}
  });
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{
    if(root.clientWidth>0&&Math.abs(root.clientWidth-renderedWidth)>1)render();
  }).observe(root);
  return {render};
}
