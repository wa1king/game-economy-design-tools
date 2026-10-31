import {DEFAULT_CROP_QUANTITY,readRanchSettings} from './order-quantity-rules.js';
import {writeSharedChainSource} from './shared-chain-source.js';
import {createRanchLevelCatalog} from './ranch-level-catalog.js';
import {ranchSettingsKey,ranchImportCacheKey} from './ranch-import.js';
import {ranchBrowserScope,ranchSchemeStep} from './ranch-browser.js';
import {ranchChainData,renderRanchChain,setupRanchChains} from './ranch-chain.js';
import {quantityGroup,quantityOptions,estimateRanchWorkRatio} from './ranch-quantity.js';
import {renderOrderItems,setupItemInfo} from './item-info.js';
import {readChainExcel} from './excel-import.js';
import {prepareRanch,ranchCapacities,groupMetrics} from './ranch-engine.js';
import {generateRanchLevelGroups,ranchDemandKey,ranchPermutations,remapRanchResult} from './ranch-catalog.js';
import {loadRanchCache,saveRanchCache,mergeRanchCache} from './ranch-cache.js';
import {mergeRanchSettings,notifyRanchChange,watchRanchWorkspace,ranchSource,readRanchTarget,validateRanchTarget,ranchFitIsCurrent} from './ranch-workspace.js';
const $=id=>document.getElementById(id),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=1)=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d}),letters=['A','B','C','D'],animals=['史莱姆','吞吞貘','陆行鸟','宝箱怪'],colors=['#39866a','#a67b39','#647fac','#a46a80'];
let base,model,filename,level=20,type='building',families=[],groups=[],current,capacities={},worker,busy=false,page=0,results=new Map(),failures=new Map(),savedSettings={},storageKey,cacheKey,buildToken=0,saveTimer,viewRows=[],viewRevision=0,sortedRevision=-1,sortedRows=[],itemInfo,metricCache=new Map(),cacheQueue=Promise.resolve(),quantityEdits={},quantityFits=new Map(),expandedChainId=null,workerKind=null,manualTimer,browserBuildingId=null,graphOverview=true,graphSignature='',slotSignature='',schemeSignature='';
const groupKey=g=>g.key??ranchDemandKey(g);
let persistedSettings={},fitCacheSnapshot=new Map(),syncQueued=false,syncing=false,cacheSaveError=null;
const levelCatalog=createRanchLevelCatalog({
  getState:()=>({level,groups,products:itemInfo?.products??new Map(),sources:base?.sources??[],metrics,resultFor}),
  beforeOpen:()=>commitSlotInputs(false),
  onChoose:group=>{
    if(!commitSlotInputs(false))return false;type=group.types.includes(type)?type:group.types[0];
    const family=families.find(f=>f.type===type&&group.familyIds.includes(f.id));
    if(family){browserBuildingId=model.by.get(family.anchorId??family.productIds[0]).buildingId;$('family').value=family.id;savedSettings.browser={...savedSettings.browser,familyId:family.id};}
    $('search').value='';$('expandPermutations').checked=false;current=group;updateFilters();updateView();persist();
  }
});
const navigationRequest=globalThis.URLSearchParams?new URLSearchParams(window.location?.search??''):null;
let navigationApplied=false;
const representative=g=>groups.find(v=>v.key===groupKey(g))??g;
const resultFor=(g,detail=false)=>{if(!g)return null;const r=results.get(groupKey(g));return r&&detail?remapRanchResult(r,representative(g),g):r;};
function fingerprint(value){let h=2166136261;for(const c of JSON.stringify(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
function message(text=''){$('message').textContent=text;$('message').hidden=!text;}
function persist(){
  if(!model)return;
  (savedSettings.quantityEdits??={})[level]=structuredClone(quantityEdits);(savedSettings.quantityTargetsByLevel??={})[level]=Object.fromEntries(['targetHours','targetTolerance','targetWork','fitCropMax','fitProductMax','quantityBudget'].map(id=>[id,$(id).value]));
  savedSettings={...savedSettings,browser:{type,buildingId:browserBuildingId,familyId:$('family').value,groupId:current?.id},level,cropQuantity:Number($('cropQuantity').value),productQuantity:Number($('productQuantity').value),allowRepeated:$('allowRepeated').checked,searchLimit:$('searchLimit').value,quantityTargets:Object.fromEntries(['targetHours','targetTolerance','targetWork','fitCropMax','fitProductMax','quantityBudget'].map(id=>[id,$(id).value]))};
  try{savedSettings=mergeRanchSettings(persistedSettings,savedSettings,readRanchSettings(localStorage,storageKey));localStorage.setItem(storageKey,JSON.stringify(savedSettings));persistedSettings=structuredClone(savedSettings);quantityEdits=structuredClone(savedSettings.quantityEdits?.[level]??{});restoreQuantityTargets();$('cropQuantity').value=savedSettings.cropQuantity??DEFAULT_CROP_QUANTITY;$('productQuantity').value=savedSettings.productQuantity??1;$('allowRepeated').checked=savedSettings.allowRepeated??false;$('searchLimit').value=savedSettings.searchLimit??'2000';notifyRanchChange(storageKey,'settings');}catch{message('本页设置未能保存，请导出备份。');}
}
function saveCache(){clearTimeout(saveTimer);if(!cacheKey)return;const key=cacheKey,sourceKey=storageKey,changedFits=[...quantityFits].filter(([id,fit])=>JSON.stringify(fit)!==fitCacheSnapshot.get(id)),value={version:2,results:[...results],failures:[...failures],quantityFits:changedFits};cacheQueue=cacheQueue.catch(()=>{}).then(()=>mergeRanchCache(key,value)).then(()=>{cacheSaveError=null;if(cacheKey===key)for(const [id,fit] of changedFits)fitCacheSnapshot.set(id,JSON.stringify(fit));notifyRanchChange(sourceKey,'results');}).catch(error=>{cacheSaveError=error;message('计算结果暂时无法缓存；本页结果仍可查看和导出。');});}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveCache,800);}
function stop(){clearTimeout(manualTimer);worker?.terminate();worker=null;busy=false;workerKind=null;$('stop').hidden=true;$('solveAll').disabled=!groups.length;$('fitOne').disabled=!current;renderQuantityControls();if(syncQueued&&!syncing)setTimeout(syncRanchView,0);}
function install(newBase,name,rules){
  stop();prepareRanch(newBase);base=structuredClone(newBase);model=prepareRanch(base);filename=name||base.filename||'加工链路';if(!itemInfo)itemInfo=setupItemInfo(base,document.querySelector('main'));else{itemInfo.hide();itemInfo.products.clear();base.products.forEach(p=>itemInfo.products.set(p.id,p));}storageKey='ranch-settings-v1:'+fingerprint({products:base.products,sources:base.sources,lands:base.landsByLevel});
  savedSettings={};try{savedSettings=readRanchSettings(localStorage,storageKey);}catch{}
  persistedSettings=structuredClone(savedSettings);
  type=savedSettings.browser?.type==='chain'?'chain':'building';browserBuildingId=savedSettings.browser?.buildingId??null;graphSignature='';slotSignature='';schemeSignature='';level=Math.min(base.maxLevel||20,Math.max(1,savedSettings.level??level));restoreQuantityTargets();$('cropQuantity').value=savedSettings.cropQuantity??rules?.cropQuantity??DEFAULT_CROP_QUANTITY;$('productQuantity').value=savedSettings.productQuantity??rules?.productQuantity??1;$('allowRepeated').checked=savedSettings.allowRepeated??false;$('searchLimit').value=savedSettings.searchLimit??'2000';
  if(!navigationApplied&&navigationRequest){const requested=Number(navigationRequest.get('level'));if(requested>=1&&requested<=base.maxLevel){level=requested;restoreQuantityTargets();}if(['building','chain'].includes(navigationRequest.get('type')))type=navigationRequest.get('type');navigationApplied=true;}
  $('projectName').textContent=filename;$('sourceMeta').textContent=`${base.products.length} 商品 · ${base.products.filter(v=>v.coinValue!=null).length} 个已定价`;$('level').innerHTML=Array.from({length:base.maxLevel||20},(_,i)=>`<option value="${i+1}">Lv ${i+1}</option>`).join('');$('level').value=level;
  $('empty').hidden=true;$('workspace').hidden=false;capacities={...ranchCapacities(model,level),...(savedSettings.capacities?.[level]||{})};renderCapacities();rebuild(false);
}

function renderCapacities(){$('capacities').innerHTML=base.sources.filter(s=>s.level<=level).map(s=>`<label>${esc(s.name)} <input data-cap="${s.id}" aria-label="${esc(s.name)}并行容量" type="number" min="1" max="1000" value="${capacities[s.id]??''}" placeholder="待填"></label>`).join('');}
function updateFilters(){
  for(const [id,t] of [['buildingType','building'],['chainType','chain']]){$(id).classList.toggle('active',type===t);$(id).setAttribute('aria-pressed',String(type===t));}
  const scope=ranchBrowserScope(model,families,groups,{type,buildingId:browserBuildingId,familyId:$('family').value||savedSettings.browser?.familyId});
  browserBuildingId=scope.building?.id??null;
  $('family').innerHTML=scope.families.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');$('family').value=scope.family?.id??'';
  $('buildingNav').innerHTML=scope.buildings.map(b=>`<button type="button" data-browse-building="${b.id}" class="${b.id===browserBuildingId?'active':''}" aria-pressed="${b.id===browserBuildingId}">${esc(b.name)}</button>`).join('')||'<span class="browse-empty">本级暂无可用建筑</span>';
  $('productFilterRow').hidden=type!=='chain';$('productNav').innerHTML=(type==='chain'?scope.families:[]).map(f=>`<button type="button" data-browse-family="${esc(f.id)}" class="${f.id===scope.family?.id?'active':''}" aria-pressed="${f.id===scope.family?.id}">${esc(model.by.get(f.anchorId).name)}</button>`).join('')||'<span class="browse-empty">本级暂无高级加工链方案</span>';
}
function renderSchemeNavigator(){
  const rows=entries().map(v=>v.g),index=rows.findIndex(g=>g.id===current?.id),signature=JSON.stringify(rows.map(g=>[g.id,g.slots]));
  if(signature!==schemeSignature){$('schemeNav').innerHTML=rows.map((g,i)=>`<button type="button" data-browse-scheme="${esc(g.id)}" title="${esc(g.slots.map(v=>model.by.get(v.id).name+' ×'+v.quantity).join(' / '))}" aria-label="方案 ${i+1}：${esc(g.slots.map(v=>model.by.get(v.id).name).join('、'))}">方案 ${i+1}</button>`).join('')||'<span class="browse-empty">暂无方案</span>';schemeSignature=signature;}
  for(const button of $('schemeNav').querySelectorAll('[data-browse-scheme]')){const active=button.dataset.browseScheme===current?.id;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  $('schemeCount').textContent=rows.length?`${index+1} / ${rows.length}`:'0 / 0';
  const scope=families.find(f=>f.id===$('family').value);$('groupTitle').textContent=scope?(type==='chain'?model.by.get(scope.anchorId).name:scope.name):'暂无方案';
  $('groupMeta').textContent=current?`Lv ${level} · 方案 ${index+1} / ${rows.length}`:'本级暂无符合规则的四商品组合';
}
function selectScheme(id){
  if(!id)return;clearTimeout(manualTimer);commitSlotInputs(false);current=viewRows.find(g=>g.id===id)??current;renderSelected();renderTable();persist();
}
async function rebuild(autoRun=false,readOnly=false){
  if(!readOnly)saveCache();stop();const token=++buildToken;results=new Map();failures=new Map();quantityFits=new Map();fitCacheSnapshot=new Map();quantityEdits=structuredClone(savedSettings.quantityEdits?.[level]||{});expandedChainId=null;metricCache=new Map();cacheKey=null;current=null;groups=[];viewRows=[];viewRevision++;page=0;graphSignature='';slotSignature='';schemeSignature='';message();
  try{const catalog=generateRanchLevelGroups(model,level,{cropQuantity:Number($('cropQuantity').value),productQuantity:Number($('productQuantity').value),allowRepeated:$('allowRepeated').checked});groups=catalog.groups.map(g=>{const initialQuantities=g.slots.map(v=>v.quantity),q=quantityEdits[g.id];return {...(Array.isArray(q)&&q.length===4&&q.every(n=>Number.isSafeInteger(n)&&n>=1&&n<=1000)?quantityGroup(g,q):g),initialQuantities};});families=catalog.families;
    $('combinationCount').textContent=fmt(groups.length,0);$('permutationCount').textContent=fmt(groups.reduce((total,g)=>total+ranchPermutations(g).length,0),0);
  }catch(error){families=[];$('combinationCount').textContent='0';$('permutationCount').textContent='0';message(error.message);}
  if(!groups.some(g=>g.types.includes(type))&&groups.some(g=>g.types.includes(type==='building'?'chain':'building')))type=type==='building'?'chain':'building';
  $('family').value='';current=groups.find(g=>g.id===savedSettings.browser?.groupId)??null;updateFilters();updateView();if(!readOnly)persist();renderSelected();
  if(!groups.length)return;
  cacheKey=ranchImportCacheKey(base,level,{cropQuantity:Number($('cropQuantity').value),productQuantity:Number($('productQuantity').value),allowRepeated:$('allowRepeated').checked},capacities);
  $('candidateSummary').textContent='读取已有计算结果…';
  try{const cached=await loadRanchCache(cacheKey);if(token!==buildToken)return;if(cached?.version===1||cached?.version===2){const valid=new Set(groups.map(g=>g.key));results=new Map((cached.results||[]).filter(([key])=>valid.has(key)));failures=new Map((cached.failures||[]).filter(([key])=>valid.has(key)));quantityFits=new Map((cached.quantityFits||[]).filter(([id])=>groups.some(g=>g.id===id)));}}catch{}
  if(token!==buildToken)return;fitCacheSnapshot=new Map([...quantityFits].map(([id,fit])=>[id,JSON.stringify(fit)]));
  const missing=base.sources.find(s=>s.level<=level&&!(Number.isSafeInteger(Number(capacities[s.id]))&&Number(capacities[s.id])>0));
  if(missing){$('openSettings').click();message(`请在产能设置填写${missing.name}的实际容量，或重新导入含累计土地的 Excel。`);renderTable();return;}
  viewRevision++;renderSelected();renderTable();if(autoRun)fitQuantities(groups);
}
function updateView(){
  const selectedFamily=$('family').value,expanded=$('expandPermutations').checked;
  viewRows=[];for(const g of groups){if(!g.types.includes(type)||!selectedFamily||!g.familyIds.includes(selectedFamily))continue;
    const variants=expanded?ranchPermutations(g):[g];for(const v of variants)viewRows.push(v);}
  page=0;viewRevision++;if(!current||!viewRows.some(g=>g.id===current.id))current=viewRows.find(g=>current&&groupKey(g)===groupKey(current))??viewRows[0]??null;renderTable();renderSelected();
}
function metrics(g){const key=groupKey(g);if(!metricCache.has(key))metricCache.set(key,groupMetrics(model,g,level));return metricCache.get(key);}
function renderSelected(){
  const signature=JSON.stringify([level,current?.id,current?.slots]);if(signature!==slotSignature)itemInfo?.hide();
  $('fitOne').disabled=!current||busy;$('groupTitle').textContent=current?'R'+String(viewRows.findIndex(v=>v.id===current.id)+1).padStart(5,'0')+' · 四单详情':'四单详情';$('groupMeta').textContent=current?`Lv ${level} · ${current.types.map(t=>t==='building'?'同建筑':'高级加工链').join(' / ')} · 动物位固定分配`:'本级暂无符合规则的需求组';
  if(!current){$('slots').innerHTML='';slotSignature='';graphSignature='';for(const id of ['optimal','totalMinutes','complexity','coins'])$(id).textContent='—';renderSchedule(null);$('chainGraph').innerHTML='';$('chainMeta').textContent='';$('quantityRecommendations').hidden=true;$('solveState').textContent='无候选';renderSchemeNavigator();return;}
  if(signature!==slotSignature){$('slots').innerHTML=current.slots.map((v,i)=>{const p=model.by.get(v.id);return `<article class="slot"><div class="slot-top"><b>动物 ${letters[i]}</b><span>${animals[i]}</span></div><strong class="slot-product">${renderOrderItems({items:[v]},itemInfo.products)}</strong><label class="slot-quantity">交付数量<input type="number" min="1" max="1000" step="1" data-quantity="${i}" aria-label="动物${letters[i]}交付数量" value="${v.quantity}" ${busy?'disabled':''}></label><div class="slot-info"><span>${esc(p.buildingName)} · Lv ${p.level}</span><span>单步 ${fmt(p.stepMinutes)}分 · 复杂度 ${model.chains.get(p.id).size}</span></div></article>`;}).join('');slotSignature=signature;}
  const m=metrics(current),r=resultFor(current,true),error=failures.get(groupKey(current));$('totalMinutes').textContent=fmt(m.totalMinutes);$('complexity').textContent=fmt(m.complexity,0);$('coins').textContent=fmt(m.coinValue);$('coinNote').textContent=m.coinValue==null?'存在未导入金币单价的商品':'数量 × 导入金币单价 · 非Token奖励';
  $('optimalLabel').textContent=r&&!r.proven?'四单可行完工时间':'四单联合优化时间';$('optimal').textContent=r?fmt(r.proven?r.optimalMinutes:r.feasibleMinutes):'—';$('optimalNote').textContent=r?(r.proven?'已证明最优 · 四单全部备齐':`最优时间范围 ${fmt(r.lowerMinutes)}～${fmt(r.feasibleMinutes)}分`):'空仓 · 尚未排产';$('solveState').textContent=error?'计算失败':r?(r.proven?'已证明最优':'待证明最优'):busy?'计算中':'待计算';$('solveState').className='badge'+(error||r&&!r.proven?' warn':'');renderSchedule(r);const graph=ranchChainData(model,current,level),nextGraphSignature=JSON.stringify([graphOverview,graph.nodes,graph.edges]);if(nextGraphSignature!==graphSignature){$('chainGraph').innerHTML=renderRanchChain(graph,{overview:graphOverview});setupRanchChains($('chainGraph'));graphSignature=nextGraphSignature;}$('chainMeta').textContent=`${graph.nodes.length} 种商品 · ${graph.edges.length} 条配方关系`;renderRecommendations();renderQuantityControls();renderSchemeNavigator();
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
  levelCatalog.refresh();
  const query=$('search').value.trim().toLowerCase(),list=entries().filter(({g})=>!query||g.slots.some(v=>model.by.get(v.id).name.toLowerCase().includes(query))),maxPage=Math.max(0,Math.ceil(list.length/40)-1);page=Math.min(page,maxPage);$('candidateCount').textContent=fmt(list.length,0)+' 组';
  const solved=groups.filter(g=>results.has(g.key)).length,proven=groups.filter(g=>results.get(g.key)?.proven),done=proven.length;
  $('candidateSummary').textContent=`本级${busy?'正在计算':'已计算'} ${solved+failures.size} / ${groups.length} 个组合 · 最优 ${done} · 待证明 ${solved-done}${failures.size?' · 失败 '+failures.size:''}`;
  $('progress').value=solved+failures.size;$('progress').max=Math.max(1,groups.length);$('completionCount').textContent=done===groups.length&&done?'全部完成':fmt(done,0)+' / '+fmt(groups.length,0);
  const visibleKeys=new Set(list.map(v=>groupKey(v.g))),visibleProven=proven.filter(g=>visibleKeys.has(g.key));$('batchStats').hidden=!visibleProven.length;
  if(done){$('averageTime').textContent=fmt(proven.reduce((s,g)=>s+results.get(g.key).optimalMinutes,0)/done);if(visibleProven.length){const values=visibleProven.map(g=>results.get(g.key).optimalMinutes).sort((a,b)=>a-b),mean=values.reduce((s,v)=>s+v,0)/values.length,mid=(values[(values.length-1)>>1]+values[values.length>>1])/2;$('batchStats').innerHTML=`<span>当前筛选 · 已证明 ${visibleProven.length} 个组合 · 逐组合等权</span><span>平均 <b>${fmt(mean)}分</b></span><span>中位数 <b>${fmt(mid)}分</b></span><span>最短 <b>${fmt(values[0])}分</b></span><span>最长 <b>${fmt(values.at(-1))}分</b></span><span class="work-stat">累计工时均值 <b>${fmt(visibleProven.reduce((total,g)=>total+metrics(g).totalMinutes,0)/visibleProven.length)}分</b> · 范围 <b>${fmt(Math.min(...visibleProven.map(g=>metrics(g).totalMinutes)))}～${fmt(Math.max(...visibleProven.map(g=>metrics(g).totalMinutes)))}分</b></span>`;}}else $('averageTime').textContent='—';
  if($('catalogDetails').open)$('rows').innerHTML=list.slice(page*40,page*40+40).map(({g,i,m,r})=>`<tr class="${g.id===current?.id?'selected':''}"><td><button class="group-button" data-select="${esc(g.id)}">R${String(i+1).padStart(5,'0')}</button></td>${g.slots.map((v,j)=>`<td class="commodity-cell"><span class="slot-item">${renderOrderItems({items:[v]},itemInfo.products)}</span></td>`).join('')}<td><button type="button" class="chain-toggle" data-chain="${esc(g.id)}" aria-expanded="${expandedChainId===g.id}">${expandedChainId===g.id?'收起链路':'查看链路'}</button></td><td><span class="type-tag">${g.types.map(t=>t==='building'?'同建筑':'加工链').join(' / ')}</span></td><td class="optimal-cell">${r?(r.proven?fmt(r.optimalMinutes)+'分':`<span class="bounded" title="已找到可行排程，尚未证明最优">${fmt(r.lowerMinutes)}～${fmt(r.feasibleMinutes)}分</span>`):failures.has(groupKey(g))?`<span title="${esc(failures.get(groupKey(g)))}">计算失败</span>`:busy?'计算中':'待计算'}</td><td>${fmt(m.totalMinutes)}分</td><td>${fmt(m.complexity,0)}</td><td>${fmt(m.coinValue)}</td><td>${quantityComparison(g,r,m)}</td></tr>${expandedChainId===g.id?`<tr class="chain-preview-row"><td colspan="12"><div class="chain-preview-head"><b>R${String(i+1).padStart(5,'0')} · 四单共同加工链</b><button data-select="${esc(g.id)}">调整数量 / 查看排程</button></div><div class="chain-graph">${renderRanchChain(ranchChainData(model,g,level),{compact:true})}</div></td></tr>`:''}`).join('')||'<tr><td colspan="12" class="placeholder">本级暂无符合筛选条件的四单组合</td></tr>';
  else $('rows').innerHTML='';
  setupRanchChains($('rows'));renderSchemeNavigator();
  $('range').textContent=list.length?`${page*40+1}—${Math.min(list.length,page*40+40)} / ${fmt(list.length,0)} 组`:'0 组';$('prev').disabled=page===0;$('next').disabled=page>=maxPage;$('solveAll').disabled=busy||!groups.length;$('solveAll').hidden=busy||!groups.length;$('shuffle').disabled=!viewRows.length;renderQuantityControls();
}

function sample(){if(!viewRows.length)return;const random=new Uint32Array(1);crypto.getRandomValues(random);current=viewRows[Math.floor(random[0]/4294967296*viewRows.length)];renderSelected();renderTable();persist();}

function restoreQuantityTargets(){
  const defaults={targetHours:'6',targetTolerance:'30',targetWork:'',fitCropMax:'42',fitProductMax:'12',quantityBudget:'2500'},saved=savedSettings.quantityTargetsByLevel?.[level]??(Number(savedSettings.level)===level?savedSettings.quantityTargets:null);
  for(const [id,value] of Object.entries({...defaults,...saved}))if($(id))$(id).value=value;
}
function workRatioKey(){return JSON.stringify([level,capacities]);}
let autoReferenceMemo;
function autoWorkReference(){
  const key=JSON.stringify([storageKey,level,groups.length,capacities,savedSettings.workRatios?.[workRatioKey()],$('targetHours').value]);if(autoReferenceMemo?.key===key)return autoReferenceMemo.value;
  const saved=savedSettings.workRatios?.[workRatioKey()];let ratio=saved;
  if(!(ratio>0)){const values=groups.map(g=>resultFor(g)).filter(r=>r?.proven&&r.optimalMinutes>0).map(r=>r.totalMinutes/r.optimalMinutes).sort((a,b)=>a-b);ratio=values.length?(values[(values.length-1)>>1]+values[values.length>>1])/2:estimateRanchWorkRatio(model,groups.filter(g=>g.slots.every(v=>model.by.get(v.id).level<=level)),capacities);}
  const value=ratio>0?ratio*Number($('targetHours').value)*60:null;autoReferenceMemo={key,value};return value;
}
function renderQuantityControls(){
  const reference=model?autoWorkReference():null;$('workReference').textContent=reference>0?`${$('targetWork').value?'本级参考':'自动目标'} ${fmt(reference)} 分钟`:'按配方与产能自动估算';
  $('fitOne').disabled=busy||!current||(!$('targetWork').value&&!(reference>0));$('fitFiltered').disabled=busy||!viewRows.length||(!$('targetWork').value&&!(reference>0));$('resetOneQuantity').disabled=busy||!current;$('resetLevelQuantities').disabled=busy||!groups.length;
  for(const input of document.querySelectorAll('#slots input'))input.disabled=busy;for(const id of ['targetHours','targetTolerance','targetWork','fitCropMax','fitProductMax','quantityBudget'])$(id).disabled=busy;
}
function readQuantityTargets(){
  const work=$('targetWork').value.trim()===''?autoWorkReference():Number($('targetWork').value);
  if(!(work>0))throw Error('无法估算共同累计工时，请填写累计工时目标。');
  return quantityOptions({targetMinutes:Number($('targetHours').value)*60,toleranceMinutes:Number($('targetTolerance').value),targetWorkMinutes:work,cropMax:Number($('fitCropMax').value),productMax:Number($('fitProductMax').value),timeLimitMs:Number($('quantityBudget').value)});
}
function quantityComparison(g,r,m){
  const T=Number($('targetHours').value)*60,tol=Number($('targetTolerance').value),work=$('targetWork').value.trim()===''?autoWorkReference():Number($('targetWork').value),delta=r?.proven?r.optimalMinutes-T:null,hit=r&&r.lowerMinutes>=T-tol&&r.feasibleMinutes<=T+tol;
  return `<div class="quantity-compare"><span class="${r?(hit?'hit':'miss'):''}">${delta==null?'优化待确认':`优化 ${delta>=0?'+':''}${fmt(delta)}分`}</span><span>${work>0?`累计 ${m.totalMinutes-work>=0?'+':''}${fmt(m.totalMinutes-work)}分`:'累计目标待定'}</span></div>`;
}
function setGroupQuantities(id,quantities,result=null){
  const index=groups.findIndex(g=>g.id===id);if(index<0)throw Error('当前等级中找不到该商品组合。');
  const old=groups[index],updated=quantityGroup(old,quantities);groups[index]=updated;quantityEdits[id]=[...quantities];
  if(result){results.set(updated.key,result);failures.delete(updated.key);}
  if(current&&(current.id===id||groupKey(current)===old.key))current=updated;
  return updated;
}
function renderRecommendations(){
  const g=current&&representative(current),fit=g&&quantityFits.get(g.id);$('quantityRecommendations').hidden=!fit;
  if(!fit)return;
  $('quantitySearchMeta').textContent=fit.error?'本轮配量失败':`对照 ${fit.evaluatedCount??fit.tried} 个数量配置 · ${fit.provenCount} 个排程已证明最优`;
  $('quantityReason').textContent=fit.error??`${fit.reason} 数量采用候选搜索，未证明为全范围最优配量。`;
  $('recommendationCards').innerHTML=(fit.recommendations||[]).map((v,i)=>{const r=v.result,selected=ranchDemandKey(v.group)===groupKey(g),o=fit.options;return `<article class="recommendation-card"><strong>${esc(v.label)}</strong><div class="recommendation-quantities">${v.group.slots.map(x=>`<span>${esc(model.by.get(x.id).name)} ×${x.quantity}</span>`).join('')}</div><dl><dt>联合优化时间</dt><dd>${r.proven?fmt(r.optimalMinutes):fmt(r.lowerMinutes)+'～'+fmt(r.feasibleMinutes)} 分</dd><dt>累计工时 / 目标</dt><dd>${fmt(r.totalMinutes)} / ${fmt(o.targetWorkMinutes)} 分</dd><dt>累计工时偏差</dt><dd>${r.totalMinutes-o.targetWorkMinutes>=0?'+':''}${fmt(r.totalMinutes-o.targetWorkMinutes)} 分</dd></dl><button data-recommendation="${i}" ${busy||selected?'disabled':''}>${selected?'当前数量':'采用此数量'}</button></article>`;}).join('');
}
function fitQuantities(items){
  if(!items.length)return;
  let options;try{options=readQuantityTargets();}catch(error){message(error.message);return;}
  items=items.filter(g=>!ranchFitIsCurrent(quantityFits.get(g.id),g,options));if(!items.length){$('quantityStatus').textContent='目标与商品未变化，已复用保存的配量结果。';return;}
  stop();message();if($('targetWork').value.trim()==='')(savedSettings.workRatios??={})[workRatioKey()]=options.targetWorkMinutes/options.targetMinutes;
  persist();busy=true;workerKind='quantity';$('stop').hidden=false;renderQuantityControls();
  $('quantityStatus').textContent=`正在为 ${items.length} 个组合配量 · 优化目标 ${fmt(options.targetMinutes)}±${fmt(options.toleranceMinutes)}分 · 共同累计工时 ${fmt(options.targetWorkMinutes)}分`;
  worker=new Worker('./ranch-worker.js',{type:'module'});const ownedWorker=worker,completed=[];let lastPaint=0;
  worker.onmessage=({data})=>{if(worker!==ownedWorker)return;
    if(data.type==='quantityProgress')$('quantityStatus').textContent=`配量 ${data.index} / ${data.total} · 本组已复核 ${data.tried} 个数量配置`;
    if(data.type==='quantityResult'){
      quantityFits.set(data.id,data.fit);completed.push(data.fit);const best=data.fit.recommendations[0];setGroupQuantities(data.id,best.group.slots.map(v=>v.quantity),best.result);persist();scheduleSave();
      if(performance.now()-lastPaint>250||data.index===data.total){updateView();lastPaint=performance.now();}
      $('quantityStatus').textContent=`已配量 ${data.index} / ${data.total} · ${completed.filter(f=>f.within).length} 个组合进入目标优化时间范围`;
    }
    if(data.type==='groupError'){quantityFits.set(data.id,{error:data.message});$('quantityStatus').textContent=`组合配量失败：${data.message}`;}
    if(data.type==='error'){stop();message(data.message);persist();saveCache();updateView();}
    if(data.type==='done'){
      stop();persist();saveCache();updateView();const values=completed.map(f=>f.recommendations[0].result.totalMinutes);
      $('quantityStatus').textContent=completed.length?`已配量 ${completed.length} 个组合 · ${completed.filter(f=>f.within).length} 个进入优化时间范围 · 累计工时平均 ${fmt(values.reduce((s,v)=>s+v,0)/values.length)}分（${fmt(Math.min(...values))}～${fmt(Math.max(...values))}分）`:'本轮未完成配量，请查看错误提示。';
    }
  };
  worker.onerror=event=>{if(worker!==ownedWorker)return;stop();message(event.message||'配量搜索中断；已完成的配置已保留。');persist();saveCache();updateView();};
  worker.postMessage({mode:'quantity',base,groups:items,level,capacities,options,baselines:Object.fromEntries(items.map(g=>[g.id,resultFor(g)]))});
}
function commitSlotInputs(solve=false){
  if(!current)return null;
  const inputs=[...$('slots').querySelectorAll('input[data-quantity]')],values=inputs.map(input=>Number(input.value));
  if(inputs.length!==4)return representative(current);
  if(values.some(n=>!Number.isSafeInteger(n)||n<1||n>1000)){message('四个交付数量需为1至1000的整数。');slotSignature='';renderSelected();return null;}
  if(values.every((n,i)=>n===current.slots[i].quantity))return representative(current);
  const source=representative(current),used=new Set(),q=source.slots.map(v=>{const i=current.slots.findIndex((x,j)=>!used.has(j)&&x.id===v.id&&x.quantity===v.quantity);used.add(i);return values[i];});
  stop();const updated=setGroupQuantities(source.id,q);persist();saveCache();updateView();if(solve)fitQuantities([updated]);return updated;
}
function applyManualQuantity(event){if(event.target.dataset.quantity==null)return;clearTimeout(manualTimer);commitSlotInputs();}
function resetQuantityGroups(items){
  stop();for(const g of items){setGroupQuantities(g.id,g.initialQuantities);delete quantityEdits[g.id];quantityFits.delete(g.id);}persist();saveCache();updateView();
}
$('fitOne').onclick=()=>{const g=commitSlotInputs(false);if(g)fitQuantities([g]);};
$('fitFiltered').onclick=()=>{const keys=new Set(viewRows.map(groupKey));fitQuantities(groups.filter(g=>keys.has(g.key)));};
$('slots').addEventListener('change',applyManualQuantity);
$('slots').addEventListener('input',event=>{if(event.target.dataset.quantity==null)return;clearTimeout(manualTimer);const token=buildToken;$('solveState').textContent='数量待计算';$('optimal').textContent='—';manualTimer=setTimeout(()=>{if(token===buildToken)commitSlotInputs();},450);});
$('resetOneQuantity').onclick=()=>current&&resetQuantityGroups([representative(current)]);
$('resetLevelQuantities').onclick=()=>resetQuantityGroups([...groups]);
$('recommendationCards').onclick=event=>{const button=event.target.closest('[data-recommendation]');if(!button||!current)return;const g=representative(current),candidate=quantityFits.get(g.id)?.recommendations[Number(button.dataset.recommendation)];if(!candidate)return;stop();setGroupQuantities(g.id,candidate.group.slots.map(v=>v.quantity),candidate.result);persist();saveCache();updateView();};
for(const id of ['targetHours','targetTolerance','targetWork','fitCropMax','fitProductMax','quantityBudget'])$(id).onchange=()=>{persist();viewRevision++;renderTable();renderRecommendations();};
$('importButton').onclick=$('importEmpty').onclick=()=>$('importFile').click();
$('importFile').onchange=async()=>{
  const file=$('importFile').files[0];if(!file)return;
  $('workspace').inert=true;for(const id of ['importButton','importEmpty','exportRanchExcel'])if($(id))$(id).disabled=true;
  try{
    if(file.size>60*1024*1024)throw Error('文件超过60 MB，请缩小导入数据。');
    const imported=await readChainExcel(file);prepareRanch(imported);
    await window.ranchBeforeNavigate({leaving:false});
    writeSharedChainSource(imported,file.name);
    install(imported,file.name);
    message(`已导入 ${imported.products.length} 种商品，普通订单与牧场共用此数据。`);
  }catch(error){message(error.message);}finally{$('workspace').inert=false;for(const id of ['importButton','importEmpty','exportRanchExcel'])if($(id))$(id).disabled=false;$('importFile').value='';}
};
$('level').onchange=()=>{persist();level=Number($('level').value);restoreQuantityTargets();capacities={...ranchCapacities(model,level),...(savedSettings.capacities?.[level]||{})};renderCapacities();rebuild(false);};
for(const [id,t] of [['buildingType','building'],['chainType','chain']])$(id).onclick=()=>{clearTimeout(manualTimer);commitSlotInputs(false);type=t;updateFilters();updateView();persist();};
$('family').onchange=$('expandPermutations').onchange=updateView;$('search').oninput=()=>{page=0;renderTable();};
$('shuffle').onclick=sample;$('solveAll').onclick=()=>fitQuantities(groups);$('stop').onclick=()=>{stop();saveCache();renderSelected();renderTable();};
$('sort').onchange=$('direction').onchange=()=>{page=0;viewRevision++;renderTable();};$('prev').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
$('rows').onclick=event=>{const chain=event.target.closest('[data-chain]');if(chain){expandedChainId=expandedChainId===chain.dataset.chain?null:chain.dataset.chain;renderTable();return;}const target=event.target.closest('[data-select]');if(target){selectScheme(target.dataset.select);$('groupDetails').scrollIntoView({behavior:'smooth',block:'start'});}};
$('catalogDetails').ontoggle=renderTable;
$('buildingNav').onclick=event=>{const b=event.target.closest('[data-browse-building]');if(!b)return;clearTimeout(manualTimer);commitSlotInputs(false);browserBuildingId=Number(b.dataset.browseBuilding);updateFilters();updateView();persist();};
$('productNav').onclick=event=>{const b=event.target.closest('[data-browse-family]');if(!b)return;clearTimeout(manualTimer);commitSlotInputs(false);$('family').value=b.dataset.browseFamily;updateFilters();updateView();persist();};
$('schemeNav').onclick=event=>{const button=event.target.closest('[data-browse-scheme]');if(button)selectScheme(button.dataset.browseScheme);};
$('schemeNav').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;const button=event.target.closest('[data-browse-scheme]');if(!button)return;event.preventDefault();const rows=entries().map(v=>v.g),next=event.key==='Home'?rows[0]:event.key==='End'?rows.at(-1):ranchSchemeStep(rows,current?.id,['ArrowLeft','ArrowUp'].includes(event.key)?-1:1);if(next){selectScheme(next.id);for(const tab of $('schemeNav').querySelectorAll('[data-browse-scheme]'))if(tab.dataset.browseScheme===next.id)tab.focus();}});
$('openTargets').onclick=()=>{$('targetDetails').open=!$('targetDetails').open;if($('targetDetails').open)$('targetDetails').scrollIntoView({behavior:'smooth',block:'nearest'});};
$('targetDetails').ontoggle=()=>$('openTargets').setAttribute('aria-expanded',String($('targetDetails').open));
for(const [id,value] of [['compactGraph',true],['levelGraph',false]])$(id).onclick=()=>{graphOverview=value;for(const [button,on] of [['compactGraph',true],['levelGraph',false]]){$(button).classList.toggle('active',on===value);$(button).setAttribute('aria-pressed',String(on===value));}renderSelected();};

