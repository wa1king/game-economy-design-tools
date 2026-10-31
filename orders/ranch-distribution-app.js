import {ranchDashboardRows,ranchDashboardSummary,renderRanchBoxPlot,renderRanchMetricTrend,renderRanchHistogram,renderRanchDistributionEmpty,ranchDistributionCSV,ranchLevelLink,formatMinutes} from './ranch-distribution.js';
import {loadRanchWorkspace,readRanchTarget,calculateRanchWorkspace,watchRanchWorkspace} from './ranch-workspace.js';

const $=id=>document.getElementById(id),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent=v=>v==null?'—':(v*100).toFixed(1)+'%',count=v=>Number(v).toLocaleString('zh-CN');
let workspace=null,plans=[],filter='all',running=false,loading=false,controller=null,loadToken=0,paintTimer=null,reloadQueued=false,pendingRun=null;
const showError=text=>{$('distributionError').textContent=text;$('distributionError').hidden=!text;};
const targets=()=>Object.fromEntries(plans.map(p=>[p.level,readRanchTarget(workspace.settings,p.level)]));
const statsCell=s=>s.n?`${formatMinutes(s.median)} / ${formatMinutes(s.mean)}<small>${formatMinutes(s.min)}～${formatMinutes(s.max)}</small>`:'—';

