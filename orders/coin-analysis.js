import {unitCoinValue} from './coin-values.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(v,d=0)=>Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:d}):'—';
const percent=v=>Number.isFinite(v)?number(v*100,1)+'%':'—';
const rate=(coins,minutes)=>Number.isFinite(coins)&&Number.isFinite(minutes)&&minutes>0?coins/minutes*60:null;

export function coinBreakdown(items,products,multiplier=1){
  const lines=items.map(item=>{const product=products.get(item.id),price=unitCoinValue(product);return {...item,name:product?.name??String(item.id),price,value:price===null?null:price*item.quantity*multiplier,estimated:String(product?.coinValueStatus??'').includes('估算')};});
  return {lines,total:lines.some(v=>v.value===null)?null:lines.reduce((s,v)=>s+v.value,0)};
}

// Callers supply the exact admitted population. Weights are probabilities for
// ordinary orders and one per distinct actual group for ranch orders.
export function summarizeCoins(rows,products,{multiplier=1,equalWeight=false}={}){
  const active=rows.filter(v=>Number.isFinite(v.weight)&&v.weight>0).map(v=>equalWeight?{...v,weight:1}:v),mass=active.reduce((s,v)=>s+v.weight,0);
  const summary={count:active.length,mean:null,median:null,min:null,max:null,workRate:null,optimizedRate:null,missingCount:0,missingMass:0,estimatedMass:0,distribution:[],products:[]};
  if(!mass)return summary;
  const priced=[],contributions=new Map();let work=0,optimized=0,workComplete=true,optimizedComplete=true;
  for(const row of active){
    const weight=row.weight/mass,detail=coinBreakdown(row.items,products,multiplier);
    if(detail.total===null){summary.missingCount++;summary.missingMass+=weight;}else priced.push({value:detail.total,weight});
    if(detail.lines.some(v=>v.estimated))summary.estimatedMass+=weight;
    if(Number.isFinite(row.workMinutes)&&row.workMinutes>=0)work+=row.workMinutes*weight;else workComplete=false;
    if(Number.isFinite(row.optimizedMinutes)&&row.optimizedMinutes>=0)optimized+=row.optimizedMinutes*weight;else optimizedComplete=false;
    for(const line of detail.lines){
      if(!contributions.has(line.id))contributions.set(line.id,{id:line.id,name:line.name,price:line.price,estimated:line.estimated,quantity:0,value:line.price===null?null:0});
      const p=contributions.get(line.id);p.quantity+=line.quantity*weight;if(p.value!==null)p.value+=line.value*weight;
    }
  }
  priced.sort((a,b)=>a.value-b.value);
  if(!summary.missingCount){
    summary.mean=priced.reduce((s,v)=>s+v.value*v.weight,0);summary.min=priced[0].value;summary.max=priced.at(-1).value;
    // Inverse weighted CDF, matching the other ordinary-order outcome statistics.
    let sum=0;for(const v of priced){sum+=v.weight;if(sum>=.5-1e-12){summary.median=v.value;break;}}
    if(equalWeight)summary.median=(priced[(priced.length-1)>>1].value+priced[priced.length>>1].value)/2;
    summary.workRate=workComplete?rate(summary.mean,work):null;
    summary.optimizedRate=optimizedComplete?rate(summary.mean,optimized):null;
  }
  if(priced.length){
    const lo=priced[0].value,hi=priced.at(-1).value,count=hi===lo?1:Math.min(8,new Set(priced.map(v=>v.value)).size),step=(hi-lo)/count;
    summary.distribution=Array.from({length:count},(_,i)=>({low:lo+i*step,high:i===count-1?hi:lo+(i+1)*step,last:i===count-1,mass:0,count:0}));
    for(const v of priced){const bin=summary.distribution[count===1?0:Math.min(count-1,Math.floor((v.value-lo)/step))];bin.mass+=v.weight;bin.count++;}
  }
  summary.products=[...contributions.values()].map(v=>({...v,share:summary.mean>0&&v.value!==null?v.value/summary.mean:null})).sort((a,b)=>(b.value??-1)-(a.value??-1)||String(a.id).localeCompare(String(b.id)));
  return summary;
}

