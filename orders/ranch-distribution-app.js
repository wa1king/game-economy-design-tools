import {buildRanchDistributionPlans,ranchDistributionRows,renderRanchBoxPlot,renderRanchHistogram,ranchDistributionCSV,formatMinutes,reuseRanchDistributionResult} from './ranch-distribution.js';
import {ranchSettingsKey} from './ranch-import.js';
import {loadRanchCache,saveRanchCache} from './ranch-cache.js';
import {createProjectStore} from './project-storage.js';

const $=id=>document.getElementById(id),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let base,plans=[],filter='all',worker=null,running=false,token=0,cacheQueue=Promise.resolve(),budget=2000,activePlan=null,cancelWorker=null;
const showError=text=>{$('distributionError').textContent=text;$('distributionError').hidden=!text;};
const proven=r=>r?.proven&&Number.isFinite(r.optimalMinutes)&&r.optimalMinutes>=0;

function render(){
  const rows=ranchDistributionRows(plans,filter),unique=plans.reduce((s,p)=>s+p.groups.length,0),done=plans.reduce((s,p)=>s+p.groups.filter(g=>proven(p.results.get(g.key))).length,0),bounded=plans.reduce((s,p)=>s+p.groups.filter(g=>p.results.get(g.key)&&!proven(p.results.get(g.key))).length,0);
  $('distributionSummary').innerHTML=`<article><span>等级 / 全部去重组合</span><strong>${plans.length} / ${unique.toLocaleString()}</strong><small>同建筑与高级链重合的组合只计一次</small></article><article><span>联合优化时间 · 已证明</span><strong>${done.toLocaleString()} <small style="display:inline">/ ${unique.toLocaleString()} 组</small></strong><small>累计工时已统计全部组合</small></article><article><span>优化时间 · 待证明</span><strong class="${bounded?'distribution-warning':''}">${bounded.toLocaleString()}</strong><small>尚未计算 ${(unique-done-bounded).toLocaleString()} 组（含失败）</small></article>`;
  $('optimizedPlot').innerHTML=renderRanchBoxPlot(rows,'optimized');$('workPlot').innerHTML=renderRanchBoxPlot(rows,'work');
  $('distributionRows').innerHTML=rows.map(r=>`<tr class="${r.level===Number($('distributionLevel').value)?'distribution-selected':''}"><td><button data-level="${r.level}">Lv ${r.level}</button></td><td class="distribution-type-${r.type}">${r.name}</td><td>${r.total.toLocaleString()}</td><td>${r.proven} / ${r.total}${r.capacityError?`<span class="distribution-state">${esc(r.capacityError)}</span>`:r.bounded||r.failed||r.pending?`<span class="distribution-state">${r.bounded?`待证明 ${r.bounded}　`:''}${r.pending?`待计算 ${r.pending}　`:''}${r.failed?`失败 ${r.failed}`:''}</span>`:''}</td>${['optimized','work'].map(metric=>['min','median','mean','max'].map(k=>`<td>${formatMinutes(r[metric][k])}</td>`).join('')).join('')}</tr>`).join('');
  renderDetail(rows);$('downloadDistribution').disabled=!plans.length;
}
function renderDetail(rows=ranchDistributionRows(plans,filter)){
  const selected=rows.filter(r=>r.level===Number($('distributionLevel').value));
  $('selectedDistributionMeta').textContent=selected.map(r=>`${r.name} ${r.total} 组 · 优化已证明 ${r.proven}`).join('　/　');
  $('optimizedHistogram').innerHTML=selected.some(r=>r.proven)?renderRanchHistogram(selected,'optimized'):'<div class="placeholder">本级尚无已证明最优的排程</div>';
  $('workHistogram').innerHTML=selected.some(r=>r.total)?renderRanchHistogram(selected,'work'):'<div class="placeholder">本级暂无该类型组合</div>';
}

async function savePlan(plan){
  // Merge in the latest cache: another scheme page may have finished calculations
  // or quantity recommendations while this independent overview was open.
  const previous=await loadRanchCache(plan.cacheKey),results=new Map(previous?.results??[]),failures=new Map(previous?.failures??[]);
  for(const [key,r] of plan.results)if(!proven(results.get(key))||proven(r))results.set(key,r);
  for(const [key,error] of plan.failures)if(!results.has(key))failures.set(key,error);
  for(const key of results.keys())failures.delete(key);
  await saveRanchCache(plan.cacheKey,{version:2,results:[...results],failures:[...failures],quantityFits:previous?.quantityFits??[]});
}
function queueSave(plan){cacheQueue=cacheQueue.catch(()=>{}).then(()=>savePlan(plan)).catch(()=>showError('统计仍可查看，但计算结果未能缓存。请导出统计后再关闭。'));return cacheQueue;}
function pause(){token++;worker?.terminate();worker=null;cancelWorker?.(false);cancelWorker=null;if(activePlan)queueSave(activePlan);activePlan=null;running=false;$('pauseDistribution').hidden=true;$('calculateDistribution').disabled=!plans.length;$('reloadDistribution').disabled=false;}

