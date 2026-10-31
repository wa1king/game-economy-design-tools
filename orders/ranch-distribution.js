import {DEFAULT_CROP_QUANTITY} from './order-quantity-rules.js';
import {prepareRanch,ranchCapacities,groupMetrics} from './ranch-engine.js';
import {generateRanchLevelGroups,remapRanchResult} from './ranch-catalog.js';
import {quantityGroup,hasEqualProductQuantities,orderWorkBalance} from './ranch-quantity.js';
import {ranchImportCacheKey} from './ranch-import.js';

export const ranchTypes=[{id:'building',name:'同建筑',color:'#28795f'},{id:'chain',name:'高级加工链',color:'#a8773b'}];
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const formatMinutes=v=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:1});

export function reuseRanchDistributionResult(donor,target){
  return JSON.stringify(donor.group.slots)===JSON.stringify(target.slots)?donor.result:remapRanchResult(donor.result,donor.group,target);
}

export function summarizeMinutes(values){
  if(values.some(v=>!Number.isFinite(v)||v<0))throw Error('时间统计包含无效数值。');
  const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;
  if(!n)return {n:0,min:null,q1:null,median:null,mean:null,q3:null,max:null};
  const quantile=p=>{const x=(n-1)*p,i=Math.floor(x);return sorted[i]+(sorted[Math.ceil(x)]-sorted[i])*(x-i);};
  return {n,min:sorted[0],q1:quantile(.25),median:quantile(.5),mean:sorted.reduce((a,b)=>a+b,0)/n,q3:quantile(.75),max:sorted[n-1]};
}

// Uses the same source/rule/capacity keys as the scheme page, without mutating
// either its settings or ordinary-order storage. Saved per-group quantities win.
export function buildRanchDistributionPlans(base,settings={}){
  const model=prepareRanch(base,settings),rules={cropQuantity:Number(settings.cropQuantity??DEFAULT_CROP_QUANTITY),productQuantity:Number(settings.productQuantity??1),allowRepeated:settings.allowRepeated??false};
  if(!Number.isSafeInteger(base.maxLevel)||base.maxLevel<1||base.maxLevel>200)throw Error('最高等级需为1至200。');
  return Array.from({length:base.maxLevel},(_,i)=>{
    const level=i+1,capacities={...ranchCapacities(model,level),...(settings.capacities?.[level]??{})},edits=settings.quantityEdits?.[level]??{};
    const {groups}=generateRanchLevelGroups(model,level,rules);
    const actual=groups.map(g=>Object.hasOwn(edits,g.id)?quantityGroup(g,edits[g.id]):g);
    const missing=base.sources.filter(s=>s.level<=level&&(!Number.isSafeInteger(Number(capacities[s.id]))||Number(capacities[s.id])<1));
    const metrics=new Map(actual.map(g=>[g.key,groupMetrics(model,g,level)]));
    return {level,capacities,groups:actual,orderWorkBalance:new Map(actual.map(g=>[g.key,orderWorkBalance(model,g)])),metrics,work:new Map(actual.map(g=>[g.key,metrics.get(g.key).totalMinutes])),results:new Map(),failures:new Map(),quantityFits:[],capacityError:missing.length?'缺少有效产能：'+missing.map(s=>s.name).join('、'):null,cacheKey:ranchImportCacheKey(base,level,rules,capacities)};
  });
}

export function ranchDistributionRows(plans,type='all'){
  return plans.flatMap(plan=>ranchTypes.filter(t=>type==='all'||t.id===type).map(t=>{
    const groups=plan.groups.filter(g=>g.types.includes(t.id)),work=[],optimized=[];let bounded=0,failed=0;
    for(const g of groups){
      work.push(plan.work.get(g.key));
      // Preserve historical quantities for review, but an old schedule is not
      // a current result if repeated products no longer meet the quantity rule.
      if(!hasEqualProductQuantities(g))continue;
      const r=plan.results.get(g.key);
      if(r?.proven&&Number.isFinite(r.optimalMinutes)&&r.optimalMinutes>=0)optimized.push(r.optimalMinutes);
      else if(r&&!r.proven)bounded++;
      else if(plan.failures.has(g.key))failed++;
    }
    return {level:plan.level,type:t.id,name:t.name,color:t.color,total:groups.length,proven:optimized.length,bounded,failed,pending:groups.length-optimized.length-bounded-failed,capacityError:plan.capacityError,work:summarizeMinutes(work),optimized:summarizeMinutes(optimized),workValues:work,optimizedValues:optimized};
  }));
}

