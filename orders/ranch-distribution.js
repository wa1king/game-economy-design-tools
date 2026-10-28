import {prepareRanch,ranchCapacities,groupMetrics} from './ranch-engine.js';
import {generateRanchLevelGroups,remapRanchResult} from './ranch-catalog.js';
import {quantityGroup} from './ranch-quantity.js';
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
  const model=prepareRanch(base),rules={cropQuantity:Number(settings.cropQuantity??7),productQuantity:Number(settings.productQuantity??1),allowRepeated:settings.allowRepeated??false};
  if(!Number.isSafeInteger(base.maxLevel)||base.maxLevel<1||base.maxLevel>200)throw Error('最高等级需为1至200。');
  return Array.from({length:base.maxLevel},(_,i)=>{
    const level=i+1,capacities={...ranchCapacities(model,level),...(settings.capacities?.[level]??{})},edits=settings.quantityEdits?.[level]??{};
    const {groups}=generateRanchLevelGroups(model,level,rules);
    const actual=groups.map(g=>Object.hasOwn(edits,g.id)?quantityGroup(g,edits[g.id]):g);
    const missing=base.sources.filter(s=>s.level<=level&&(!Number.isSafeInteger(Number(capacities[s.id]))||Number(capacities[s.id])<1));
    return {level,capacities,groups:actual,work:new Map(actual.map(g=>[g.key,groupMetrics(model,g,level).totalMinutes])),results:new Map(),failures:new Map(),quantityFits:[],capacityError:missing.length?'缺少有效产能：'+missing.map(s=>s.name).join('、'):null,cacheKey:ranchImportCacheKey(base,level,rules,capacities)};
  });
}

export function ranchDistributionRows(plans,type='all'){
  return plans.flatMap(plan=>ranchTypes.filter(t=>type==='all'||t.id===type).map(t=>{
    const groups=plan.groups.filter(g=>g.types.includes(t.id)),work=[],optimized=[];let bounded=0,failed=0;
    for(const g of groups){
      work.push(plan.work.get(g.key));const r=plan.results.get(g.key);
      if(r?.proven&&Number.isFinite(r.optimalMinutes)&&r.optimalMinutes>=0)optimized.push(r.optimalMinutes);
      else if(r&&!r.proven)bounded++;
      else if(plan.failures.has(g.key))failed++;
    }
    return {level:plan.level,type:t.id,name:t.name,color:t.color,total:groups.length,proven:optimized.length,bounded,failed,pending:groups.length-optimized.length-bounded-failed,capacityError:plan.capacityError,work:summarizeMinutes(work),optimized:summarizeMinutes(optimized),workValues:work,optimizedValues:optimized};
  }));
}

const statsTitle=s=>`样本 ${s.n} · 最小 ${formatMinutes(s.min)} · P25 ${formatMinutes(s.q1)} · 中位 ${formatMinutes(s.median)} · 均值 ${formatMinutes(s.mean)} · P75 ${formatMinutes(s.q3)} · 最大 ${formatMinutes(s.max)} 分钟`;
const ceiling=max=>{const raw=Math.max(1,max)/4,p=10**Math.floor(Math.log10(raw)),unit=[1,2,2.5,5,10].find(v=>v*p>=raw)*p;return unit*4;};

export function renderRanchBoxPlot(rows,metric){
  const levels=[...new Set(rows.map(r=>r.level))],types=ranchTypes.filter(t=>rows.some(r=>r.type===t.id)),width=Math.max(640,levels.length*30+88),height=276,left=58,top=24,bottom=232,plotWidth=width-left-20,step=plotWidth/Math.max(1,levels.length);
  const max=ceiling(Math.max(0,...rows.map(r=>r[metric].max??0))),y=v=>bottom-v/max*(bottom-top),pieces=[];
  for(let i=0;i<=4;i++){const value=max*i/4;pieces.push(`<line x1="${left}" x2="${width-20}" y1="${y(value)}" y2="${y(value)}" stroke="#e7ede8"/><text x="${left-9}" y="${y(value)+4}" text-anchor="end">${formatMinutes(value)}</text>`);}
  levels.forEach((level,index)=>{
    const center=left+(index+.5)*step;pieces.push(`<text x="${center}" y="253" text-anchor="middle">${level}</text>`);
    types.forEach((t,j)=>{
      const r=rows.find(r=>r.level===level&&r.type===t.id),s=r?.[metric];if(!s?.n)return;
      const x=center+(j-(types.length-1)/2)*18,boxWidth=12;
      pieces.push(`<g><title>Lv ${level} · ${t.name}\n${statsTitle(s)}${metric==='optimized'?`\n已证明 ${r.proven} / ${r.total} 组`:''}</title><line x1="${x}" x2="${x}" y1="${y(s.max)}" y2="${y(s.min)}" stroke="${t.color}"/><path d="M${x-4},${y(s.max)}h8 M${x-4},${y(s.min)}h8" stroke="${t.color}"/><rect x="${x-boxWidth/2}" y="${y(s.q3)}" width="${boxWidth}" height="${Math.max(1,y(s.q1)-y(s.q3))}" fill="${t.color}" fill-opacity=".2" stroke="${t.color}"/><line x1="${x-boxWidth/2}" x2="${x+boxWidth/2}" y1="${y(s.median)}" y2="${y(s.median)}" stroke="${t.color}" stroke-width="2"/><circle cx="${x}" cy="${y(s.mean)}" r="2.5" fill="${t.color}"/></g>`);
    });
  });
  if(metric==='optimized'&&max>=360)pieces.push(`<line x1="${left}" x2="${width-20}" y1="${y(360)}" y2="${y(360)}" stroke="#9ba9a0" stroke-dasharray="4 4"/><text x="${width-22}" y="${y(360)-5}" text-anchor="end">6 小时</text>`);
  if(!rows.some(r=>r[metric].n))pieces.push(`<text x="${left+plotWidth/2}" y="120" text-anchor="middle">${metric==='optimized'?'暂无已证明最优的排程，可计算全部等级':'暂无该类型组合'}</text>`);
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
  const header=['等级','类型','组合数','已证明最优','待证明','待计算','失败','优化最小(分)','优化P25(分)','优化中位(分)','优化均值(分)','优化P75(分)','优化最大(分)','累计最小(分)','累计P25(分)','累计中位(分)','累计均值(分)','累计P75(分)','累计最大(分)'];
  const keys=['min','q1','median','mean','q3','max'];
  return '\uFEFF'+[header,...rows.map(r=>[r.level,r.name,r.total,r.proven,r.bounded,r.pending,r.failed,...keys.map(k=>r.optimized[k]),...keys.map(k=>r.work[k])])].map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
}
