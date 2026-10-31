import {prepareConfigCellEdits} from './config-clipboard.js';
import {resultFeedback} from './fit-feedback.js';
import {toCSV,toJSON} from './export.js';
import {renderOrderItems,setupItemInfo} from './item-info.js';
import {halfHourStats,inTimeRange} from './time-bins.js';
import {applyProbabilityPrecision,PROBABILITY_SCALES} from './probability-precision.js';
import {probabilityFloorPlan} from './probability-floor.js';
import {buildCatalog,DEFAULT_RULES,levelInfo,availableAt,normalizedSourceWeights} from './order-engine.js';
import {normalizedMixWeights,mixWeightsIssue} from './mix-weights.js';
import {readChainExcel,initialSourceConfig} from './excel-import.js';
import {createAllLevelPanel} from './all-level-panel.js';
import {createLevelDashboard} from './level-dashboard.js';
import {spreadPercent,actualSpread,migrateSpread,setTimeTarget,spreadInterval} from './time-spread.js';
import {createProjectStore,PROJECT_STORAGE_KEY} from './project-storage.js';
import {migrateProjectPrecision,setProjectProbabilityScale} from './project-precision.js';
import {createOrderSimulator} from './order-simulator.js';
import {createGameMode} from './game-view.js';
import {coinValueCoverage} from './coin-values.js';
import {createOutcomeAnalysis,matchesOutcomeFilter} from './order-analysis-view.js';
import {fetchSharedSession,restoreSessionSnapshot} from './session-snapshot.js';
import {createSessionBackupView} from './session-backup-view.js';
import {normalizeCustomOrders,customOrdersAt} from './custom-orders.js';
import {createCustomOrdersView} from './custom-orders-view.js';
import {projectExportSheets,exportProjectWorkbook} from './project-export.js';
import {isPlaceholderProductName,productNameUpdates,applyProductNameUpdates} from './project-names.js';
import {createOrderTimingService} from './order-time.js';
import {createFitCache} from './fit-cache.js';
import {restoreMissingProjectMetadata,metadataSourceIssue,supplementProjectMetadata} from './project-metadata.js';
const $=id=>document.getElementById(id),fmt=(v,d=1)=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d}),pct=(v,d=2)=>fmt(v*100,d)+'%';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let project,catalog,result,worker,itemInfo,activeLevel=20,busy=false,dirty=true,page=0,selectedTimeRange=null,request=0,generation=0;
let allLevelPanel,levelDashboard,simulator,outcomeAnalysis,gameMode,customOrdersView;
function syncSimulators(){simulator?.sync();gameMode?.sync();}
let selectedOutcomeFilter=null;
let projectStore;
let nameSuggestion,nameRequest=0;
let orderTimingService;
const fitCache=createFitCache({onError:()=>{ $('projectStorageNotice').textContent='拟合结果未能保存到浏览器，请检查存储空间；当前页面结果仍可使用。';$('projectStorageNotice').hidden=false;}});
function orderTimings(){return orderTimingService??=createOrderTimingService({onChange:()=>{if(!$('customPanel').hidden)customOrdersView?.refreshTimings();}});}
const results=new Map(),errors=new Map(),infos=new Map(),jobs=new Map(),colors=['#75a28b','#3f8268','#244f40'];
const info=level=>{if(!infos.has(level))infos.set(level,levelInfo(catalog,level));return infos.get(level);};
const settings=()=>project.configs[activeLevel];
const revision=level=>project.configs[level].revision||0;
function notice(text,warn=false){$('notice').textContent=text;$('notice').className='notice'+(warn?' warn':'');}
function status(text,type='neutral'){$('status').textContent=text;$('status').className='status '+type;}
function persist(){try{projectStore?.save({...project,activeLevel});}catch(error){$('projectStorageNotice').textContent=error.message||'项目保存失败，请导出项目保存。';$('projectStorageNotice').hidden=false;}}
let metadataSuggestion;
function refreshMetadataSuggestion(){
  metadataSuggestion=null;const root=$('projectMetadataNotice');root.hidden=true;if(!project)return;
  const missingLands=Array.from({length:catalog.maxLevel},(_,i)=>i+1).filter(lv=>!(Number.isSafeInteger(project.base.landsByLevel?.[lv])&&project.base.landsByLevel[lv]>0)).length;
  const missingPrices=coinValueCoverage(project.base.products).missing;if(!missingLands&&!missingPrices)return;
  try{const source=JSON.parse(localStorage.getItem('ranch-source-v1')||'null');if(source?.kind==='import'){
    const update=supplementProjectMetadata(project.base,source.base,{metadataOnly:true});
    if(update)metadataSuggestion={...update,issue:metadataSourceIssue(project.base,source.base)};
  }}catch{}
  const suggestion=metadataSuggestion;
  $('projectMetadataText').textContent=suggestion?`缺少 ${missingLands} 级土地、${missingPrices} 个单价。可从牧场补齐${suggestion.issue?'（存在配方差异，仅补土地和单价，保留本项目配方）':''}。`:`缺少 ${missingLands} 级土地、${missingPrices} 个单价，请从同项目 Excel 补齐。`;
  $('projectMetadataUpdate').textContent=suggestion?'补齐土地与单价':'从 Excel 补齐';root.hidden=false;
}
function applyMetadata(update){
  if(busy)throw Error('请等待当前计算结束。');
  const next=buildCatalog(update.base,project.rules);
  if(next.orders.length!==catalog.orders.length||next.orders.some((o,i)=>o.id!==catalog.orders[i].id))throw Error('订单库发生变化，无法仅补齐基础信息。');
  localStorage.setItem('order-project-before-metadata-v1',JSON.stringify({...project,activeLevel}));
  projectStore.save({...project,base:update.base,activeLevel});
  gameMode?.releaseSession();project.base=update.base;catalog=next;infos.clear();generation++;setupWorker();itemInfo?.hide();
  itemInfo.products.clear();catalog.products.forEach(p=>itemInfo.products.set(p.id,p));
  const coverage=coinValueCoverage(catalog.products);$('catalogMeta').textContent=`${catalog.products.length} 商品 · ${catalog.sources.length} 来源 · 金币 ${coverage.priced}/${coverage.total}`;
  loadLevel(activeLevel);customOrdersView?.render();refreshMetadataSuggestion();$('batchProgress').textContent=`已补齐 ${update.lands} 级土地、${update.prices} 个单价`;
}
$('projectMetadataUpdate').onclick=()=>{try{if(metadataSuggestion)applyMetadata(metadataSuggestion);else $('projectMetadataFile').click();}catch(error){$('projectMetadataText').textContent=error.message;}};
$('projectMetadataFile').onchange=async()=>{
  const file=$('projectMetadataFile').files[0];if(!file)return;const target=project;
  try{const candidate=await readChainExcel(file);if(project!==target)throw Error('当前项目已变化，请重新选择。');const update=supplementProjectMetadata(project.base,candidate,{metadataOnly:true});if(!update)throw Error('没有可补齐的信息，或商品 ID、等级、建筑与本项目不符。');applyMetadata(update);}
  catch(error){$('projectMetadataText').textContent=error.message;}finally{$('projectMetadataFile').value='';}
};
async function refreshNameSuggestion(){
  const target=project,request=++nameRequest;nameSuggestion=null;$('projectNamesNotice').hidden=true;
  const count=target?.base.products.filter(p=>isPlaceholderProductName(p.name)).length??0;if(!count)return;
  const sources=[];
  try{const ranch=JSON.parse(localStorage.getItem('ranch-source-v1')||'null');if(ranch?.kind==='import')sources.push({base:ranch.base,label:'牧场订单'});}catch{}
  let suggested=sources.map(s=>({...s,updates:productNameUpdates(target.base,s.base)})).find(s=>s.updates.length);
  if(!suggested)try{const shared=await fetchSharedSession();if(shared){const updates=productNameUpdates(target.base,shared.project.base);if(updates.length)suggested={updates,label:'已同步配置'};}}catch{}
  if(request!==nameRequest||project!==target)return;
  nameSuggestion=suggested??null;
  $('projectNamesText').textContent=suggested?`${count} 个商品仍是占位名称，可按商品 ID 使用${suggested.label}中的正式名称。`:`${count} 个商品仍是占位名称，可选择当前加工链路 Excel 更新名称。`;
  $('projectNamesUpdate').textContent=suggested?'更新商品名称':'从 Excel 更新名称';$('projectNamesUpdate').disabled=busy;$('projectNamesNotice').hidden=false;
}
function updateProductNames(updates){
  if(busy)throw Error('请等待当前计算结束。');
  const base=applyProductNameUpdates(project.base,updates),next=buildCatalog(base,project.rules);
  if(next.orders.length!==catalog.orders.length||next.orders.some((o,i)=>o.id!==catalog.orders[i].id))throw Error('订单库发生变化，无法只更新名称。');
  projectStore.save({...project,base,activeLevel});
  gameMode?.releaseSession();project.base=base;catalog=next;infos.clear();generation++;setupWorker();itemInfo?.hide();
  itemInfo.products.clear();catalog.products.forEach(p=>itemInfo.products.set(p.id,p));
  loadLevel(activeLevel);$('batchProgress').textContent=`已更新 ${updates.length} 个商品名称`;void refreshNameSuggestion();
}
function showEmptyProject(message='导入加工链路 Excel 后开始配置订单'){
  $('emptyProject').hidden=false;$('emptyProjectMessage').textContent=message;
  document.querySelector('.project-toolbar').hidden=true;
  for(const id of ['levelWorkspace','dashboardPanel','overviewPanel','customPanel'])$(id).hidden=true;
  for(const id of ['solveAll','exportProject','toggleRules'])$(id).disabled=true;
  $('projectName').textContent='尚未导入项目';$('catalogMeta').textContent='';
  $('projectNamesNotice').hidden=true;
}
function fittedConfig(level){
  const c=project.configs[level],rawWeights=catalog.sources.map(s=>Number(c.weights[s.id]??1));
  return {level,rawMixWeights:[...c.mix],mix:normalizedMixWeights(c.mix,info(level).counts),mean:Number(c.mean),spreadPercent:spreadPercent(c),variance:Number(c.variance),sigma:Math.sqrt(Number(c.variance)),rawSourceWeights:rawWeights,shares:normalizedSourceWeights(rawWeights,info(level).active),sourceEnabled:c.sourceEnabled,shapeStrength:400,probabilityScale:project.probabilityScale,minimumOrderWeight:c.minimumOrderWeight};
}
function defaultConfig(level){
  const {orders,counts,active}=info(level),mix=[20,40,40].map((v,j)=>counts[j]?v:0),total=mix.reduce((a,b)=>a+b,0);
  if(total){let left=100;mix.forEach((v,j)=>{mix[j]=Math.round(v/total*100);left-=mix[j];});mix[mix.findIndex(v=>v>0)]+=left;}
  let mean=0,second=0;for(const o of orders){const p=mix[o.itemTypes-1]/100/counts[o.itemTypes-1];mean+=p*o.cumulativeMinutes;second+=p*o.cumulativeMinutes**2;}
  const c={mix,mean:Math.round(mean*100)/100,variance:Math.max(0,Math.round((second-mean*mean)*100)/100),...initialSourceConfig(catalog,level,active),minimumOrderWeight:true,revision:0};
  migrateSpread(c);project.configs[level]=c;return c;
}
function installBase(base,filename,keepConfigs=null){
  catalog=buildCatalog(base,keepConfigs?.rules||DEFAULT_RULES);infos.clear();results.clear();errors.clear();
  project={schemaVersion:'order-project-v3',origin:'excel-import',filename,base,rules:catalog.rules,configs:{},customOrders:normalizeCustomOrders(keepConfigs?.customOrders,catalog.maxLevel)};
  for(let level=1;level<=catalog.maxLevel;level++){defaultConfig(level);if(keepConfigs?.configs?.[level]){const saved=keepConfigs.configs[level];project.configs[level]={...project.configs[level],...saved,spreadPercent:spreadPercent(saved)};}}
  if(keepConfigs?.probabilityScale!=null)project.probabilityScale=keepConfigs.probabilityScale;
  migrateProjectPrecision(project);
  if(!keepConfigs)for(let level=1;level<=catalog.maxLevel;level++){
    const plan=probabilityFloorPlan(catalog,fittedConfig(level));
    if(!plan.feasible&&plan.recommendedScale)project.probabilityScale=Math.max(project.probabilityScale,plan.recommendedScale);
  }
  activeLevel=Math.min(catalog.maxLevel,Math.max(1,keepConfigs?.activeLevel||catalog.maxLevel));
  generation++;setupWorker();itemInfo?.hide();if(!itemInfo)itemInfo=setupItemInfo(catalog,document.querySelector('main'));else{
    // Recreate the delegated view only once; all later catalogs update its map.
    itemInfo.products.clear();catalog.products.forEach(p=>itemInfo.products.set(p.id,p));
  }
  const coinCoverage=coinValueCoverage(catalog.products);
  $('catalogMeta').textContent=`${catalog.products.length} 商品 · ${catalog.sources.length} 来源 · ${coinCoverage.priced?'金币 '+coinCoverage.priced+'/'+coinCoverage.total:'金币未导入'}`;
  $('projectName').textContent=filename;$('rangeFrom').max=$('rangeTo').max=catalog.maxLevel;$('rangeFrom').value=1;$('rangeTo').value=catalog.maxLevel;
  $('cropQuantity').value=project.rules.cropQuantity;$('productQuantity').value=project.rules.productQuantity;$('maxKinds').value=project.rules.maxKinds;
  $('singleLevelSelect').innerHTML=Array.from({length:catalog.maxLevel},(_,i)=>`<option value="${i+1}">Lv ${i+1}</option>`).join('');
  $('emptyProject').hidden=true;document.querySelector('.project-toolbar').hidden=false;$('exportProject').disabled=false;
  $('rulesPending').hidden=true;persist();loadLevel(activeLevel);void refreshNameSuggestion();refreshMetadataSuggestion();
}
function setupWorker(){
  worker?.terminate();for(const job of jobs.values())job.reject(Error('计算已取消'));jobs.clear();
  worker=new Worker('./worker.js',{type:'module'});worker.postMessage({type:'init',catalog});
  worker.onmessage=({data})=>{
    if(data.type==='ready')return;
    const job=jobs.get(data.request);if(!job)return;
    if(data.type==='progress'){$('batchProgress').textContent=`Lv ${job.level} · 迭代 ${data.iteration}`;return;}
    jobs.delete(data.request);data.type==='error'?job.reject(Error(data.message)):job.resolve(data.result);
  };
  worker.onerror=event=>{for(const job of jobs.values())job.reject(Error(event.message));jobs.clear();};
}
function markDirty(){
  const c=settings();c.revision=(c.revision||0)+1;errors.delete(activeLevel);dirty=true;clearDownload();persist();
  $('exportCSV').disabled=$('exportJSON').disabled=true;status('待更新');notice('参数已修改');updateMixRatios();updateSourceRatios();renderFloorHint();renderNavigation();renderOverview();syncSimulators();
}
function renderNavigation(){
  $('levelList').innerHTML=Array.from({length:catalog.maxLevel},(_,i)=>{
    const level=i+1,r=results.get(level),fresh=r?.revision===revision(level),state=errors.has(level)?'无法拟合':fresh?(r.result.matched?'目标达标':'近似解'):r?'待更新':'未计算';
    return `<button class="level-button${level===activeLevel?' active':''}" data-level="${level}" aria-pressed="${level===activeLevel}" ${busy?'disabled':''}><b>Lv ${level}</b><small>${info(level).goods} 商品 · ${info(level).orders.length.toLocaleString()} 单</small><span class="level-state${fresh&&r.result.matched?' good':''}">${state}</span></button>`;
  }).join('');
  $('levelList').querySelectorAll('button').forEach(button=>button.onclick=()=>loadLevel(Number(button.dataset.level)));
}
function loadLevel(level){
  activeLevel=level;$('singleLevelSelect').value=level;page=0;selectedTimeRange=null;selectedOutcomeFilter=null;itemInfo?.hide();
  const c=settings();$('levelTitle').textContent=`Lv ${level}`;$('poolHint').textContent=`${info(level).goods} 商品 · ${info(level).orders.length.toLocaleString()} 候选`;
  $('mean').value=c.mean;$('spreadPercent').value=Number(spreadPercent(c).toFixed(4));renderSpreadPreview();
  $('sourceEnabled').checked=c.sourceEnabled;$('minimumOrderWeight').checked=c.minimumOrderWeight;
  renderMix();renderSources();renderFloorHint();renderNavigation();renderOverview();
  const saved=results.get(level);result=errors.has(level)?null:saved?.result||null;dirty=!saved||saved.revision!==revision(level)||errors.has(level);
  if(result){renderResult();showResultStatus();}else clearResult();
  $('exportCSV').disabled=$('exportJSON').disabled=dirty||!result;persist();
}
function renderMix(){
  const counts=info(activeLevel).counts,c=settings();
  $('mixControls').innerHTML=c.mix.map((v,j)=>`<div class="source-weight mix-weight${counts[j]?'':' locked-source'}"><label for="mixNum${j}">${j+1} 种商品 <small>${counts[j].toLocaleString()} 单</small></label><input id="mixNum${j}" type="number" min="0" step="any" value="${v}" aria-label="${j+1}种商品权重" ${counts[j]?'':'disabled'}><output id="mixRatio${j}">—</output></div>`).join('');
  c.mix.forEach((_,j)=>$('mixNum'+j).oninput=event=>{c.mix[j]=Number(event.target.value);markDirty();});
  updateMixRatios();
}
function updateMixRatios(){
  if(!project)return;const counts=info(activeLevel).counts;
  normalizedMixWeights(settings().mix,counts).forEach((v,j)=>{const output=$('mixRatio'+j);if(output)output.textContent=counts[j]?fmt(v,2)+'%':'—';});
}
function renderSources(){
  const c=settings(),active=info(activeLevel).active;
  $('sourceControls').innerHTML=catalog.sources.map((s,j)=>`<div class="source-weight${active[j]?'':' locked-source'}"><label for="share${j}">${escape(s.name)}</label><input id="share${j}" aria-label="${escape(s.name)}来源权重" type="number" min="0" step="any" value="${c.weights[s.id]??1}" ${active[j]?'':'disabled'}><output id="shareRatio${j}">—</output></div>`).join('');
  catalog.sources.forEach((s,j)=>$('share'+j).oninput=()=>{c.weights[s.id]=Number($('share'+j).value);c.sourceEnabled=true;markDirty();});updateSourceRatios();
}
function updateSourceRatios(){
  if(!project)return;const c=fittedConfig(activeLevel);c.shares.forEach((v,j)=>{const element=$('shareRatio'+j);if(element)element.textContent=info(activeLevel).active[j]?fmt(v,2)+'%':'—';});
  $('shareSum').textContent=`权重合计 ${fmt(c.rawSourceWeights.reduce((s,v,j)=>s+(info(activeLevel).active[j]?v:0),0),2)}`;
  $('sourceEnabled').checked=c.sourceEnabled;$('sourceFitState').textContent=c.sourceEnabled?'已启用来源目标':'未启用 · 修改权重后自动启用';$('sourceFitState').className='source-fit-state'+(c.sourceEnabled?' enabled':'');
}
function renderFloorHint(){
  if(!project)return;const c=fittedConfig(activeLevel),plan=probabilityFloorPlan(catalog,c);
  $('probabilityScale').value=project.probabilityScale;$('probabilityScale').disabled=busy;
  $('probabilityScale').querySelector('option[value="0"]').disabled=Object.values(project.configs).some(c=>c.minimumOrderWeight);
  $('singlePrecisionHint').textContent=`全局精度：${$('probabilityScale').selectedOptions[0]?.textContent||''}`;
  $('precisionHint').textContent=c.probabilityScale?`最小概率 ${pct(1/c.probabilityScale,Math.max(0,Math.log10(c.probabilityScale)-2))}`:'原始连续精度';
  $('floorHint').textContent=c.minimumOrderWeight?(plan.feasible?`${plan.total.toLocaleString()} 单 · 保底 ${pct(plan.total/c.probabilityScale)}`:plan.reason):'';
  $('floorHint').className='hint'+(c.minimumOrderWeight&&!plan.feasible?' error-text':'');$('fixFloorPrecision').hidden=!c.minimumOrderWeight||plan.feasible||!plan.recommendedScale;
  $('fixFloorPrecision').textContent=plan.recommendedScale?`全局改用 ${plan.recommendedScale.toLocaleString()} 分制`:'';
}
function renderSpreadPreview(){const c=settings(),range=spreadInterval(c),baseline=info(activeLevel).uniformMean;$('uniformMeanValue').textContent=Number.isFinite(baseline)?fmt(baseline,2)+' 分钟':'—';$('spreadMagnitude').textContent=`分散幅度 ±${fmt(c.mean*spreadPercent(c)/100)} 分钟`;$('spreadPreview').textContent=`约 68% 的正态参考：${fmt(range[0])}～${fmt(range[1])} 分钟`;}
function validateConfig(c){
  if(!Number.isFinite(c.mean)||c.mean<=0||!Number.isFinite(c.spreadPercent)||c.spreadPercent<0||!Number.isFinite(c.variance)||c.variance<0)throw Error('均值必须大于 0，工时波动比例必须为非负数。');
  if(c.rawSourceWeights.some(v=>!Number.isFinite(v)||v<0))throw Error('来源权重必须是非负数。');
  if(c.sourceEnabled&&!c.shares.some(v=>v>0))throw Error('至少设置一个可用来源的正权重。');
  const mixIssue=mixWeightsIssue(c.rawMixWeights,info(c.level).counts);if(mixIssue)throw Error(mixIssue);
  if(!info(c.level).orders.length)throw Error('该等级没有符合排除规则的订单。');
}
function useFitResult(level,r,rev){
  results.set(level,{revision:rev,result:r});errors.delete(level);
  if(level===activeLevel){result=r;dirty=revision(level)!==rev;renderResult();showResultStatus();$('exportCSV').disabled=$('exportJSON').disabled=dirty;}
}
async function restoreFitResults(){
  const gen=generation;let count=0;
  for(let level=1;level<=catalog.maxLevel;level++){
    const c=fittedConfig(level),rev=revision(level),r=await fitCache.get(catalog,c);
    if(gen!==generation)return;
    if(r&&rev===revision(level)){useFitResult(level,r,rev);count++;}
  }
  if(!busy)setBusy(false);renderNavigation();renderOverview();$('batchProgress').textContent=count?`已读取 ${count} 级保存结果`:'尚无保存结果 · 点击拟合后自动保存';
}
async function computeLevel(level){
  const c=fittedConfig(level),rev=revision(level),gen=generation;validateConfig(c);
  const cached=await fitCache.get(catalog,c);
  if(gen!==generation||rev!==revision(level))throw Error('当前配置已改变，请重新操作。');
  if(cached){useFitResult(level,cached,rev);renderNavigation();renderOverview();return {result:cached,reused:true};}
  const id=++request;
  const raw=await new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject,level});worker.postMessage({type:'fit',config:c,request:id});});
  if(gen!==generation||rev!==revision(level))throw Error('当前配置已改变，请重新拟合。');
  if(raw.blocked)throw Error(raw.reason);
  const r=applyProbabilityPrecision(catalog,raw,c.probabilityScale);useFitResult(level,r,rev);
  await fitCache.save(catalog,c,r);
  renderNavigation();renderOverview();return {result:r,reused:false};
}
function setBusy(value){
  $('importFirstProject').disabled=value;
  $('singleLevelSelect').disabled=value;
  $('projectNamesUpdate').disabled=value;
  busy=value;$('solve').disabled=$('solveAll').disabled=$('importExcel').disabled=$('generateOrders').disabled=$('toggleRules').disabled=$('copyPrevious').disabled=$('applyRange').disabled=value;
  $('cancelFit').hidden=!value;
  document.querySelectorAll('.controls input,.controls select,#rulesPanel input,#rulesPanel select,#overviewPanel input,#overviewPanel select').forEach(e=>e.disabled=value);
  if(!project){showEmptyProject($('emptyProjectMessage').textContent);return;}
  if(!value){renderMix();renderSources();renderFloorHint();}
  renderNavigation();renderOverview();syncSimulators();
}
async function solve(all=false){
  if(busy||!project)return;setBusy(true);let failures=0,reused=0,computed=0;
  const levels=all?Array.from({length:catalog.maxLevel},(_,i)=>i+1):[activeLevel];
  for(const level of levels){
    if(!busy)break;$('batchProgress').textContent=`Lv ${level} / ${catalog.maxLevel}`;
    try{const outcome=await computeLevel(level);if(outcome.reused)reused++;else computed++;}catch(error){if(!busy)break;failures++;errors.set(level,error.message);if(level===activeLevel){result=null;clearResult();status('无法拟合','warn');notice(error.message,true);dirty=true;$('exportCSV').disabled=$('exportJSON').disabled=true;}}
  }
  setBusy(false);$('batchProgress').textContent=`复用 ${reused} 级 · 新拟合 ${computed} 级${failures?' · '+failures+' 级需调整':''}`;renderOverview();
}
function clearResult(){
  syncSimulators();
  status(errors.has(activeLevel)?'无法拟合':'未计算',errors.has(activeLevel)?'warn':'neutral');notice(errors.get(activeLevel)||'');
  outcomeAnalysis?.clear();
  $('chart').innerHTML='<div class="chart-placeholder">拟合后显示分布</div>';$('curveNote').textContent='';$('timeBands').innerHTML='';$('precisionReport').innerHTML='';$('mixResults').innerHTML='';$('fitDetails').innerHTML='';$('sourceResults').innerHTML='';$('sourceFitSummary').textContent='';drawHalfHourChart();renderTable();
}
function showResultStatus(){
  syncSimulators();
  if(!result)return;
  if(dirty){status('待更新','warn');notice('参数已修改，结果待更新。');}
  else if(result.matched){status('目标达标','good');notice('');}
  else{status('近似解','warn');notice(resultFeedback(result,catalog).join('\n'),true);}
}
function renderResult(){
  const r=result;$('weightColumn').textContent=r.probabilityScale?'生成权重（整数）':'相对权重';
  outcomeAnalysis.render(catalog,r,activeLevel);
  $('precisionReport').innerHTML=r.quantization?`总权重 <b>${r.probabilityScale.toLocaleString()}</b> · 非零 <b>${r.quantization.nonZeroOrders.toLocaleString()}</b> · 归零 <b>${r.quantization.zeroedOrders.toLocaleString()}</b>`:'原始连续精度';
  $('mixResults').innerHTML=r.actualMix.map((v,j)=>`<div class="mix-result"><div class="labels"><span>${j+1} 种商品</span><span>${fmt(r.config.mix[j],2)}% / ${pct(v)}</span></div><div class="bar"><span style="width:${v*100}%;background:${colors[j]}"></span></div></div>`).join('');
  $('fitDetails').innerHTML=[['平均工时 · 目标 / 实际',`${fmt(r.config.mean)} / ${fmt(r.mean)} 分钟`],['工时波动 · 目标 / 实际',`${fmt(spreadPercent(r.config),2)}% / ${fmt(actualSpread(r),2)}%`],['工时形态',r.shapeAssessment?.label||'—'],['等效均匀订单数',fmt(r.effectiveCount,0)],['最大单笔概率',pct(r.maxProbability,3)],['来源最大偏差',r.config.sourceEnabled?fmt(r.sourceError*100,2)+' 个百分点':'未约束'],['均值可达区间',`${fmt(r.minMean)}～${fmt(r.maxMean)} 分钟`],['迭代',r.iterations]].map(([a,b])=>`<div><dt>${a}</dt><dd>${escape(b)}</dd></div>`).join('');
  $('sourceResults').innerHTML=`<table class="compact-source-table"><thead><tr><th>来源</th><th>目标 %</th><th>实际 %</th><th title="实际减目标，单位为百分点">偏差</th></tr></thead><tbody>${catalog.sources.map((source,j)=>{const actual=r.shares[j]*100,target=r.config.shares[j],active=info(activeLevel).active[j],delta=actual-target,rounded=Math.abs(delta)<.005?0:delta;return `<tr class="${r.config.sourceEnabled&&Math.abs(delta)>1?'source-miss':''}"><th scope="row" title="${escape(source.name)}">${escape(source.name)}</th><td>${active&&r.config.sourceEnabled?fmt(target,2):'—'}</td><td class="source-actual" style="--share:${Math.max(0,Math.min(100,actual))}%">${active?fmt(actual,2):'—'}</td><td>${active&&r.config.sourceEnabled?(rounded>0?'+':'')+fmt(rounded,2):'—'}</td></tr>`;}).join('')}</tbody></table>`;
  $('sourceFitSummary').textContent=r.config.sourceEnabled?`已启用 · 最大偏差 ${fmt(r.sourceError*100,2)} 个百分点`:'未启用来源约束';
  drawChart();drawHalfHourChart();renderTable();
}
function orderProbabilityText(p){if(p==null)return '—';const scale=result?.probabilityScale;return scale?pct(p,Math.max(0,Math.log10(scale)-2)):p>0&&p<.000001?(p*100).toExponential(2)+'%':pct(p,5);}
function renderTable(){
  const search=$('search').value.trim(),positive=$('onlyPositive').checked;
  let list=catalog.orders.map((o,i)=>({o,p:result?.probabilities[i],weight:result?.integerWeights?.[i]})).filter(v=>availableAt(v.o,activeLevel)&&(!result||!positive||v.p>0)&&inTimeRange(v.o.cumulativeMinutes,selectedTimeRange)&&(!search||v.o.description.includes(search)||v.o.id.includes(search)));
  list=list.filter(({o})=>matchesOutcomeFilter(o,selectedOutcomeFilter,itemInfo.products));
  $('outcomeFilter').hidden=!selectedOutcomeFilter;$('outcomeFilterLabel').textContent=selectedOutcomeFilter?.label||'';
  const sort=$('sort').value,direction=$('sortDirection').value==='asc'?1:-1;list.sort((a,b)=>direction*(sort==='time'?a.o.cumulativeMinutes-b.o.cumulativeMinutes:sort==='complexity'?a.o.cumulativeComplexity-b.o.cumulativeComplexity:sort==='id'?a.o.id.localeCompare(b.o.id):(a.p||0)-(b.p||0)));
  const size=30,pages=Math.max(1,Math.ceil(list.length/size));page=Math.max(0,Math.min(page,pages-1));itemInfo.hide();
  $('orderRows').innerHTML=list.slice(page*size,(page+1)*size).map(({o,p,weight})=>`<tr><td>${escape(o.id)}</td><td>${renderOrderItems(o,itemInfo.products)}</td><td>${o.itemTypes}</td><td>${fmt(o.cumulativeMinutes,0)} 分钟</td><td>${o.cumulativeComplexity}</td><td>${orderProbabilityText(p)}</td><td>${weight==null?(p==null?'—':fmt(p*1e6,4)):fmt(weight,0)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">没有符合条件的订单</td></tr>';
  $('pageLabel').textContent=`${list.length.toLocaleString()} 单 · ${page+1} / ${pages}`;$('prev').disabled=page===0;$('next').disabled=page>=pages-1;$('tableHint').textContent=`Lv ${activeLevel}`;
  $('timeFilter').hidden=!selectedTimeRange;$('timeFilterLabel').textContent=selectedTimeRange?`${selectedTimeRange.start}～${selectedTimeRange.end} 分钟`:'';
}
function configIssue(level){const c=fittedConfig(level),mixIssue=mixWeightsIssue(c.rawMixWeights,info(level).counts);if(mixIssue)return {short:'种类权重需调整',message:mixIssue};
  try{validateConfig(c);}catch(error){return {short:'参数需调整',message:error.message};}
  const plan=probabilityFloorPlan(catalog,c);if(c.minimumOrderWeight&&!plan.feasible)return {short:'精度不足',message:plan.reason};return null;}
function renderDashboard(){
  if(!levelDashboard)levelDashboard=createLevelDashboard({getCatalog:()=>catalog,getConfig:level=>project.configs[level],getInfo:info,getResult:level=>results.get(level),getError:level=>errors.get(level),getIssue:configIssue,isBusy:()=>busy,onOpen:level=>{loadLevel(level);setView('levels');},onAdjust:openConfigLevel});
  levelDashboard.render();
}
function assignConfigField(c,key,value){
  if(key==='mean'||key==='spreadPercent')setTimeTarget(c,key,value);
  else if(key.startsWith('mix'))c.mix[Number(key.slice(3))]=value;
  else if(key.startsWith('weight')){c.weights[key.slice(6)]=value;c.sourceEnabled=true;}
  else c[key]=value;
}
function changeProjectPrecision(value){
  if(busy||!project||!setProjectProbabilityScale(project,value))return;
  errors.clear();clearDownload();persist();loadLevel(activeLevel);
  $('matrixMessage').textContent=`精度已应用全部 ${catalog.maxLevel} 级 · 需重新拟合`;
}
function pasteConfigCells(cells){
  if(busy)return;
  const allowed=new Set(['mix0','mix1','mix2','mean','spreadPercent',...catalog.sources.map(s=>'weight'+s.id)]);
  if(cells.some(cell=>!allowed.has(cell.key)))throw Error('粘贴包含不可填写的列。');
  const drafts=prepareConfigCellEdits(project.configs,cells,assignConfigField);
  if(!drafts.size)return;
  for(const [level,config] of drafts){project.configs[level]=config;errors.delete(level);}
  clearDownload();persist();loadLevel(activeLevel);
}
function fillConfigColumn(key,value,fromLevel){
  if(busy||!Number.isInteger(fromLevel)||fromLevel<1||fromLevel>catalog.maxLevel)return;let changed=0;
  for(let level=fromLevel;level<=catalog.maxLevel;level++){
    const c=project.configs[level],previous=key.startsWith('mix')?c.mix[Number(key.slice(3))]:key.startsWith('weight')?(c.weights[key.slice(6)]??1):c[key];
    if(previous===value&&(!key.startsWith('weight')||c.sourceEnabled))continue;
    assignConfigField(c,key,value);c.revision=(c.revision||0)+1;errors.delete(level);changed++;
  }
  if(changed){clearDownload();persist();loadLevel(activeLevel);}
}
function renderOverview(){
  if(!allLevelPanel)allLevelPanel=createAllLevelPanel({
    getCatalog:()=>catalog,getConfig:level=>project.configs[level],getInfo:info,getResult:level=>results.get(level),getError:level=>errors.get(level),isBusy:()=>busy,
    getIssue:configIssue,
    onEdit:(level,key,value)=>{if(busy)return;const c=project.configs[level];assignConfigField(c,key,value);if(key==='minimumOrderWeight')renderFloorHint();
      c.revision=(c.revision||0)+1;errors.delete(level);clearDownload();persist();
      if(level===activeLevel)loadLevel(level);else{renderNavigation();allLevelPanel.refreshReadouts();renderDashboard();}},
    onEditCells:pasteConfigCells,
    onFillColumn:fillConfigColumn,
    onAdjust:openConfigLevel,
    onSetAllSources:enabled=>{if(busy)return;let changed=0;for(let level=1;level<=catalog.maxLevel;level++){const c=project.configs[level];if(Boolean(c.sourceEnabled)===enabled)continue;c.sourceEnabled=enabled;c.revision=(c.revision||0)+1;errors.delete(level);changed++;}
      if(changed){clearDownload();persist();loadLevel(activeLevel);}$('matrixMessage').textContent=`已${enabled?'启用':'关闭'}全部 ${catalog.maxLevel} 级来源约束`;},
    onOpen:level=>{if(!busy){loadLevel(level);setView('levels');}}
  });
  allLevelPanel.render();renderDashboard();if(!$('customPanel').hidden)renderCustomOrders();
}
function openConfigLevel(level){
  setView('overview');
  const row=$('overviewRows').querySelector(`tr[data-level="${level}"]`);
  document.querySelectorAll('.config-problem-focus').forEach(el=>el.classList.remove('config-problem-focus'));
  if(row){row.classList.add('config-problem-focus');row.scrollIntoView({behavior:'smooth',block:'center'});}
}
function renderCustomOrders(){
  if(!customOrdersView)customOrdersView=createCustomOrdersView({getCatalog:()=>catalog,getSelection:()=>project.customOrders,getInfo:info,isBusy:()=>busy,getTiming:(order,level)=>orderTimings().get(catalog,order,level),ensureTimings:(orders,level)=>orderTimings().ensure(catalog,orders,level),onChange:next=>{
    projectStore.save({...project,customOrders:next,activeLevel});project.customOrders=next;
  }});
  customOrdersView.render();
}
function setView(view){
  for(const [id,key] of [['levelWorkspace','levels'],['overviewPanel','overview'],['dashboardPanel','dashboard'],['customPanel','custom']])$(id).hidden=view!==key;
  for(const [id,key] of [['viewLevels','levels'],['viewOverview','overview'],['viewDashboard','dashboard'],['viewCustom','custom']])$(id).classList.toggle('active',view===key);
  if(view==='custom')renderCustomOrders();
}
function applyCopy(from,to,sourceLevel=activeLevel){
  const source=structuredClone(project.configs[sourceLevel]);for(let level=from;level<=to;level++)if(level!==sourceLevel)project.configs[level]={...structuredClone(source),revision:revision(level)+1};persist();loadLevel(activeLevel);renderNavigation();renderOverview();notice(`已应用到 Lv ${from}～${to}`);
}
let downloadURL;
function clearDownload(){if(downloadURL){URL.revokeObjectURL(downloadURL);downloadURL=null;}$('downloadReady')?.remove();}
function download(text,name,type){clearDownload();downloadURL=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.id='downloadReady';a.href=downloadURL;a.download=name;a.className='text-button';a.textContent='保存 '+name;$('downloadAnchor').append(a);a.click();}
$('solve').onclick=()=>solve();$('solveAll').onclick=()=>solve(true);
$('cancelFit').onclick=()=>{busy=false;setupWorker();setBusy(false);$('batchProgress').textContent='已停止';};
$('viewLevels').onclick=()=>setView('levels');$('viewOverview').onclick=()=>setView('overview');
$('viewDashboard').onclick=()=>setView('dashboard');
$('viewCustom').onclick=()=>setView('custom');
$('singleLevelSelect').onchange=()=>{if(!busy)loadLevel(Number($('singleLevelSelect').value));};
$('toggleLevelControls').onclick=()=>{
  const expanded=$('singleLevelControls').hidden;
  $('singleLevelControls').hidden=!expanded;
  $('levelWorkspace').classList.toggle('controls-collapsed',!expanded);
  $('toggleLevelControls').setAttribute('aria-expanded',String(expanded));
  $('toggleLevelControlsLabel').textContent=expanded?'收起调参':'展开调参';
};
$('copyPrevious').onclick=()=>{if(activeLevel===1)return;const previous=structuredClone(project.configs[activeLevel-1]);project.configs[activeLevel]={...previous,revision:revision(activeLevel)+1};persist();loadLevel(activeLevel);};
$('applyRange').onclick=()=>{const from=Number($('rangeFrom').value),to=Number($('rangeTo').value);if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to>catalog.maxLevel||from>to){notice('请选择有效等级范围。',true);return;}applyCopy(from,to);};
for(const id of ['mean','spreadPercent'])$(id).oninput=()=>{setTimeTarget(settings(),id,Number($(id).value));renderSpreadPreview();markDirty();};
$('sourceEnabled').onchange=()=>{settings().sourceEnabled=$('sourceEnabled').checked;markDirty();};
$('probabilityScale').onchange=()=>changeProjectPrecision(Number($('probabilityScale').value));
$('minimumOrderWeight').onchange=()=>{settings().minimumOrderWeight=$('minimumOrderWeight').checked;markDirty();};
$('fixFloorPrecision').onclick=()=>{const plan=probabilityFloorPlan(catalog,fittedConfig(activeLevel));if(plan.recommendedScale)changeProjectPrecision(plan.recommendedScale);};
for(const id of ['search','sort','sortDirection','onlyPositive'])$(id).oninput=()=>{page=0;if(id==='onlyPositive')drawHalfHourChart();renderTable();};$('prev').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
$('binMetric').oninput=()=>drawHalfHourChart();$('clearTimeBin').onclick=$('clearTimeFilter').onclick=()=>{selectedTimeRange=null;page=0;drawHalfHourChart();renderTable();};
$('toggleRules').onclick=()=>{
  if(busy)return;
  $('cropQuantity').value=project.rules.cropQuantity;$('productQuantity').value=project.rules.productQuantity;$('maxKinds').value=project.rules.maxKinds;
  $('rulesPending').hidden=true;$('rulesError').hidden=true;$('rulesDialog').showModal();
};
$('closeRules').onclick=$('cancelRules').onclick=()=>$('rulesDialog').close();
$('rulesDialog').addEventListener('click',event=>{if(event.target!==$('rulesDialog'))return;const r=$('rulesDialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('rulesDialog').close();});
for(const id of ['cropQuantity','productQuantity','maxKinds'])$(id).oninput=()=>{$('rulesPending').hidden=false;};
$('rulesPanel').onsubmit=event=>{
  event.preventDefault();if(busy)return;
  try{const rules={...project.rules,cropQuantity:Number($('cropQuantity').value),productQuantity:Number($('productQuantity').value),maxKinds:Number($('maxKinds').value)},next=buildCatalog(project.base,rules);catalog=next;project.rules=rules;infos.clear();results.clear();errors.clear();
    for(let level=1;level<=catalog.maxLevel;level++)project.configs[level].revision++;
    itemInfo.products.clear();catalog.products.forEach(p=>itemInfo.products.set(p.id,p));generation++;setupWorker();persist();$('rulesPending').hidden=true;loadLevel(activeLevel);$('rulesDialog').close();$('batchProgress').textContent='订单规则已应用 · 需重新拟合';
  }catch(error){$('rulesError').textContent=error.message;$('rulesError').hidden=false;}
};
$('importExcel').onclick=()=>$('excelFile').click();
$('importFirstProject').onclick=()=>$('excelFile').click();
$('projectNamesUpdate').onclick=()=>{try{if(nameSuggestion)updateProductNames(nameSuggestion.updates);else $('projectNamesFile').click();}catch(error){$('projectNamesText').textContent=error.message;}};
$('projectNamesFile').onchange=async()=>{
  const file=$('projectNamesFile').files[0];if(!file)return;const target=project;
  try{const base=await readChainExcel(file);if(project!==target)throw Error('当前项目已变化，请重新选择。');const updates=productNameUpdates(project.base,base);if(!updates.length)throw Error('未找到可对应的正式名称，请检查商品 ID、等级和所属建筑是否一致。');updateProductNames(updates);}
  catch(error){$('projectNamesText').textContent=error.message;}finally{$('projectNamesFile').value='';}
};
$('excelFile').onchange=async()=>{
  const file=$('excelFile').files[0];if(!file)return;setBusy(true);$('cancelFit').hidden=true;$('batchProgress').textContent='读取 Excel…';
  try{const base=await readChainExcel(file);if(projectStore)projectStore.acceptLatest();else projectStore=createProjectStore(localStorage);$('projectStorageNotice').hidden=true;const keep=project&&JSON.stringify(project.base.products.map(p=>p.id).sort((a,b)=>a-b))===JSON.stringify(base.products.map(p=>p.id).sort((a,b)=>a-b))?project:null;installBase(base,file.name,keep);setView('overview');await restoreFitResults();const coins=coinValueCoverage(base.products);$('batchProgress').textContent=`已导入 ${base.products.length} 种商品 · 金币 ${coins.priced}/${coins.total}`;}catch(error){if(project){notice(error.message,true);$('batchProgress').textContent='导入失败';}else showEmptyProject(error.message);}finally{setBusy(false);$('excelFile').value='';}
};
$('exportCSV').onclick=()=>{if(result&&!dirty)download(toCSV(catalog,result),`订单权重_Lv${activeLevel}.csv`,'text/csv;charset=utf-8');};
$('exportJSON').onclick=()=>{if(result&&!dirty)download(toJSON(catalog,result),`订单权重_Lv${activeLevel}.json`,'application/json');};
function exportLevels(){return Array.from({length:catalog.maxLevel},(_,i)=>{const level=i+1,saved=results.get(level),fresh=saved?.revision===revision(level);return {level,rawSettings:project.configs[level],normalizedTargets:fittedConfig(level),status:fresh?(saved.result.matched?'matched':'approximate'):errors.has(level)?'blocked':'not_fitted',error:errors.get(level)||null,fit:fresh?JSON.parse(toJSON(catalog,saved.result)):null};});}
function customTimingRequests(){return Array.from({length:catalog.maxLevel},(_,i)=>customOrdersAt(catalog,project.customOrders,i+1).flatMap(e=>e.order?[{order:e.order,level:i+1}]:[])).flat();}
$('exportProject').onclick=()=>{
  if(!project)return;
  const fitted=[...results].filter(([level,saved])=>saved.revision===revision(level)).length,count=Object.values(project.customOrders.levels).reduce((s,ids)=>s+ids.length,0);
  $('projectExportSummary').textContent=`${fitted} / ${catalog.maxLevel} 级概率结果有效 · ${count} 个定制任务。未拟合或待更新等级见“等级配置”表。`;
  $('projectExportError').hidden=true;$('projectExportDialog').showModal();
};
$('closeProjectExport').onclick=()=>$('projectExportDialog').close();
$('exportProjectJSON').onclick=()=>{
  const levels=exportLevels().map(row=>({...row,customTasks:customOrdersAt(catalog,project.customOrders,row.level)}));
  download(JSON.stringify({schemaVersion:'order-project-export-v3',probabilityScale:project.probabilityScale,filename:project.filename,source:catalog.source,rules:project.rules,coinValues:coinValueCoverage(catalog.products),products:catalog.products,sources:catalog.sources,customOrders:project.customOrders,levels},null,2),'逐级订单配置.json','application/json');
};
$('exportWorkbook').onclick=async()=>{
  $('exportWorkbook').disabled=$('exportProjectJSON').disabled=true;$('projectExportError').hidden=true;
  try{const target=project,gen=generation,selection=JSON.stringify(project.customOrders);await orderTimings().waitFor(catalog,customTimingRequests());if(project!==target||generation!==gen||JSON.stringify(project.customOrders)!==selection)throw Error('当前项目或定制清单已变化，请重新导出。');const sheets=projectExportSheets(catalog,project,exportLevels(),(order,level)=>orderTimings().get(catalog,order,level)),bytes=await exportProjectWorkbook(sheets);download(bytes,'普通订单_概率与定制.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}
  catch(error){$('projectExportError').textContent=error.message;$('projectExportError').hidden=false;}
  finally{$('exportWorkbook').disabled=$('exportProjectJSON').disabled=false;}
};
async function init(){
  try{projectStore=createProjectStore(localStorage);let saved=projectStore.load();
    if(!saved){
      const shared=await fetchSharedSession();
      if(shared){restoreSessionSnapshot(localStorage,shared);projectStore=createProjectStore(localStorage);saved=projectStore.load();}
    }
    if(!saved){
      if(new URLSearchParams(location.search).get('project')==='current'){
        const response=await fetch('../current-design.xlsx');if(!response.ok)throw Error('当前数值表读取失败');
        const base=await readChainExcel(new File([await response.blob()],'当前加工链路数值表.xlsx'));installBase(base,'当前加工链路数值表.xlsx');setView('dashboard');await restoreFitResults();return;
      }
      showEmptyProject();return;
    }
    const repaired=restoreMissingProjectMetadata(saved,localStorage);if(repaired)saved=repaired.project;
    installBase(saved.base,saved.filename,saved);
    if(repaired)$('batchProgress').textContent=`已从同配方牧场项目补齐 ${repaired.lands} 级土地、${repaired.prices} 个金币单价`;
    setView(new URLSearchParams(location.search).get('view')==='custom'?'custom':'dashboard');await restoreFitResults();
  }catch(error){showEmptyProject(error.message);}
}
window.addEventListener('storage',event=>{if(event.key===PROJECT_STORAGE_KEY){$('projectStorageNotice').textContent='另一个页面已更新项目，请刷新后继续。';$('projectStorageNotice').hidden=false;}});
$('clearOutcomeFilter').onclick=()=>{selectedOutcomeFilter=null;page=0;renderTable();};
$('showNormalTarget').onchange=()=>{if(result)drawChart();};
outcomeAnalysis=createOutcomeAnalysis(filter=>{selectedOutcomeFilter=filter;selectedTimeRange=null;$('search').value='';page=0;drawHalfHourChart();renderTable();$('ordersPanel').scrollIntoView({behavior:'smooth',block:'start'});});
simulator=createOrderSimulator({getState:()=>({catalog,result,level:activeLevel,valid:Boolean(result)&&!dirty&&!busy}),hideItemInfo:()=>itemInfo?.hide()});
gameMode=createGameMode({getState:()=>({catalog,result,level:activeLevel,filename:project?.filename,valid:Boolean(result)&&!dirty&&!busy}),hideItemInfo:()=>itemInfo?.hide(),onError:message=>notice(message,true)});
createSessionBackupView({
  getProject:()=>project?{...project,activeLevel}:null,download,
  restore:async snapshot=>{
    if(busy)throw Error('请先等待拟合结束。');
    gameMode.releaseSession();restoreSessionSnapshot(localStorage,snapshot,{overwrite:true});
    projectStore=createProjectStore(localStorage);const saved=projectStore.load();installBase(saved.base,saved.filename,saved);setView('dashboard');await restoreFitResults();
  }
});
init();

function drawTimeBands(r){
  const s=r.shapeAssessment,root=$('timeBands');
  if(!s){root.innerHTML='';return;}
  const lower=fmt(s.lower),upper=fmt(s.upper),zeroWidth=Math.abs(s.upper-s.lower)<1e-9;
  const ranges=[`< ${lower} 分钟`,zeroWidth?`= ${lower} 分钟`:`${lower}～${upper} 分钟`,`> ${upper} 分钟`];
  const names=['短单','中段','长单'],classes=['short','middle','long'];
  const bandLabel=j=>`${names[j]}：${ranges[j]}，${pct(s.bands[j],1)}`;
  root.innerHTML=`<div class="time-band-heading"><span title="以目标均值减、加一个标准差划分；中段包含两个边界">短中长构成</span><span>${escape(s.label)}</span></div><div class="time-band-stack" role="img" aria-label="${escape(names.map((_,j)=>bandLabel(j)).join('；'))}">${s.bands.map((p,j)=>p>0?`<span class="${classes[j]}" style="width:${p*100}%" title="${escape(bandLabel(j))}"></span>`:'').join('')}</div><div class="time-band-legend">${s.bands.map((p,j)=>`<div><span><i class="${classes[j]}" aria-hidden="true"></i>${names[j]} <b>${pct(p,1)}</b></span><small title="${j===1?'包含区间边界':''}">${escape(ranges[j])}</small></div>`).join('')}</div>`;
}
function drawChart(){const r=result,W=650,H=260,p={l:64,r:20,t:24,b:42},w=W-p.l-p.r,h=H-p.t-p.b;
  const edges=r.ref.edges,lo=edges[0],hi=edges.at(-1),x=t=>p.l+(t-lo)/(hi-lo)*w;
  const singleTime=r.shapeAssessment?.state==='single',zeroSpread=r.config.sigma===0;
  $('showNormalTarget').disabled=singleTime||zeroSpread;
  const actual=r.hist.map((v,j)=>v/(edges[j+1]-edges[j])),target=r.ref.probs.map((v,j)=>v/(edges[j+1]-edges[j])),showTarget=$('showNormalTarget').checked&&!singleTime&&!zeroSpread,max=Math.max(...actual,...(showTarget?target:[]),.000001)*1.2;
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="订单累计工时概率分布"><title>累计工时概率分布</title>`;
  svg+='<text x="64" y="12" fill="#718076" font-size="10">概率密度 / % 每分钟</text>';
  for(let i=0;i<=4;i++){const y=p.t+h-h*i/4;svg+=`<line x1="${p.l}" y1="${y}" x2="${W-p.r}" y2="${y}" stroke="#e6ece5"/><text x="${p.l-9}" y="${y+4}" text-anchor="end" fill="#718076" font-size="11">${fmt(max*i/4*100,3)}</text>`;}
  for(let b=0;b<r.hist.length;b++){const y=p.t+h-actual[b]/max*h,bw=x(edges[b+1])-x(edges[b]);svg+=`<rect x="${x(edges[b])+.4}" y="${y}" width="${Math.max(.1,bw-.8)}" height="${p.t+h-y}" fill="#56997b" opacity=".73"><title>${fmt(r.ref.edges[b],0)}～${fmt(r.ref.edges[b+1],0)} 分钟：实际 ${pct(r.hist[b])}${showTarget?'，正态参考 '+pct(r.ref.probs[b]):''}</title></rect>`;}
  const points=target.map((v,j)=>`${x((edges[j]+edges[j+1])/2)},${p.t+h-v/max*h}`).join(' ');if(showTarget)svg+=`<polyline points="${points}" fill="none" stroke="#b27a34" stroke-width="2.6"/>`;
  for(let j=0;j<=5;j++){const x=p.l+w*j/5,t=r.ref.edges[0]+(r.ref.edges.at(-1)-r.ref.edges[0])*j/5;svg+=`<text x="${x}" y="${H-20}" text-anchor="middle" fill="#718076" font-size="11">${fmt(t,0)}</text>`;}
  svg+=`<text x="${W-20}" y="${H-2}" text-anchor="end" fill="#718076" font-size="10">累计工时 / 分钟</text></svg>`;$('chart').innerHTML=svg;
  const t=outcomeAnalysis.getSummary()?.stats.time;$('curveNote').textContent=t?`平均 ${fmt(t.mean)} · 中位数 ${fmt(t.p50)} · 最小 ${fmt(t.min,0)} · 最大 ${fmt(t.max,0)} 分钟`:'';
  drawTimeBands(r);
}
function drawHalfHourChartData(){
  const bins=halfHourStats(catalog,result,$('onlyPositive').checked),isCount=$('binMetric').value==='count';
  const max=Math.max(...bins.map(b=>isCount?b.count:b.probability),isCount?1:.0001),totalCount=bins.reduce((s,b)=>s+b.count,0);
  $('binScope').textContent=`Lv ${activeLevel} · ${totalCount.toLocaleString()} 单`;
  $('binScale').innerHTML=[max,max*.75,max*.5,max*.25,0].map(v=>`<span>${isCount?fmt(v,0):pct(v,1)}</span>`).join('');
  $('halfHourBars').style.minWidth=Math.max(700,bins.length*22)+'px';
  $('halfHourBars').innerHTML=bins.map((b,j)=>{
    const active=selectedTimeRange?.start===b.start,zero=b.count===0,label=`累计时间 ${b.start} 至 ${b.end} 分钟，${b.count} 种订单，生成概率 ${pct(b.probability,3)}`;
    return `<button type="button" class="half-hour-bin${active?' selected':''}${zero?' no-orders':''}" data-start="${b.start}" aria-label="${label}" aria-pressed="${active}" title="${label}"><span class="bin-fill" style="height:${Math.max(0,(isCount?b.count:b.probability)/max*100)}%"></span>${j%6===0?`<span class="bin-tick">${b.start}</span>`:''}</button>`;
  }).join('');
  $('halfHourBars').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
    const start=Number(button.dataset.start);selectedTimeRange={start,end:start+30};page=0;drawHalfHourChart();renderTable();$('ordersPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }));
  const selected=bins.find(b=>b.start===selectedTimeRange?.start);
  $('binSelection').textContent=selectedTimeRange?`${selectedTimeRange.start}～${selectedTimeRange.end} 分钟 · ${selected?.count||0} 种订单 · 总生成概率 ${pct(selected?.probability||0,3)}`:'点击柱形，查看对应半小时内的订单。';
  $('clearTimeBin').hidden=!selectedTimeRange;
}

function drawHalfHourChart(){const current=result,positive=$('onlyPositive').checked;if(!current){result={config:{level:activeLevel},probabilities:catalog.orders.map(()=>0)};$('onlyPositive').checked=false;}drawHalfHourChartData();if(!current){result=null;$('onlyPositive').checked=positive;}}