export function ranchLevelLink(level,type='building'){
  return `ranch.html?level=${Math.max(1,Math.trunc(Number(level)||1))}&amp;type=${type==='chain'?'chain':'building'}`;
}

export function ranchDashboardTarget(raw={}){
  const hours=Number(raw.targetHours),tolerance=Number(raw.targetTolerance),minutes=Number.isFinite(hours)&&hours>0?hours*60:null;
  const valid=minutes!=null&&Number.isFinite(tolerance)&&tolerance>=0;
  const work=String(raw.targetWork??'').trim()===''?null:Number(raw.targetWork);
  return {minutes:valid?minutes:null,tolerance:valid?tolerance:null,lower:valid?Math.max(0,minutes-tolerance):null,upper:valid?minutes+tolerance:null,work:Number.isFinite(work)&&work>0?work:null};
}

export function ranchDashboardRows(plans,targets={},type='all'){
  const byLevel=new Map(plans.map(p=>[p.level,p]));
  return ranchDistributionRows(plans,type).map(row=>{
    const plan=byLevel.get(row.level),groups=plan.groups.filter(g=>g.types.includes(row.type)),complexity=[],coins=[];
    for(const group of groups){
      const m=plan.metrics?.get(group.key);
      if(Number.isFinite(m?.complexity)&&m.complexity>=0)complexity.push(m.complexity);
      if(Number.isFinite(m?.coinValue)&&m.coinValue>=0)coins.push(m.coinValue);
    }
    const target=ranchDashboardTarget(targets[row.level]),within=target.minutes==null?null:groups.filter(g=>plan.orderWorkBalance?.get(g.key)?.valid!==false&&plan.results.get(g.key)?.proven&&plan.results.get(g.key).optimalMinutes>=target.lower-1e-8&&plan.results.get(g.key).optimalMinutes<=target.upper+1e-8).length;
    const statusGroups=groups.map(g=>{if(!hasEqualProductQuantities(g))return {key:`${plan.level}:${g.key}`,state:'pending'};const r=plan.results.get(g.key);return {key:`${plan.level}:${g.key}`,state:r?.proven&&Number.isFinite(r.optimalMinutes)&&r.optimalMinutes>=0?'proven':r&&!r.proven?'bounded':plan.failures.has(g.key)?'failed':'pending'};});
    return {...row,target,within,withinShare:row.proven&&within!=null?within/row.proven:null,complexity:summarizeMinutes(complexity),coins:summarizeMinutes(coins),missingCoins:groups.length-coins.length,statusGroups};
  });
}

// Totals visit each level's actual groups once, even when a group belongs to
// both categories. Missing/bounded schedules never enter exact-time statistics.
export function ranchDashboardSummary(plans,targets={},type='all'){
  const result={levels:plans.length,total:0,proven:0,bounded:0,pending:0,failed:0,within:0,targetedProven:0,missingCoins:0,capacityLevels:0};
  for(const plan of plans){
    const target=ranchDashboardTarget(targets[plan.level]),groups=plan.groups.filter(g=>type==='all'||g.types.includes(type));
    if(groups.length&&plan.capacityError)result.capacityLevels++;
    const seen=new Set();
    for(const g of groups){
      if(seen.has(g.key))continue;seen.add(g.key);result.total++;
      const r=plan.results.get(g.key),m=plan.metrics?.get(g.key);
      if(!Number.isFinite(m?.coinValue)||m.coinValue<0)result.missingCoins++;
      if(!hasEqualProductQuantities(g)){result.pending++;continue;}
      if(r?.proven&&Number.isFinite(r.optimalMinutes)&&r.optimalMinutes>=0){
        result.proven++;
        if(target.minutes!=null){result.targetedProven++;if(r.optimalMinutes>=target.lower-1e-8&&r.optimalMinutes<=target.upper+1e-8)result.within++;}
      }else if(r&&!r.proven)result.bounded++;
      else if(plan.failures.has(g.key))result.failed++;
      else result.pending++;
    }
  }
  result.withinShare=result.targetedProven?result.within/result.targetedProven:null;
  return result;
}