export function renderCoinBreakdown(items,products,{multiplier=1,slots=false}={}){
  const d=coinBreakdown(items,products,multiplier);
  return `<div class="coin-breakdown">${d.lines.map((v,i)=>`<div><span>${slots?`<b>${'ABCD'[i]}</b> `:''}${esc(v.name)} ×${number(v.quantity)}</span><span>单价 ${number(v.price,2)}${v.estimated?'（估）':''} · <strong>${number(v.value)}</strong> 金币</span></div>`).join('')}<p>${multiplier===1?'交付数量 × 商品单价':`交付数量 × 商品单价 × ${multiplier}`} · 合计 <b>${number(d.total)}</b> 金币${d.total===null?'（缺少单价）':''}</p></div>`;
}

export function renderCoinAnalysis(s,{scope='',multiplier=1,ranch=false}={}){
  const cards=[['平均',number(s.mean),ranch?'金币 / 四单组':'金币 / 单'],['中位数',number(s.median),ranch?'按四单组金币排序取中间值':'按累计概率达到 50% 的订单'],['最低～最高',s.min===null?'—':`${number(s.min)}～${number(s.max)}`,'仅统计可生成订单'],['单位累计工时金币',number(s.workRate),'金币 / 资源工时小时']];
  const max=Math.max(...s.distribution.map(v=>v.mass),.001);
  return `<div class="coin-analysis-heading"><h3>金币分析</h3><span>${esc(scope)} · ${number(s.count)} ${ranch?'组':'单'}</span></div>${!s.count?'<p class="coin-empty">'+(ranch?'本级此类型暂无达标实际订单，完成按目标计算后显示统计。':'本级暂无最终概率结果，拟合后显示统计。')+'</p>':`<div class="coin-summary">${cards.map(([label,value,note])=>`<div><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('')}</div>${s.missingCount?`<p class="coin-warning">${s.missingCount} ${ranch?'组':'单'}缺少单价，占${ranch?'组合':'生成概率'} ${percent(s.missingMass)}；整体均值、中位数、范围与效率暂不计算。下方仅展示已定价部分，比例仍以全部订单为分母。</p>`:''}<div class="coin-analysis-grid"><section><h4>金币分布 <small>${ranch?'组合占比':'生成概率'}</small></h4><div class="coin-histogram" role="img" aria-label="金币分布">${s.distribution.map(v=>`<div title="${v.low===v.high?number(v.low,2):`${number(v.low,2)}≤金币${v.last?'≤':'<'}${number(v.high,2)}`}：${percent(v.mass)}，${v.count}${ranch?'组':'单'}"><b>${percent(v.mass)}</b><i style="height:${Math.max(2,v.mass/max*90)}px"></i><span>${v.low===v.high?number(v.low):number(v.low)+'～'+number(v.high)}</span></div>`).join('')||'<p class="coin-empty">没有已定价订单</p>'}</div>${ranch?`<p class="coin-note">按真实联合优化时间：<b>${number(s.optimizedRate)}</b> 金币 / 小时。${s.optimizedRate===null?'暂无完整有效时间。':''}</p>`:''}</section><section><h4>金币来自哪些商品 <small>按贡献降序</small></h4><div class="coin-product-table"><table><thead><tr><th>交付商品</th><th>单价</th><th>平均交付量</th><th>平均金币贡献</th><th>占比</th></tr></thead><tbody>${s.products.map(v=>`<tr><th scope="row">${esc(v.name)}${v.estimated?' <small>估</small>':''}</th><td>${number(v.price,2)}</td><td>${number(v.quantity,2)}</td><td>${number(v.value)}</td><td>${percent(v.share)}</td></tr>`).join('')}</tbody></table></div></section></div><p class="coin-note">${ranch?'只统计本级当前类型的达标实际订单，每组等权、相同组合不按动物位排列重复统计。金币是四单交付商品总值，不含 Token。':'按本级最终生成概率加权；金币奖励 = 交付商品总值 × '+multiplier+'。'} 只计直接交付商品，上游原料不重复计价。单位累计工时金币 = 平均金币 ÷ 平均累计工时 × 60，用于比较生产资源收益，不是玩家每小时实际收入。${s.estimatedMass?` 含估算单价的${ranch?'组合占比':'生成概率'} ${percent(s.estimatedMass)}。`:''}</p>`}`;
}