window.addEventListener('pagehide',saveCache);
window.ranchBeforeNavigate=async()=>{if(current&&!commitSlotInputs(false))throw Error('请先填写有效的四单交付数量。');if(model)validateRanchTarget(Object.fromEntries(Object.keys(readRanchTarget(savedSettings,level)).map(id=>[id,$(id).value])));persist();stop();saveCache();await cacheQueue;if(cacheSaveError)throw Error('排产结果尚未保存成功，请重试或先导出备份。');};
async function syncRanchView(){
  if(syncing)return;if(busy||$('ranchRulesDialog')?.open||document.activeElement?.matches?.('input,select')){syncQueued=true;return;}
  syncing=true;syncQueued=false;
  try{
    await cacheQueue;const source=ranchSource();if(!source?.base)return;
    if(!model||ranchSettingsKey(source.base)!==storageKey){install(source.base,source.filename,source.rules);return;}
    const latest=readRanchSettings(localStorage,storageKey);
    savedSettings=latest;persistedSettings=structuredClone(latest);restoreQuantityTargets();
    $('cropQuantity').value=latest.cropQuantity??DEFAULT_CROP_QUANTITY;$('productQuantity').value=latest.productQuantity??1;$('allowRepeated').checked=latest.allowRepeated??false;$('searchLimit').value=latest.searchLimit??'2000';
    capacities={...ranchCapacities(model,level),...(latest.capacities?.[level]??{})};renderCapacities();await rebuild(false,true);
  }catch(error){message(error.message);}finally{syncing=false;}
}
if(typeof document.addEventListener==='function'){
  watchRanchWorkspace(syncRanchView);
  document.addEventListener('focusout',()=>{if(syncQueued)setTimeout(syncRanchView,0);});
}
window.addEventListener('ranch:rules-applied',()=>{void syncRanchView();});
try{const source=ranchSource();if(source?.base)install(source.base,source.filename);else message('请导入加工链路 Excel，普通订单和牧场将共用此数据。');}catch(e){message(e.message);}
if(navigationRequest?.get('import')==='1'){$('empty').hidden=false;$('empty').scrollIntoView({block:'start'});}