export function renderRanchDistributionEmpty(rows,metric='optimized'){
  const unique=rows.every(r=>r.statusGroups)?new Map(rows.flatMap(r=>r.statusGroups.map(g=>[g.key,g.state]))):null,statesCount=state=>unique?[...unique.values()].filter(v=>v===state).length:rows.reduce((n,r)=>n+r[state],0);
  const total=unique?unique.size:rows.reduce((n,r)=>n+r.total,0),bounded=statesCount('bounded'),pending=statesCount('pending'),failed=statesCount('failed'),capacity=rows.some(r=>r.total&&r.capacityError);
  if(!total)return '<div class="distribution-chart-empty"><strong>暂无符合规则的组合</strong><span>切换类型或查看后续等级</span></div>';
  if(metric!=='optimized')return '<div class="distribution-chart-empty"><strong>暂无可统计数据</strong></div>';
  const states=[pending?`待计算 ${pending.toLocaleString()} 组`:'',bounded?`待证明最优 ${bounded.toLocaleString()} 组`:'',failed?`计算失败 ${failed.toLocaleString()} 组`:''].filter(Boolean).join(' · ');
  return `<div class="distribution-chart-empty"><strong>联合优化时间尚未就绪</strong><span>${states||'尚无已证明最优的排程'}</span>${capacity?'<span>部分等级缺少有效产能，请在单等级分析补填。</span>':''}<button type="button" class="primary" data-calculate-ranch>计算全部等级</button></div>`;
}

export function renderRanchMetricTrend(rows,metric){
  const label=metric==='complexity'?'平均累计复杂度':'平均金币总值',unit=metric==='complexity'?'种 / 组':'金币 / 组';
  if(!rows.some(r=>r[metric]?.n))return `<div class="distribution-chart-empty auxiliary-empty"><strong>${metric==='coins'?'暂无完整金币单价':'暂无组合'}</strong></div>`;
  const levels=[...new Set(rows.map(r=>r.level))],width=Math.max(640,levels.length*34+75),height=218,left=48,right=width-20,top=30,bottom=177,step=(right-left)/Math.max(1,levels.length-1),max=ceiling(Math.max(...rows.map(r=>r[metric]?.mean??0))),x=level=>levels.length===1?(left+right)/2:left+levels.indexOf(level)*step,y=value=>bottom-value/max*(bottom-top),parts=[];
  for(let i=0;i<=4;i++){const value=max*i/4;parts.push(`<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="#e7ede8"/><text x="${left-8}" y="${y(value)+4}" text-anchor="end">${formatMinutes(value)}</text>`);}
  levels.forEach(level=>parts.push(`<text x="${x(level)}" y="199" text-anchor="middle">${level}</text>`));
  for(const [typeIndex,type] of ranchTypes.entries()){
    const series=levels.map(level=>rows.find(r=>r.level===level&&r.type===type.id)),segments=[];let active=[];
    for(const row of series){if(row?.[metric]?.n)active.push(row);else if(active.length){segments.push(active);active=[];}}if(active.length)segments.push(active);
    for(const segment of segments)parts.push(`<polyline points="${segment.map(r=>`${x(r.level)},${y(r[metric].mean)}`).join(' ')}" fill="none" stroke="${type.color}" stroke-width="2"/>`);
    for(const row of series){
      if(!row?.[metric]?.n)continue;const s=row[metric],labelY=Math.max(14,Math.min(bottom+13,y(s.mean)+(typeIndex===0?-9:17))),tip=`Lv ${row.level} · ${type.name}\n平均 ${formatMinutes(s.mean)} · 最小 ${formatMinutes(s.min)} · 最大 ${formatMinutes(s.max)}\n${s.n} / ${row.total} 组${metric==='coins'&&row.missingCoins?` · ${row.missingCoins} 组缺少单价`:''}`;
      parts.push(`<a href="${ranchLevelLink(row.level,type.id)}" aria-label="查看 Lv ${row.level} ${type.name}"><title>${tip}</title><circle cx="${x(row.level)}" cy="${y(s.mean)}" r="8" fill="transparent"/><circle cx="${x(row.level)}" cy="${y(s.mean)}" r="3.5" fill="${type.color}" stroke="white"/><text class="distribution-point-label" x="${x(row.level)}" y="${labelY}" fill="${type.color}" text-anchor="middle">${formatMinutes(s.mean)}</text></a>`);
    }
  }
  return `<svg role="img" aria-label="${label}按等级变化" viewBox="0 0 ${width} ${height}" style="min-width:${width}px"><text x="8" y="13">${unit}</text>${parts.join('')}<text x="${right}" y="216" text-anchor="end">等级</text></svg>`;
}