function controls(){
  $('calculateDistribution').disabled=running||loading||!plans.some(p=>p.groups.length);
  $('reloadDistribution').disabled=running||loading;$('pauseDistribution').hidden=!running;$('pauseDistribution').disabled=!running||!!controller?.signal.aborted;
  for(const button of document.querySelectorAll('[data-calculate-ranch]'))button.disabled=running||loading;
}
function render(){
  if(!workspace)return;
  const configured=targets(),rows=ranchDashboardRows(plans,configured,filter),summary=ranchDashboardSummary(plans,configured,filter);
  $('distributionSummary').innerHTML=`<article><span>达标实际订单组</span><strong>${count(summary.accepted)}<small>${plans.length} 级</small></strong><small>所有图表仅统计达标实际订单 · 每组等权</small></article><article><span>平均联合优化时间</span><strong>${formatMinutes(summary.optimized.mean)}<small>分钟</small></strong><small>仅统计已证明最优且符合本级目标的订单</small></article><article><span>平均四单金币总值</span><strong>${summary.missingCoins?'—':formatMinutes(summary.coins.mean)}<small>金币 / 组</small></strong><small>${summary.missingCoins?`${count(summary.missingCoins)} 个实际订单组缺少单价`:'实际交付数量 × 商品单价'}</small></article>`;
  $('presetSummary').textContent=`预设 ${count(summary.total)} 组 · 实际入库 ${count(summary.accepted)} 组 · 未入库 ${count(summary.excluded)} 组`;
  $('presetProgress').innerHTML=`<span>已证明排程 ${count(summary.proven)}</span><span>待计算 ${count(summary.pending)}</span><span>待证明 ${count(summary.bounded)}</span><span>排产失败 ${count(summary.failed)}</span><p>预设组合中，只有排程已证明最优、优化时间达标、数量与单单工时占比符合当前规则的组合才进入实际订单。其余可到单等级分析的“预设组合”中查看。</p>`;
  $('optimizedPlot').innerHTML=renderRanchBoxPlot(rows,'optimized');$('workPlot').innerHTML=renderRanchBoxPlot(rows,'work');
  $('complexityPlot').innerHTML=renderRanchMetricTrend(rows,'complexity');$('coinPlot').innerHTML=renderRanchMetricTrend(rows,'coins');
  const targeted=plans.filter(p=>rows.find(r=>r.level===p.level)?.target.work!=null).length;
  $('workTargetNote').textContent=targeted===plans.length?'各级目标线':targeted?`${targeted} 级设定目标 · 其余自动估算`:'目标自动估算 · 尚未固定';
  $('coinCoverageNote').textContent=summary.missingCoins?`${count(summary.missingCoins)} 组缺少单价，未计入`:'数量 × 商品单价';
  $('distributionRows').innerHTML=rows.map((r,index)=>{
    const start=index===0||rows[index-1].level!==r.level;
    return `<tr class="${start?'level-start':''}"><td><a href="${ranchLevelLink(r.level,r.type)}">Lv ${r.level}<span class="distribution-type-${r.type}">${r.name}</span></a></td><td>${count(r.accepted)}</td><td>${r.target.minutes==null?'—':`${formatMinutes(r.target.lower)}～${formatMinutes(r.target.upper)}`}</td><td>${statsCell(r.optimized)}</td><td>${statsCell(r.work)}</td><td>${formatMinutes(r.complexity.mean)}</td><td>${r.missingCoins?'—':formatMinutes(r.coins.mean)}${r.missingCoins?`<small>缺单价 ${r.missingCoins} 组</small>`:''}</td><td><a href="${ranchLevelLink(r.level,r.type)}&amp;pool=preset">预设 ${count(r.total)} 组 / 未入库 ${count(r.total-r.accepted)}</a></td></tr>`;
  }).join('');
  renderDetail(rows);$('downloadDistribution').disabled=!plans.length;controls();
}
function renderDetail(rows=ranchDashboardRows(plans,targets(),filter)){
  const selected=rows.filter(r=>r.level===Number($('distributionLevel').value));
  $('selectedDistributionMeta').textContent=selected.map(r=>`${r.name} · 达标实际订单 ${r.accepted} 组`).join('　/　');
  $('optimizedHistogram').innerHTML=selected.some(r=>r.accepted)?renderRanchHistogram(selected,'optimized'):renderRanchDistributionEmpty(selected,'optimized');
  $('workHistogram').innerHTML=selected.some(r=>r.accepted)?renderRanchHistogram(selected,'work'):renderRanchDistributionEmpty(selected,'work');
}
function schedulePaint(){if(paintTimer==null)paintTimer=setTimeout(()=>{paintTimer=null;render();},180);}
async function load(){
  if(running){reloadQueued=true;return;}
  const generation=++loadToken,selected=$('distributionLevel').value;loading=true;showError('');controls();
  try{
    const loaded=await loadRanchWorkspace();if(generation!==loadToken)return;
    workspace=loaded;plans=loaded?.plans??[];
    $('distributionEmpty').hidden=!!loaded;$('distributionWorkspace').hidden=!loaded;
    if(!loaded)return;
    $('distributionSource').textContent=`${loaded.filename||'当前牧场项目'} · ${loaded.base.products.length} 商品`;
    window.dispatchEvent(new CustomEvent('ranch:source',{detail:{filename:loaded.filename,meta:`${loaded.base.products.length} 商品`}}));
    $('distributionLevel').innerHTML=plans.map(p=>`<option value="${p.level}">Lv ${p.level}</option>`).join('');
    $('distributionLevel').value=String(plans.some(p=>p.level===Number(selected))?selected:Math.min(loaded.base.maxLevel,Math.max(1,Number(loaded.settings.level)||1)));
    $('distributionProgress').textContent='已读取保存的配量与排产结果';render();
  }catch(error){if(generation===loadToken)showError(error.message||'读取失败，请重新加载。');}
  finally{if(generation===loadToken){loading=false;controls();}}
}
async function calculate(){
  if(running||loading||!workspace||!plans.some(p=>p.groups.length))return;
  const own=new AbortController();controller=own;running=true;reloadQueued=false;showError('');controls();
  $('distributionProgress').textContent='按目标配量并计算全部等级…';
  try{
    pendingRun=calculateRanchWorkspace(workspace,{mode:'quantity',signal:own.signal,onProgress:progress=>{$('distributionProgress').textContent=progress.message||`计算 Lv ${progress.level} · ${progress.index??0} / ${progress.total??0}`;},onChange:schedulePaint});
    const report=await pendingRun;
    $('distributionProgress').textContent=own.signal.aborted?'已暂停 · 已完成结果保留':report?.failed?`本轮完成 · ${report.failed} 项需处理，请查看各级状态`:'本轮计算完成 · 待证明组合可继续计算';
  }catch(error){if(!own.signal.aborted)showError(error.message||'计算中断，可继续计算。');else $('distributionProgress').textContent='已暂停 · 已完成结果保留';}
  finally{
    clearTimeout(paintTimer);paintTimer=null;running=false;controller=null;pendingRun=null;plans=workspace.plans;render();controls();
    if(reloadQueued){reloadQueued=false;await load();}
  }
}
$('calculateDistribution').onclick=calculate;$('reloadDistribution').onclick=load;
$('pauseDistribution').onclick=()=>{controller?.abort();$('pauseDistribution').disabled=true;$('distributionProgress').textContent='正在暂停并保存结果…';};
$('distributionLevel').onchange=()=>{if(workspace){renderDetail();controls();}};
$('distributionWorkspace').addEventListener('click',event=>{if(event.target.closest('[data-calculate-ranch]'))calculate();});
for(const button of document.querySelectorAll('[data-type]'))button.onclick=()=>{filter=button.dataset.type;for(const b of document.querySelectorAll('[data-type]')){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}render();};
$('downloadDistribution').onclick=()=>{if(!workspace)return;const url=URL.createObjectURL(new Blob([ranchDistributionCSV(ranchDashboardRows(plans,targets(),filter))],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='牧场全部等级统计.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const stopWatching=watchRanchWorkspace(()=>{if(running)reloadQueued=true;else load();});
window.addEventListener('pagehide',()=>{stopWatching?.();controller?.abort();clearTimeout(paintTimer);});
window.ranchBeforeNavigate=async()=>{controller?.abort();await pendingRun;};
load();