async function load(){
  pause();const generation=token;showError('');$('distributionWorkspace').hidden=true;$('distributionEmpty').hidden=true;$('calculateDistribution').disabled=true;$('reloadDistribution').disabled=true;
  try{
    await cacheQueue;
    const source=JSON.parse(localStorage.getItem('ranch-source-v1')||'null'),project=source?.kind==='import'?source:createProjectStore(localStorage).load();
    if(!project?.base){plans=[];$('distributionEmpty').hidden=false;return;}
    base=structuredClone(project.base);const settings=JSON.parse(localStorage.getItem(ranchSettingsKey(base))||'{}');budget=Number(settings.searchLimit)||2000;
    const next=buildRanchDistributionPlans(base,settings);
    for(const plan of next){
      const cache=await loadRanchCache(plan.cacheKey);if(generation!==token)return;
      if(cache?.version===1||cache?.version===2){plan.results=new Map(cache.results??[]);plan.failures=new Map(cache.failures??[]);}
    }
    plans=next;$('distributionSource').textContent=project.filename??base.filename??'当前牧场项目';
    $('distributionLevel').innerHTML=plans.map(p=>`<option value="${p.level}">Lv ${p.level}</option>`).join('');$('distributionLevel').value=String(Math.min(base.maxLevel,Math.max(1,Number(settings.level)||1)));
    $('distributionWorkspace').hidden=false;$('calculateDistribution').disabled=false;$('distributionProgress').textContent='已读取保存的数量、产能和排产结果';render();
  }catch(error){plans=[];showError(error.message);}finally{$('reloadDistribution').disabled=false;}
}

async function calculate(){
  if(running||!plans.length)return;
  running=true;const generation=++token;showError('');$('calculateDistribution').disabled=true;$('reloadDistribution').disabled=true;$('pauseDistribution').hidden=false;
  // A fixed demand with identical capacities has the same joint optimum at every
  // level where its goods are unlocked. Reuse only certified results.
  const reuse=new Map();for(const p of plans)for(const g of p.groups){const r=p.results.get(g.key);if(proven(r))reuse.set(JSON.stringify([p.capacities,g.key]),{group:g,result:r});}
  let lastPaint=0,lastSave=0;
  try{for(const plan of plans){
    if(generation!==token)return;
    if(plan.capacityError)continue;
    for(const g of plan.groups){const cached=reuse.get(JSON.stringify([plan.capacities,g.key]));if(cached)plan.results.set(g.key,reuseRanchDistributionResult(cached,g));}
    const missing=plan.groups.filter(g=>!proven(plan.results.get(g.key)));
    if(missing.length){
      const owned=new Worker('./ranch-worker.js',{type:'module'});worker=owned;activePlan=plan;
      const complete=await new Promise(resolve=>{
        cancelWorker=resolve;
        owned.onmessage=({data})=>{
          if(generation!==token||worker!==owned){resolve(false);return;}
          if(data.type==='result'){plan.results.set(data.id,data.result);plan.failures.delete(data.id);if(proven(data.result))reuse.set(JSON.stringify([plan.capacities,data.id]),{group:plan.groups.find(g=>g.key===data.id),result:data.result});}
          if(data.type==='groupError')plan.failures.set(data.id,data.message);
          if(data.type==='result'||data.type==='groupError'){
            $('distributionProgress').textContent=`计算 Lv ${plan.level} / ${plans.length} · 本级 ${data.index} / ${data.total}`;
            if(performance.now()-lastPaint>400||data.index===data.total){render();lastPaint=performance.now();}
            // Throttle large IndexedDB writes; pause also flushes this plan.
            if(performance.now()-lastSave>1500||data.index===data.total){queueSave(plan);lastSave=performance.now();}
          }
          if(data.type==='done'){owned.terminate();worker=null;resolve(true);}
          if(data.type==='error'){showError(`Lv ${plan.level}：${data.message}`);owned.terminate();worker=null;resolve(true);}
        };
        owned.onerror=event=>{if(generation!==token)return;showError(`Lv ${plan.level}：${event.message||'计算中断'}`);owned.terminate();worker=null;resolve(true);};
        owned.postMessage({base,groups:missing.map(g=>({...g,id:g.key})),level:plan.level,capacities:plan.capacities,timeLimitMs:budget});
      });
      if(generation!==token)return;cancelWorker=null;
      if(!complete)return;
    }
    await queueSave(plan);if(generation!==token)return;activePlan=null;render();
  }}catch(error){if(generation!==token)return;pause();showError(error.message||'统计计算中断，可继续计算。');render();return;}
  pause();$('distributionProgress').textContent=plans.some(p=>p.capacityError)?'本轮完成；缺少产能的等级请回方案页补填':'本轮完成；待证明组合可再次计算';render();
}

$('calculateDistribution').onclick=calculate;$('reloadDistribution').onclick=load;
$('pauseDistribution').onclick=()=>{pause();$('distributionProgress').textContent='已暂停，已完成结果保留';render();};
$('distributionLevel').onchange=()=>render();
$('distributionRows').onclick=event=>{const button=event.target.closest('[data-level]');if(!button)return;$('distributionLevel').value=button.dataset.level;render();$('selectedDistributionMeta').scrollIntoView({block:'center',behavior:'smooth'});};
for(const button of document.querySelectorAll('[data-type]'))button.onclick=()=>{filter=button.dataset.type;for(const b of document.querySelectorAll('[data-type]')){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}render();};
$('downloadDistribution').onclick=()=>{const url=URL.createObjectURL(new Blob([ranchDistributionCSV(ranchDistributionRows(plans,filter))],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='牧场全等级时间分布.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
load();