const statsTitle=s=>`样本 ${s.n} · 最小 ${formatMinutes(s.min)} · P25 ${formatMinutes(s.q1)} · 中位 ${formatMinutes(s.median)} · 均值 ${formatMinutes(s.mean)} · P75 ${formatMinutes(s.q3)} · 最大 ${formatMinutes(s.max)} 分钟`;
const ceiling=max=>{const raw=(max>0?max:1)/4,p=10**Math.floor(Math.log10(raw)),unit=[1,2,2.5,5,10].find(v=>v*p>=raw)*p;return unit*4;};

export function renderRanchBoxPlot(rows,metric){
  if(!rows.some(r=>r[metric]?.n))return renderRanchDistributionEmpty(rows,metric);
  const levels=[...new Set(rows.map(r=>r.level))],types=ranchTypes.filter(t=>rows.some(r=>r.type===t.id)),width=Math.max(640,levels.length*30+88),height=276,left=58,top=24,bottom=232,plotWidth=width-left-20,step=plotWidth/Math.max(1,levels.length);
  const targetAt=level=>rows.find(r=>r.level===level)?.target;
  const targetMax=levels.map(level=>{const t=targetAt(level);return metric==='optimized'?t?.upper:t?.work;}).filter(Number.isFinite);
  const max=ceiling(Math.max(0,...rows.map(r=>r[metric].max??0),...targetMax)),y=v=>bottom-v/max*(bottom-top),pieces=[];
  for(let i=0;i<=4;i++){const value=max*i/4;pieces.push(`<line x1="${left}" x2="${width-20}" y1="${y(value)}" y2="${y(value)}" stroke="#e7ede8"/><text x="${left-9}" y="${y(value)+4}" text-anchor="end">${formatMinutes(value)}</text>`);}
  levels.forEach((level,index)=>{
    const center=left+(index+.5)*step,target=targetAt(level),href=ranchLevelLink(level,types[0].id);
    pieces.push(`<a href="${href}" aria-label="查看 Lv ${level} 单等级分析"><text x="${center}" y="253" text-anchor="middle">${level}</text></a>`);
    if(metric==='optimized'&&Number.isFinite(target?.upper))pieces.push(`<g class="ranch-target-band"><title>Lv ${level} 目标 ${formatMinutes(target.minutes)} ± ${formatMinutes(target.tolerance)} 分钟</title><rect x="${center-step/2}" y="${y(target.upper)}" width="${step}" height="${Math.max(1,y(target.lower)-y(target.upper))}" fill="#c9d0e0" opacity=".38"/><line x1="${center-step/2}" x2="${center+step/2}" y1="${y(target.minutes)}" y2="${y(target.minutes)}" stroke="#8290a6" stroke-dasharray="3 3"/></g>`);
    if(metric==='work'&&Number.isFinite(target?.work))pieces.push(`<g class="ranch-work-target"><title>Lv ${level} 累计工时目标 ${formatMinutes(target.work)} 分钟</title><line x1="${center-step/2}" x2="${center+step/2}" y1="${y(target.work)}" y2="${y(target.work)}" stroke="#8290a6" stroke-width="2" stroke-dasharray="3 3"/></g>`);
    types.forEach((t,j)=>{
      const r=rows.find(r=>r.level===level&&r.type===t.id),s=r?.[metric];if(!s?.n)return;
      const x=center+(j-(types.length-1)/2)*18,boxWidth=12;
      pieces.push(`<a href="${ranchLevelLink(level,t.id)}" aria-label="查看 Lv ${level} ${t.name}"><title>Lv ${level} · ${t.name}\n${statsTitle(s)}${metric==='optimized'?`\n已证明 ${r.proven} / ${r.total} 组`:''}</title><rect x="${x-8}" y="${Math.max(top,y(s.max)-8)}" width="16" height="${Math.max(16,y(s.min)-y(s.max)+16)}" fill="transparent"/><line x1="${x}" x2="${x}" y1="${y(s.max)}" y2="${y(s.min)}" stroke="${t.color}"/><path d="M${x-4},${y(s.max)}h8 M${x-4},${y(s.min)}h8" stroke="${t.color}"/><rect x="${x-boxWidth/2}" y="${y(s.q3)}" width="${boxWidth}" height="${Math.max(1,y(s.q1)-y(s.q3))}" fill="${t.color}" fill-opacity=".2" stroke="${t.color}"/><line x1="${x-boxWidth/2}" x2="${x+boxWidth/2}" y1="${y(s.median)}" y2="${y(s.median)}" stroke="${t.color}" stroke-width="2"/><circle cx="${x}" cy="${y(s.mean)}" r="2.5" fill="${t.color}"/></a>`);
    });
  });
  return `<svg role="img" aria-label="${metric==='optimized'?'联合优化时间':'累计工时'}按等级分布，单位分钟" viewBox="0 0 ${width} ${height}" style="min-width:${width}px"><text x="8" y="14">分钟</text>${pieces.join('')}<text x="${width-20}" y="273" text-anchor="end">等级</text></svg>`;
}

