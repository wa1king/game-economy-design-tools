import {createProjectStore} from './project-storage.js';
import {readChainExcel} from './excel-import.js';
import {prepareRanch,ranchCapacities,groupMetrics} from './ranch-engine.js';
import {generateRanchLevelGroups,ranchDemandKey,ranchPermutations,remapRanchResult} from './ranch-catalog.js';
import {loadRanchCache,saveRanchCache} from './ranch-cache.js';
const $=id=>document.getElementById(id),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=1)=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d}),letters=['A','B','C','D'],animals=['史莱姆','吞吞貘','陆行鸟','宝箱怪'],colors=['#39866a','#a67b39','#647fac','#a46a80'];
let base,model,filename,level=20,type='all',families=[],groups=[],current,capacities={},worker,busy=false,page=0,results=new Map(),failures=new Map(),savedSettings={},storageKey,downloadUrl,cacheKey,buildToken=0,saveTimer,viewRows=[],viewRevision=0,sortedRevision=-1,sortedRows=[],metricCache=new Map(),cacheQueue=Promise.resolve();
const groupKey=g=>g.key??ranchDemandKey(g);
const representative=g=>groups.find(v=>v.key===groupKey(g))??g;
const resultFor=(g,detail=false)=>{if(!g)return null;const r=results.get(groupKey(g));return r&&detail?remapRanchResult(r,representative(g),g):r;};
function fingerprint(value){let h=2166136261;for(const c of JSON.stringify(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
function message(text=''){$('message').textContent=text;$('message').hidden=!text;}
function persist(){if(!model)return;savedSettings={...savedSettings,level,cropQuantity:Number($('cropQuantity').value),productQuantity:Number($('productQuantity').value),allowRepeated:$('allowRepeated').checked,searchLimit:$('searchLimit').value};try{localStorage.setItem(storageKey,JSON.stringify(savedSettings));}catch{message('本页设置无法保存，请导出备份。');}}
function saveCache(){clearTimeout(saveTimer);if(!cacheKey)return;const key=cacheKey,value={version:1,results:[...results],failures:[...failures]};cacheQueue=cacheQueue.catch(()=>{}).then(()=>saveRanchCache(key,value)).catch(()=>message('计算结果暂时无法缓存；本页结果仍可查看和导出。'));}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveCache,800);}
function stop(){worker?.terminate();worker=null;busy=false;$('stop').hidden=true;$('solveAll').disabled=!groups.length;$('solveOne').disabled=!current;}
function install(newBase,name,rules){
  stop();prepareRanch(newBase);base=structuredClone(newBase);model=prepareRanch(base);filename=name||base.filename||'加工链路';storageKey='ranch-settings-v1:'+fingerprint({products:base.products,sources:base.sources,lands:base.landsByLevel});
  savedSettings={};try{savedSettings=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{}
  level=Math.min(base.maxLevel||20,Math.max(1,savedSettings.level??level));$('cropQuantity').value=savedSettings.cropQuantity??rules?.cropQuantity??7;$('productQuantity').value=savedSettings.productQuantity??rules?.productQuantity??1;$('allowRepeated').checked=savedSettings.allowRepeated??false;$('searchLimit').value=savedSettings.searchLimit||'2000';
  $('projectName').textContent=filename;$('sourceMeta').textContent=`${base.products.length} 商品 · ${base.products.filter(v=>v.coinValue!=null).length} 个已定价`;$('level').innerHTML=Array.from({length:base.maxLevel||20},(_,i)=>`<option value="${i+1}">Lv ${i+1}</option>`).join('');$('level').value=level;
  $('empty').hidden=true;$('workspace').hidden=false;$('exportButton').disabled=false;capacities={...ranchCapacities(model,level),...(savedSettings.capacities?.[level]||{})};renderCapacities();rebuild();
}
function readCurrent(){const project=createProjectStore(localStorage).load();if(!project)throw Error('当前还没有导入订单项目，请选择加工链路 Excel。');install(project.base,project.filename,project.rules);localStorage.setItem('ranch-source-v1',JSON.stringify({kind:'current'}));}
function renderCapacities(){$('capacities').innerHTML=base.sources.filter(s=>s.level<=level).map(s=>`<label>${esc(s.name)} <input data-cap="${s.id}" aria-label="${esc(s.name)}并行容量" type="number" min="1" max="1000" value="${capacities[s.id]??''}" placeholder="待填"></label>`).join('');}
function updateFilters(){
  for(const [id,t] of [['allType','all'],['buildingType','building'],['chainType','chain']]){$(id).classList.toggle('active',type===t);$(id).setAttribute('aria-pressed',String(type===t));}
  const previous=$('family').value,available=families.filter(f=>type==='all'||f.type===type);
  $('family').innerHTML='<option value="">全部建筑 / 主链</option>'+available.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');if(available.some(f=>f.id===previous))$('family').value=previous;
}
async function rebuild(){
  saveCache();stop();const token=++buildToken;results=new Map();failures=new Map();metricCache=new Map();cacheKey=null;current=null;groups=[];viewRows=[];viewRevision++;page=0;type='all';message();
  try{const catalog=generateRanchLevelGroups(model,level,{cropQuantity:Number($('cropQuantity').value),productQuantity:Number($('productQuantity').value),allowRepeated:$('allowRepeated').checked});groups=catalog.groups;families=catalog.families;
    $('combinationCount').textContent=fmt(groups.length,0);$('permutationCount').textContent=fmt(catalog.permutationCount,0);
  }catch(error){families=[];$('combinationCount').textContent='0';$('permutationCount').textContent='0';message(error.message);}
  $('family').value='';updateFilters();updateView();persist();renderSelected();
  if(!groups.length)return;
  const generation=JSON.stringify([Number($('cropQuantity').value),Number($('productQuantity').value),$('allowRepeated').checked]);
  cacheKey='ranch-catalog-v2:'+JSON.stringify([base,level,generation,capacities]);
  $('candidateSummary').textContent='读取已有计算结果…';
  try{const cached=await loadRanchCache(cacheKey);if(token!==buildToken)return;if(cached?.version===1){const valid=new Set(groups.map(g=>g.key));results=new Map((cached.results||[]).filter(([key])=>valid.has(key)));failures=new Map((cached.failures||[]).filter(([key])=>valid.has(key)));}}catch{}
  if(token!==buildToken)return;
  const missing=base.sources.find(s=>s.level<=level&&!(Number.isSafeInteger(Number(capacities[s.id]))&&Number(capacities[s.id])>0));
  if(missing){$('settings').hidden=false;$('openSettings').setAttribute('aria-expanded','true');message(`请在产能设置填写${missing.name}的实际容量，或重新导入含累计土地的 Excel。`);renderTable();return;}
  viewRevision++;renderSelected();renderTable();run(groups.filter(g=>!results.get(g.key)?.proven));
}
function updateView(){
  const selectedFamily=$('family').value,query=$('search').value.trim().toLowerCase(),expanded=$('expandPermutations').checked;
  viewRows=[];for(const g of groups){if(type!=='all'&&!g.types.includes(type)||selectedFamily&&!g.familyIds.includes(selectedFamily))continue;if(query&&!g.slots.some(v=>model.by.get(v.id).name.toLowerCase().includes(query)))continue;
    const variants=expanded?ranchPermutations(g):[g];for(const v of variants)viewRows.push(v);}
  page=0;viewRevision++;if(!current||!viewRows.some(g=>g.id===current.id))current=viewRows[0]??null;renderTable();renderSelected();
}
function metrics(g){const key=groupKey(g);if(!metricCache.has(key))metricCache.set(key,groupMetrics(model,g,level));return metricCache.get(key);}
function renderSelected(){
  $('solveOne').disabled=!current||busy;$('groupTitle').textContent=current?'R'+String(viewRows.findIndex(v=>v.id===current.id)+1).padStart(5,'0')+' · 四单详情':'四单详情';$('groupMeta').textContent=current?`Lv ${level} · ${current.types.map(t=>t==='building'?'同建筑':'高级加工链').join(' / ')} · 动物位固定分配`:'本级暂无符合规则的需求组';
  if(!current){$('slots').innerHTML='';for(const id of ['optimal','totalMinutes','complexity','coins'])$(id).textContent='—';renderSchedule(null);$('solveState').textContent='无候选';return;}
  $('slots').innerHTML=current.slots.map((v,i)=>{const p=model.by.get(v.id);return `<article class="slot"><div class="slot-top"><b>动物 ${letters[i]}</b><span>${animals[i]}</span></div><strong class="slot-product">${esc(p.name)} <small>×${v.quantity}</small></strong><div class="slot-info"><span>${esc(p.buildingName)} · Lv ${p.level}</span><span>单步 ${fmt(p.stepMinutes)}分 · 复杂度 ${model.chains.get(p.id).size}</span></div></article>`;}).join('');
  const m=metrics(current),r=resultFor(current,true),error=failures.get(groupKey(current));$('totalMinutes').textContent=fmt(m.totalMinutes);$('complexity').textContent=fmt(m.complexity,0);$('coins').textContent=fmt(m.coinValue);$('coinNote').textContent=m.coinValue==null?'存在未导入金币单价的商品':'数量 × 导入金币单价 · 非Token奖励';
  $('optimalLabel').textContent=r&&!r.proven?'四单可行完工时间':'四单联合优化时间';$('optimal').textContent=r?fmt(r.proven?r.optimalMinutes:r.feasibleMinutes):'—';$('optimalNote').textContent=r?(r.proven?'已证明最优 · 四单全部备齐':`最优时间范围 ${fmt(r.lowerMinutes)}～${fmt(r.feasibleMinutes)}分`):'空仓 · 等待后台计算';$('solveState').textContent=error?'计算失败':r?(r.proven?'已证明最优':'待证明最优'):busy?'计算中':'待计算';$('solveState').className='badge'+(error||r&&!r.proven?' warn':'');renderSchedule(r);
}
function renderSchedule(result){
  if(!result){$('schedule').innerHTML='<div class="placeholder">计算本组后查看建筑时间轴</div>';$('completion').hidden=true;$('scheduleMeta').textContent='A / B / C / D 标识对应动物位的生产任务';return;}
  const rows=[];for(const source of [...base.sources].sort((a,b)=>(b.category==='田地'||b.id===0?1:0)-(a.category==='田地'||a.id===0?1:0)||a.level-b.level)){const raw=result.schedule.filter(t=>t.resource===String(source.id));if(!raw.length)continue;const compact=new Map();
    for(const t of raw){const key=[t.productId,t.slot,t.start,t.end].join(':');if(compact.has(key))compact.get(key).count++;else compact.set(key,{...t,count:1});}const tasks=[...compact.values()],lanes=[];
    for(const task of tasks){let lane=lanes.findIndex(v=>v.end<=task.start);if(lane<0){lane=lanes.length;lanes.push({end:0,tasks:[]});}lanes[lane].tasks.push(task);lanes[lane].end=task.end;}
    rows.push({source,lanes});
  }
  const width=1120,left=133,right=28,plot=width-left-right,rowGap=18,laneHeight=15,span=result.feasibleMinutes;
  let y=42;const grid=[],bars=[],labels=[];
  for(const {source,lanes} of rows){labels.push(`<text x="0" y="${y+12}" fill="#61796d" font-size="11">${esc(source.name)}</text><text x="0" y="${y+27}" fill="#8a9990" font-size="9">${capacities[source.id]} 条并行通道</text>`);
    for(const lane of lanes){for(const task of lane.tasks){const x=left+task.start/span*plot,w=Math.max(.8,task.duration/span*plot),label=task.name+(task.count>1?' ×'+task.count:'');bars.push(`<g><title>动物${letters[task.slot]} · ${esc(label)} · ${fmt(task.start)}—${fmt(task.end)}分钟</title><rect x="${x}" y="${y}" width="${w}" height="12" rx="2" fill="${colors[task.slot]}" opacity=".86"/>${w>45?`<text x="${x+4}" y="${y+9}" fill="white" font-size="9">${esc(label.slice(0,Math.floor((w-8)/10)))}</text>`:''}</g>`);}y+=laneHeight;}y+=rowGap;
  }
  y=Math.max(y,120);for(let i=0;i<=6;i++){const x=left+i/6*plot;grid.push(`<line x1="${x}" y1="30" x2="${x}" y2="${y-8}" stroke="#e7eee7" stroke-width="1"/><text x="${x}" y="15" fill="#7b8f82" font-size="10" text-anchor="middle">${fmt(span*i/6)}</text>`);}
  $('schedule').innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${y}" role="img" aria-label="四单共享资源排产图，${fmt(span)}分钟全部备齐">${grid.join('')}${labels.join('')}${bars.join('')}</svg>`;
  $('scheduleMeta').textContent=`${result.taskCount} 个生产任务 · ${result.proven?'最优排程':'当前可行排程'} · 横轴：分钟`;
  $('completion').hidden=false;$('completion').innerHTML=result.slotCompletionMinutes.map((v,i)=>`<span style="color:${colors[i]}">动物 ${letters[i]} 备齐<b>${fmt(v)} 分钟</b></span>`).join('');
}

function entries(){
  if(sortedRevision===viewRevision)return sortedRows;const field=$('sort').value,sign=$('direction').value==='asc'?1:-1;
  sortedRows=viewRows.map((g,i)=>({g,i,m:metrics(g),r:resultFor(g)})).sort((a,b)=>{
    if(field==='default')return (a.i-b.i)*sign;const av=field==='optimal'?a.r?.optimalMinutes:a.m[field],bv=field==='optimal'?b.r?.optimalMinutes:b.m[field];
    if(av==null||bv==null)return av==null&&bv==null?a.i-b.i:av==null?1:-1;return (av-bv)*sign||a.i-b.i;
  });sortedRevision=viewRevision;return sortedRows;
}
function renderTable(){
  const list=entries(),maxPage=Math.max(0,Math.ceil(list.length/40)-1);page=Math.min(page,maxPage);$('candidateCount').textContent=fmt(list.length,0)+' 组';
  const solved=groups.filter(g=>results.has(g.key)).length,proven=groups.filter(g=>results.get(g.key)?.proven),done=proven.length;
  $('candidateSummary').textContent=`本级${busy?'正在计算':'已计算'} ${solved+failures.size} / ${groups.length} 个组合 · 最优 ${done} · 待证明 ${solved-done}${failures.size?' · 失败 '+failures.size:''}`;
  $('progress').value=solved+failures.size;$('progress').max=Math.max(1,groups.length);$('completionCount').textContent=done===groups.length&&done?'全部完成':fmt(done,0)+' / '+fmt(groups.length,0);
  const visibleKeys=new Set(viewRows.map(groupKey)),visibleProven=proven.filter(g=>visibleKeys.has(g.key));$('batchStats').hidden=!visibleProven.length;
  if(done){$('averageTime').textContent=fmt(proven.reduce((s,g)=>s+results.get(g.key).optimalMinutes,0)/done);if(visibleProven.length){const values=visibleProven.map(g=>results.get(g.key).optimalMinutes).sort((a,b)=>a-b),mean=values.reduce((s,v)=>s+v,0)/values.length,mid=(values[(values.length-1)>>1]+values[values.length>>1])/2;$('batchStats').innerHTML=`<span>当前筛选 · 已证明 ${visibleProven.length} 个组合 · 逐组合等权</span><span>平均 <b>${fmt(mean)}分</b></span><span>中位数 <b>${fmt(mid)}分</b></span><span>最短 <b>${fmt(values[0])}分</b></span><span>最长 <b>${fmt(values.at(-1))}分</b></span>`;}}else $('averageTime').textContent='—';
  $('rows').innerHTML=list.slice(page*40,page*40+40).map(({g,i,m,r})=>`<tr class="${g.id===current?.id?'selected':''}"><td><button class="group-button" data-select="${esc(g.id)}">R${String(i+1).padStart(5,'0')}</button></td>${g.slots.map((v,j)=>`<td class="commodity-cell"><span class="slot-item">${esc(model.by.get(v.id).name)} <small>×${v.quantity}</small></span></td>`).join('')}<td><span class="type-tag">${g.types.map(t=>t==='building'?'同建筑':'加工链').join(' / ')}</span></td><td class="optimal-cell">${r?(r.proven?fmt(r.optimalMinutes)+'分':`<span class="bounded" title="已找到可行排程，尚未证明最优">${fmt(r.lowerMinutes)}～${fmt(r.feasibleMinutes)}分</span>`):failures.has(groupKey(g))?`<span title="${esc(failures.get(groupKey(g)))}">计算失败</span>`:busy?'计算中':'待计算'}</td><td>${fmt(m.totalMinutes)}分</td><td>${fmt(m.complexity,0)}</td><td>${fmt(m.coinValue)}</td></tr>`).join('')||'<tr><td colspan="10" class="placeholder">本级暂无符合筛选条件的四单组合</td></tr>';
  $('range').textContent=list.length?`${page*40+1}—${Math.min(list.length,page*40+40)} / ${fmt(list.length,0)} 组`:'0 组';$('prev').disabled=page===0;$('next').disabled=page>=maxPage;$('solveAll').disabled=busy||!groups.length;$('solveAll').hidden=busy||done===groups.length;$('shuffle').disabled=!list.length;
}
function run(items){
  stop();if(!items.length){renderTable();return;}message();busy=true;$('solveOne').disabled=true;$('solveAll').disabled=true;$('stop').hidden=false;
  worker=new Worker('./ranch-worker.js',{type:'module'});const ownedWorker=worker;let lastPaint=0;
  worker.onmessage=({data})=>{if(worker!==ownedWorker)return;
    if(data.type==='result'){results.set(data.id,data.result);failures.delete(data.id);}
    if(data.type==='groupError')failures.set(data.id,data.message);
    if(data.type==='result'||data.type==='groupError'){scheduleSave();if(performance.now()-lastPaint>250||data.index===data.total){viewRevision++;renderTable();if($('groupDetails').open)renderSelected();lastPaint=performance.now();}}
    if(data.type==='error'){stop();saveCache();message(data.message);viewRevision++;renderSelected();renderTable();}
    if(data.type==='done'){stop();saveCache();viewRevision++;renderSelected();renderTable();}
  };
  worker.onerror=event=>{if(worker!==ownedWorker)return;stop();saveCache();message(event.message||'排产计算中断，可继续计算。');renderSelected();renderTable();};
  worker.postMessage({base,groups:items.map(g=>({...g,id:g.key})),level,capacities,timeLimitMs:Number($('searchLimit').value)});renderTable();
}
function sample(){if(!viewRows.length)return;const random=new Uint32Array(1);crypto.getRandomValues(random);current=viewRows[Math.floor(random[0]/4294967296*viewRows.length)];$('groupDetails').open=true;renderSelected();renderTable();$('groupDetails').scrollIntoView({behavior:'smooth',block:'start'});}
function exportData(){
  if(!model)return;const payload={schema:'ranch-level-catalog-v2',source:{filename,sha256:base.source?.sha256??null},level,capacities,rules:{cropQuantity:Number($('cropQuantity').value),productQuantity:Number($('productQuantity').value),allowRepeated:$('allowRepeated').checked},assumptions:{inventory:0,actionsMinutes:0,facilitiesAvailableAt:0,warehouseCapacity:'unlimited',singleYield:true,scope:'production_only_not_digesting',slots:'all_fixed_A_B_C_D_permutations',scheduleReuse:'identical_product_quantities_only'},families,combinationCount:groups.length,permutationCount:groups.reduce((s,g)=>s+ranchPermutations(g).length,0),products:base.products,groups:groups.map(g=>({...g,metrics:metrics(g),scheduleResult:results.get(g.key)??null,error:failures.get(g.key)??null,permutations:ranchPermutations(g).map(p=>({id:p.id,slots:p.slots,scheduleKey:g.key}))}))};
  const json=JSON.stringify(payload,null,2);$('exportJson').value=json;if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(new Blob([json],{type:'application/json'}));$('downloadLink').href=downloadUrl;$('downloadLink').download=`牧场全部订单_Lv${level}.json`;$('downloadArea').hidden=false;$('exportSummary').textContent=`Lv ${level} · 全部 ${fmt(groups.length,0)} 个组合 · 含完整动物位排列及已计算排程`;
}
$('importButton').onclick=$('importEmpty').onclick=()=>$('importFile').click();$('readCurrent').onclick=$('readProject').onclick=()=>{try{readCurrent();}catch(e){message(e.message);}};
$('importFile').onchange=async()=>{const file=$('importFile').files[0];if(!file)return;try{const imported=await readChainExcel(file);install(imported,file.name);localStorage.setItem('ranch-source-v1',JSON.stringify({kind:'import',base:imported,filename:file.name}));}catch(e){message(e.message);}finally{$('importFile').value='';}};
$('level').onchange=()=>{level=Number($('level').value);capacities={...ranchCapacities(model,level),...(savedSettings.capacities?.[level]||{})};renderCapacities();rebuild();};
for(const [id,t] of [['allType','all'],['buildingType','building'],['chainType','chain']])$(id).onclick=()=>{type=t;updateFilters();updateView();};
$('family').onchange=$('expandPermutations').onchange=updateView;$('search').oninput=updateView;
$('openSettings').onclick=()=>{$('settings').hidden=!$('settings').hidden;$('openSettings').setAttribute('aria-expanded',String(!$('settings').hidden));};
$('applySettings').onclick=()=>{try{const updated={...capacities};for(const input of $('capacities').querySelectorAll('input')){const n=Number(input.value);if(!Number.isSafeInteger(n)||n<1)throw Error('所有已解锁设施的并行容量都必须是正整数。');updated[input.dataset.cap]=n;}for(const id of ['cropQuantity','productQuantity'])if(!Number.isSafeInteger(Number($(id).value))||Number($(id).value)<1)throw Error('需求数量必须是正整数。');capacities=updated;(savedSettings.capacities??={})[level]={...capacities};rebuild();}catch(e){message(e.message);}};
$('solveOne').onclick=()=>current&&run([representative(current)]);$('shuffle').onclick=sample;$('solveAll').onclick=()=>run(groups.filter(g=>!results.get(g.key)?.proven));$('stop').onclick=()=>{stop();saveCache();renderSelected();renderTable();};
$('sort').onchange=$('direction').onchange=()=>{page=0;viewRevision++;renderTable();};$('prev').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
$('rows').onclick=event=>{const target=event.target.closest('[data-select]');if(!target)return;current=viewRows.find(g=>g.id===target.dataset.select);$('groupDetails').open=true;renderSelected();renderTable();$('groupDetails').scrollIntoView({behavior:'smooth',block:'start'});};$('groupDetails').ontoggle=()=>{if($('groupDetails').open)renderSelected();};
$('exportButton').onclick=exportData;$('closeDownload').onclick=()=>{$('downloadArea').hidden=true;};$('copyExport').onclick=async()=>{try{await navigator.clipboard.writeText($('exportJson').value);$('exportSummary').textContent='全部需求组 JSON 已复制';}catch{$('exportJson').closest('details').open=true;$('exportJson').focus();$('exportJson').select();$('exportSummary').textContent='请按 Ctrl+C 复制配置';}};
window.addEventListener('pagehide',saveCache);
try{const saved=JSON.parse(localStorage.getItem('ranch-source-v1')||'null');if(saved?.kind==='import')install(saved.base,saved.filename);else readCurrent();}catch(e){message(e.message);}