export function ranchTimeBins(rows,metric,requested=30){
  if(!Number.isFinite(requested)||requested<=0)throw Error('时间分段必须大于0。');
  const key=metric==='optimized'?'optimizedValues':'workValues',max=rows.reduce((m,r)=>r[key].reduce((a,v)=>Math.max(a,v),m),0);
  const step=Math.max(requested,Math.ceil((max+1)/200/requested)*requested),count=Math.max(1,Math.floor(max/step)+1);
  const counts=rows.map(r=>{const bins=Array(count).fill(0);for(const v of r[key])bins[Math.floor(v/step)]++;return bins;});
  return {step,bins:Array.from({length:count},(_,i)=>({start:i*step,end:(i+1)*step,series:rows.map((r,j)=>{const total=r[key].length,n=counts[j][i];return {type:r.type,name:r.name,color:r.color,count:n,share:total?n/total:0,total};})}))};
}

export function renderRanchHistogram(rows,metric){
  const {bins,step}=ranchTimeBins(rows,metric),width=Math.max(600,bins.length*32+80),height=220,left=45,bottom=178,top=18,slot=(width-left-15)/bins.length,highest=Math.max(.01,...bins.flatMap(b=>b.series.map(s=>s.share))),max=ceiling(highest),y=v=>bottom-v/max*(bottom-top),parts=[];
  for(let i=0;i<=4;i++){const value=max*i/4;parts.push(`<line x1="${left}" x2="${width-15}" y1="${y(value)}" y2="${y(value)}" stroke="#e7ede8"/><text x="${left-5}" y="${y(value)+4}" text-anchor="end">${(value*100).toFixed(0)}%</text>`);}
  bins.forEach((b,i)=>{
    const x=left+i*slot;for(const [j,s] of b.series.entries()){const w=Math.min(16,(slot-4)/Math.max(1,b.series.length)),bx=x+slot/2+(j-b.series.length/2)*w;parts.push(`<rect x="${bx}" y="${y(s.share)}" width="${w-1}" height="${bottom-y(s.share)}" fill="${s.color}" opacity=".8"><title>${escape(s.name)} · [${b.start}, ${b.end}) 分钟\n${s.count} / ${s.total} 组 · ${(s.share*100).toFixed(2)}%</title></rect>`);}
    if(i%Math.max(1,Math.ceil(bins.length/12))===0)parts.push(`<text x="${x+slot/2}" y="198" text-anchor="middle">${b.start}</text>`);
  });
  return `<div class="distribution-bin-note">每 ${step} 分钟一段 · 各类型内占比</div><div class="distribution-scroll"><svg role="img" aria-label="${metric==='optimized'?'联合优化时间':'累计工时'}分段占比" viewBox="0 0 ${width} ${height}" style="min-width:${width}px">${parts.join('')}<text x="${width-15}" y="216" text-anchor="end">分钟</text></svg></div>`;
}

export function ranchDistributionCSV(rows){
  const header=['等级','类型','组合数','已证明最优','待证明','待计算','失败','优化最小(分)','优化P25(分)','优化中位(分)','优化均值(分)','优化P75(分)','优化最大(分)','累计最小(分)','累计P25(分)','累计中位(分)','累计均值(分)','累计P75(分)','累计最大(分)','优化目标(分)','允许偏差(分)','累计工时目标(分)','目标内已证明组数','目标内占已证明比例','平均累计复杂度','平均金币总值','缺少单价组数'];
  const keys=['min','q1','median','mean','q3','max'];
  return '\uFEFF'+[header,...rows.map(r=>[r.level,r.name,r.total,r.proven,r.bounded,r.pending,r.failed,...keys.map(k=>r.optimized[k]),...keys.map(k=>r.work[k]),r.target?.minutes,r.target?.tolerance,r.target?.work,r.within,r.withinShare,r.complexity?.mean,r.coins?.mean,r.missingCoins])].map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
}
