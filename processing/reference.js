'use strict';
let taoReference=null;
const phaseState={stage:1,scope:'new',population:'design',stat:'max',open:true,selected:false};
const phaseMetrics=[['batchMinutes','单步时间','min'],['cumulative','累计时间','min'],['optimized','优化时间','min'],['emptyWait','空仓等待','min'],['depth','链深度','层'],['singleComplexity','单步复杂度','种'],['complexity','累计复杂度','种']];
const statNames={max:'最大值',min:'最小值',mean:'平均数',median:'中位数'};
const populationNames={design:'设计参考（1–5级不含鸡肉）',noAnimal:'作物＋无畜牧加工',processing:'作物＋全部加工',all:'全部商品'};
const phaseBaseRender=render,phaseBaseMatrix=unitMatrix;
render=function(force=false){const x=window.scrollX,y=window.scrollY;phaseBaseRender(force);if(model&&!pendingRender){renderPhaseReference();updateGoalAudit()}if(window.scrollX!==x||window.scrollY!==y)window.scrollTo({left:x,top:y,behavior:'instant'})};
unitMatrix=function(targets){phaseBaseMatrix(targets);insertTimeReferences(targets)};
function selectedPhase(){return ChainStageStats.stages[phaseState.stage-1]}
function highlightPhaseColumns(){
  const table=$('dataTable');if(!['main','load'].includes(view)||!table)return;
  const targets=filtered(),selected=new Set(phaseState.selected?ChainStageStats.cohort(targets,selectedPhase(),phaseState.scope).map(p=>p.id):[]);
  for(const row of table.rows)for(let index=1;index<row.cells.length;index++)row.cells[index].classList.toggle('phase-column-highlight',selected.has(targets[index-1]?.id));
}
function selectPhase(stageId){
  phaseState.selected=phaseState.stage!==stageId||!phaseState.selected;
  phaseState.stage=stageId;renderPhaseReference();
}
function referenceCohort(stage=selectedPhase(),population=phaseState.population){const rows=population==='design'?taoReference.products.filter(p=>stage.end>5||p.name!=='鸡肉'):ChainStageStats.referenceRows(taoReference.products,population);return ChainStageStats.cohort(rows,stage,phaseState.scope)}
function designCohort(stage=selectedPhase()){return ChainStageStats.cohort(model.products,stage,phaseState.scope)}
function phaseDesignValue(p,key){
  if(key==='batchMinutes')return p.time;
  if(error||recipeBlocked.has(p.id)||!M(p.id))return null;
  if(key==='cumulative')return M(p.id).work;
  if(key==='depth')return M(p.id).depth;
  if(key==='singleComplexity')return M(p.id).R;
  if(key==='complexity')return M(p.id).K;
  const schedule=fresh(p.id)?A(p.id)?.schedule_at_unlock:null;
  if(!schedule?.is_proven_optimal)return null;
  return key==='optimized'?schedule.optimal_minutes:schedule.optimal_minutes-p.time;
}
function phaseValueCell(rows,key,isReference){
  const values=rows.map(p=>isReference?p[key]:phaseDesignValue(p,key)),result=ChainStageStats.aggregate(values,phaseState.stat);
  if(result!==null)return withUnit(result,phaseMetrics.find(([k])=>k===key)[2]);
  if(!rows.length)return '—';
  if(!isReference&&rows.some(p=>recipeBlocked.has(p.id)))return `<span class="pending recipe-blocked">配方待设计<small>${rows.filter(p=>recipeBlocked.has(p.id)).length}/${rows.length} 待调整</small></span>`;
  if(!isReference&&(key==='optimized'||key==='emptyWait')){
    const valid=values.filter(v=>v!==null).length,unproven=rows.some(p=>fresh(p.id)&&!A(p.id)?.schedule_at_unlock?.is_proven_optimal);
    return `<span class="pending">${unproven?'未证最优':'待重算'}<small>${valid}/${rows.length} 已就绪</small></span>`;
  }
  return '—';
}
function phaseDifference(actual,expected,unit,label){
  if(actual===null||expected===null)return '';
  const delta=Number((actual-expected).toFixed(8)),tone=delta>0?'higher':delta<0?'lower':'equal',text=(delta>0?'+':'')+fmt(delta);
  const description=`较阶段预期${label}差值 ${text} ${unit}（当前值 − 预期 ${fmt(expected)} ${unit}）`;
  return `<small class="phase-inline-delta ${tone}" title="${esc(description)}" aria-label="${esc(description)}">${text}<span class="value-unit">${unit}</span></small>`;
}
function phaseOwnValue(own,key){
  const goal=stageGoals[selectedPhase().id-1],fields={cumulative:'workMax',optimized:'optimalMax',emptyWait:'waitMax',depth:'depthMax',singleComplexity:'directMax',complexity:'distinctMax'},lower=key==='batchMinutes'&&phaseState.stat==='min';
  const actual=ChainStageStats.aggregate(own.map(p=>phaseDesignValue(p,key)),phaseState.stat),baseline=goal[key==='batchMinutes'?(lower?'stepMin':'stepMax'):fields[key]];
  const [,,unit]=phaseMetrics.find(([k])=>k===key),label=phaseMetrics.find(([k])=>k===key)[1]+(lower?'下限':'上限');
  return `<span class="phase-actual-value">${phaseValueCell(own,key,false)}</span>`+phaseDifference(actual,baseline,unit,label);
}
function phaseGoalRow(stage){
  const goal=stageGoals[stage.id-1],fields={cumulative:'workMax',optimized:'optimalMax',emptyWait:'waitMax',depth:'depthMax',singleComplexity:'directMax',complexity:'distinctMax'};
  const note=`${stage.label}本段新增作物＋加工品的预期范围及上限；不随汇总方式或桃源参考筛选变化`;
  return `<tr class="phase-goals" title="${esc(note)}"><th>阶段预期${phaseState.scope==='unlocked'?'<small>本段新增</small>':''}</th><td data-phase-goal="count">≤${withUnit(goal.count,'种')}</td>${phaseMetrics.map(([key,,unit])=>`<td data-phase-goal="${key}">${key==='batchMinutes'?`${fmt(goal.stepMin)}–${withUnit(goal.stepMax,unit)}`:`≤${withUnit(goal[fields[key]],unit)}`}</td>`).join('')}</tr>`;
}
function renderPhaseReference(){
  const panel=$('phaseReference');panel.hidden=false;
  if(!taoReference){panel.innerHTML='<div class="phase-heading">正在读取桃源阶段参考…</div>';return}
  const stage=selectedPhase(),own=designCohort(),ref=referenceCohort();
  const rangeLabel=phaseState.scope==='new'?`${stage.start}–${stage.end}级新增`:`1–${stage.end}级已解锁`;
  const context=`阶段末：${model.lands_by_level[stage.end]}片土地 · ${model.products.filter(p=>!p.building&&p.level<=stage.end).length}种作物 · ${model.buildings.filter(b=>b.level<=stage.end).length}座建筑`;
  let html=`<div class="phase-heading"><button id="phaseFold" class="text-button" aria-expanded="${phaseState.open}">${phaseState.open?'▾':'▸'} 阶段整体对照</button><span>${stage.label}</span><button id="phaseSource" class="text-button" aria-label="桃源参考来源" title="桃源快照 ${esc(taoReference.source.snapshot)} · 计算口径">ⓘ</button></div>`;
  if(!phaseState.open){syncMarkup(panel,html);highlightPhaseColumns();return}
  html+=`<div class="phase-controls"><div class="phase-tabs">${ChainStageStats.stages.map(s=>`<button data-phase="${s.id}" class="${phaseState.selected&&s.id===stage.id?'active':''}" aria-pressed="${phaseState.selected&&s.id===stage.id}" title="点击突出对应等级列，再次点击取消">${s.label}</button>`).join('')}</div><div class="phase-options"><select id="phaseScope" aria-label="阶段统计范围"><option value="new" ${phaseState.scope==='new'?'selected':''}>本段新增</option><option value="unlocked" ${phaseState.scope==='unlocked'?'selected':''}>段末已解锁</option></select><select id="phasePopulation" aria-label="桃源参考商品范围">${Object.entries(populationNames).map(([k,v])=>`<option value="${k}" ${phaseState.population===k?'selected':''}>${v}</option>`).join('')}</select><select id="phaseStat" aria-label="阶段汇总方式">${Object.entries(statNames).map(([k,v])=>`<option value="${k}" ${phaseState.stat===k?'selected':''}>${v}</option>`).join('')}</select><button id="phaseItems" class="text-button">查看参考商品 ↗</button></div></div><div class="phase-table-scroll"><table class="phase-table"><thead><tr><th>${rangeLabel}</th><th title="作物＋加工品，与本行指标使用同一统计范围">样本数</th>${phaseMetrics.map(([k,name,unit])=>`<th>${name}<span class="metric-stat">${statNames[phaseState.stat]}</span></th>`).join('')}</tr></thead><tbody><tr><th>本方案</th><td data-phase-count="own"><span class="phase-actual-value">${withUnit(own.length,'种')}</span>${phaseDifference(own.length,stageGoals[stage.id-1].count,'种','样本数上限')}</td>${phaseMetrics.map(([k])=>`<td data-phase-own="${k}">${phaseOwnValue(own,k)}</td>`).join('')}</tr>${phaseGoalRow(stage)}<tr><th>桃源参考</th><td data-phase-count="reference">${withUnit(ref.length,'种')}</td>${phaseMetrics.map(([k])=>`<td data-phase-tao="${k}">${phaseValueCell(ref,k,true)}</td>`).join('')}</tr></tbody></table></div><div class="phase-foot"><span>${context}</span></div>`;
  syncMarkup(panel,html);highlightPhaseColumns();
}
function timeReferenceRows(p){
  const stage=ChainStageStats.stageFor(p.level);
  const candidates=taoReference.products.filter(r=>p.building?(r.category==='加工'&&(phaseState.population!=='noAnimal'||r.noAnimalChain)):r.category==='田地');
  return ChainStageStats.cohort(candidates,stage,phaseState.scope);
}
function insertTimeReferences(targets){
  if(!taoReference||!targets.length||view!=='main')return;
  const existing=$('dataTable').querySelector('.tao-time-row');
  const row=`<tr class="tao-time-row"><td class="product-col">桃源时间参考<small>${phaseState.scope==='new'?'同阶段新增':'阶段末已解锁'}</small></td>${targets.map((p,j)=>{const refs=timeReferenceRows(p),times=refs.map(r=>r.batchMinutes),low=ChainStageStats.aggregate(times,'min'),high=ChainStageStats.aggregate(times,'max'),median=ChainStageStats.aggregate(times,'median');return `<td class="${j&&targets[j-1].building!==p.building?'group-left':''}"><button data-time-reference="${p.id}" title="${ChainStageStats.stageFor(p.level).label} ${p.building?'加工品':'田地作物'}；点击查看商品">${low===null?'暂无参考':low===high?withUnit(low):`${fmt(low)}–${withUnit(high)}`}<small>${low===null?'':`中位 ${withUnit(median)}`}</small></button></td>`}).join('')}</tr>`;
  if(existing){const temp=document.createElement('tbody');temp.innerHTML=row;syncMarkup(existing,temp.firstElementChild.innerHTML)}else $('dataTable').querySelector('.time-row')?.insertAdjacentHTML('afterend',row);
}
function showReferenceItems(title,rows){
  $('referenceDialogTitle').textContent=title;
  $('referenceDialogBody').innerHTML=`<p class="ref-dialog-note">${rows.length}个商品 · 只读参考；数值不自动写入方案</p><div class="ref-dialog-scroll"><table class="ref-products"><thead><tr><th>商品</th><th>等级</th><th>建筑</th>${phaseMetrics.map(([k,n,u])=>`<th>${n}</th>`).join('')}</tr></thead><tbody>${[...rows].sort((a,b)=>a.level-b.level||a.batchMinutes-b.batchMinutes).map(p=>`<tr><th>${esc(p.name)}</th><td>${p.level}</td><td>${esc(p.buildingName)}</td>${phaseMetrics.map(([k,,u])=>`<td>${withUnit(p[k],u)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  $('referenceDialog').showModal();
}
function showReferenceSource(){
  $('referenceDialogTitle').textContent='桃源参考 · 计算口径';
  $('referenceDialogBody').innerHTML=`<p>配置快照：${esc(taoReference.source.snapshot)} · 前20级46种永久商品</p><table class="definitions"><tbody><tr><th>默认样本</th><td>田地作物＋加工品；排除饲料、畜牧及其依赖链。样本数与本行指标使用同一范围。作物时间行另用田地作物比较。</td></tr><tr><th>阶段</th><td>每5级一段；“新增”仅本段解锁，“已解锁”含此前商品。</td></tr><tr><th>统计</th><td>每种商品权重相同；平均数不是订单需求加权。无样本不填0。</td></tr><tr><th>优化时间</th><td>两侧分别按本品解锁时的土地/产位计算；本方案加工建筑各1工位。桃源常规田地用当级配置上限；木材、青竹、原始土各30min、各6产位。</td></tr><tr><th>完整加工样本</th><td>包含饲料真实10min产3份及畜牧依赖；用整批工时，不用单件摊薄。用于原游戏对照，不修改本方案每次产1件的规则。</td></tr><tr><th>读法</th><td>角标为当前值减阶段预期值，桃源参考仅独立展示；单步最小值对照预期下限，其余统计对照对应预期上限。优化未证最优或未更新时，不生成该指标汇总。</td></tr></tbody></table><details><summary>字段定义与来源</summary><table class="definitions"><tbody>${taoReference.definitions.map(([n,t])=>`<tr><th>${esc(n)}</th><td>${esc(t)}</td></tr>`).join('')}</tbody></table><p class="reference-path">配置：${esc(taoReference.source.file)}<br>指标：${esc(taoReference.sourceMetricsFile)}<br>SHA256：${esc(taoReference.source.sha256)}</p></details>`;
  $('referenceDialog').showModal();
}
document.addEventListener('click',event=>{
  const e=event.target.closest('button');if(!e)return;
  if(e.id==='phaseFold'){phaseState.open=!phaseState.open;renderPhaseReference()}
  else if(e.dataset.phase)selectPhase(Number(e.dataset.phase));
  else if(e.id==='phaseSource')showReferenceSource();
  else if(e.id==='phaseItems')showReferenceItems(`${selectedPhase().label} · ${populationNames[phaseState.population]} · ${phaseState.scope==='new'?'新增':'已解锁'}`,referenceCohort());
  else if(e.dataset.timeReference){const p=P(e.dataset.timeReference);showReferenceItems(`${p.name}的时间参考 · ${ChainStageStats.stageFor(p.level).label} · ${p.building?'加工品':'田地作物'}`,timeReferenceRows(p))}
});
document.addEventListener('change',event=>{const e=event.target,key={phaseScope:'scope',phasePopulation:'population',phaseStat:'stat'}[e.id];if(key){phaseState[key]=e.value;renderPhaseReference();if(view==='main')insertTimeReferences(filtered())}});
document.addEventListener('focusin',event=>{const id=event.target.dataset.time||event.target.dataset.target;if(!id||!taoReference||!P(id)||phaseState.selected)return;const stage=ChainStageStats.stageFor(P(id).level);if(stage.id!==phaseState.stage){phaseState.stage=stage.id;renderPhaseReference()}});
$('referenceClose').onclick=()=>$('referenceDialog').close();
$('referenceDialog').onclick=e=>{if(e.target===$('referenceDialog'))$('referenceDialog').close()};
fetch('/api/reference').then(r=>{if(!r.ok)throw Error('参考数据读取失败');return r.json()}).then(data=>{taoReference=data;if(model)render(true)}).catch(e=>{$('phaseReference').hidden=false;$('phaseReference').textContent=e.message});

// User targets are separate from the read-only Tao reference and its filters.
const GOAL_STORE=STORE+'-stage-goals';
const GOAL_DISMISSED_STORE=STORE+'-dismissed-stage-notices';
let stageGoals=clone(ChainStageStats.defaultGoals),goalsOpen=true,goalsRevision=0,goalAudit=null,goalFocusId=null;
let goalWatchStarted=false,goalKnownRecords=new Map(),goalWatchToken='',goalAlertToken='',goalAlertKeys=new Set(),goalNoticeTimer;
let goalDismissedNotices=new Set(),goalVisibleNotices=[],goalNoticeToastText='';
try{const saved=JSON.parse(localStorage.getItem(GOAL_DISMISSED_STORE)||'[]');if(Array.isArray(saved))goalDismissedNotices=new Set(saved.filter(key=>typeof key==='string'))}catch(e){}
try{const saved=JSON.parse(localStorage.getItem(GOAL_STORE)||'null');if(saved)stageGoals=ChainStageStats.normalizeGoals(saved)}catch(e){toast('阶段预期读取失败，已使用默认值')}
// A changed actual value is still the same dismissed warning; a new target is not.
function goalNoticeKey(record){return JSON.stringify([record.key,record.name,record.stage,record.limit])}
function activeGoalNotices(){return (goalAudit?.issues||[]).filter(r=>goalAlertKeys.has(r.key)&&!goalDismissedNotices.has(goalNoticeKey(r)))}
function dismissGoalNotice(){
  for(const record of goalVisibleNotices)goalDismissedNotices.add(goalNoticeKey(record));
  try{localStorage.setItem(GOAL_DISMISSED_STORE,JSON.stringify([...goalDismissedNotices]))}catch(e){}
  clearTimeout(goalNoticeTimer);goalVisibleNotices=[];goalAlertKeys.clear();$('stageLimitNotice').hidden=true;
  if(goalNoticeToastText&&$('toast').textContent===goalNoticeToastText)$('toast').hidden=true;
}
function exportedStageGoals(){flushStageGoalInputs();return clone(stageGoals)}
function validateImportedStageGoals(value){return value===undefined?null:ChainStageStats.normalizeGoals(value)}
function setStageGoals(value){stageGoals=ChainStageStats.normalizeGoals(value);goalsRevision++;try{localStorage.setItem(GOAL_STORE,JSON.stringify(stageGoals))}catch(e){toast('请保存JSON方案以保留阶段预期')}if(model){renderPhaseReference();updateGoalAudit();if(view==='main')insertGoalTimeRow(filtered());renderGoalHint()}}
function goalActualText(summary,key){const n=summary?.actual[key];if(n!==null&&n!==undefined)return fmt(n);if((key==='optimalMax'||key==='waitMax')&&summary?.count){if(error)return'待修正';if(model.products.some(p=>ChainStageStats.stageFor(p.level).id===summary.stage&&recipeBlocked.has(p.id)))return'配方待设计';const unproven=model.products.some(p=>ChainStageStats.stageFor(p.level).id===summary.stage&&fresh(p.id)&&!A(p.id)?.schedule_at_unlock?.is_proven_optimal);return unproven?'未证最优':'待重算'}return'—'}
function renderStageGoals(){
  const panel=$('stageGoals');if(!panel||!model)return;panel.hidden=false;
  // Keep controls and drafts alive while updating actual values.
  const issueCount=goalAudit?.issues.length||0,pendingCount=goalAudit?.pending.length||0;
  let html=`<div class="goals-heading"><span>本段新增 · 含作物</span><button id="goalAuditBtn" class="goal-audit-button ${issueCount?'has-issues':''}">${issueCount?`${issueCount}项超出`:'暂无超出'}${pendingCount?` · ${pendingCount}项待确认`:''} ↗</button></div>`;
  html+=`<div class="goals-table-scroll"><table class="goals-table"><thead><tr><th>等级阶段</th>${ChainStageStats.goalFields.map(([k,n,u])=>`<th>${n}</th>`).join('')}</tr></thead><tbody>${ChainStageStats.stages.map(s=>{const g=stageGoals[s.id-1],summary=goalAudit?.summaries[s.id-1];return `<tr><th>${s.label}</th>${ChainStageStats.goalFields.map(([k,n,u])=>{const actual=summary?.actual[k],over=typeof actual==='number'&&(k==='stepMin'?actual<g[k]-1e-8:actual>g[k]+1e-8);return `<td class="${over?'goal-over':''}">${goalInputControl(s,g,k,n,u)}<small data-goal-actual="${s.id}:${k}">当前 ${typeof actual==='number'?withUnit(actual,u):goalActualText(summary,k)}</small></td>`}).join('')}</tr>`}).join('')}</tbody></table></div><div class="goals-foot"><span title="Excel 复制区域后，点击起始输入格，按 Ctrl+V；支持表头和等级列，空白保留原值。">支持粘贴 Excel 区域</span><button id="goalsReset" class="text-button">恢复默认</button></div>`;
  syncMarkup(panel,html);
}
function goalIssueText(record){return `${record.name} · ${record.label} ${fmt(record.actual)}${record.unit}${record.lower?'＜':'＞'}${fmt(record.limit)}${record.unit}`}
function pasteStageGoals(event){
  const target=event.target;if(!target.closest?.('#stageGoalsDialog'))return;
  const text=event.clipboardData?.getData('text/plain');if(!text||!/[\t\r\n]/.test(text))return;
  event.preventDefault();
  const startStage=Number(target.dataset.goalStage||1)-1,startColumn=Math.max(0,ChainStageStats.goalFields.findIndex(([k])=>k===target.dataset.goalKey));
  try{
    const result=ChainStageStats.parseGoalPaste(text,stageGoals,startStage,startColumn);
    clearTimeout(goalInputTimer);
    // syncMarkup preserves a focused draft; replace that draft with the pasted value first.
    if(target.dataset.goalKey)target.value=String(result.goals[startStage][target.dataset.goalKey]);
    setStageGoals(result.goals);toast(`已粘贴 ${result.count} 个阶段预期值`);
  }catch(e){toast(`未粘贴：${e.message}`)}
}
document.addEventListener('paste',pasteStageGoals);
function goalInputControl(stage,goal,key,name,unit){
  const duration=unit==='min',label=stage.label+name;
  return `<span class="goal-input-wrap ${duration?'time-input-wrap':''}"><input type="number" min="0" step="${duration?'any':1}" value="${goal[key]}" data-goal-stage="${stage.id}" data-goal-key="${key}" aria-label="${label}"><span class="input-unit">${unit}</span>${duration?`<span class="time-arrows"><button type="button" data-goal-step="5" data-goal-step-stage="${stage.id}" data-goal-step-key="${key}" aria-label="${label}增加5分钟">▴</button><button type="button" data-goal-step="-5" data-goal-step-stage="${stage.id}" data-goal-step-key="${key}" aria-label="${label}减少5分钟">▾</button></span>`:''}</span>`;
}
function stepGoalTime(stage,key,delta){
  const input=document.querySelector(`[data-goal-stage="${stage}"][data-goal-key="${key}"]`),current=Number(input?.value),next=clone(stageGoals);
  if(!input?.value||!Number.isFinite(current)){toast('请先填写预期值');return}
  next[stage-1][key]=Number((current+delta).toFixed(8));
  try{ChainStageStats.normalizeGoals(next);clearTimeout(goalInputTimer);input.value=next[stage-1][key];input.focus({preventScroll:true});setStageGoals(next)}catch(e){toast(e.message)}
}
document.addEventListener('click',event=>{const e=event.target.closest('button[data-goal-step]');if(e)stepGoalTime(Number(e.dataset.goalStepStage),e.dataset.goalStepKey,Number(e.dataset.goalStep))});
document.addEventListener('keydown',event=>{const e=event.target;if(e.dataset.goalKey&&!['count','depthMax','directMax','distinctMax'].includes(e.dataset.goalKey)&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();stepGoalTime(Number(e.dataset.goalStage),e.dataset.goalKey,event.key==='ArrowUp'?5:-5)}});
function showGoalAudit(){
  $('referenceDialogTitle').textContent='阶段预期 · 超出明细';
  const issues=goalAudit?.issues||[],pending=goalAudit?.pending.length||0;
  $('referenceDialogBody').innerHTML=`<p>${issues.length}项超出${pending?` · ${pending}项尚不能判定`:''}；只提醒，不阻止修改。</p><div class="ref-dialog-scroll"><table class="ref-products"><thead><tr><th>阶段</th><th>商品</th><th>指标</th><th>当前</th><th>预期</th></tr></thead><tbody>${issues.map(r=>`<tr><th>${ChainStageStats.stages[r.stage-1].label}</th><td>${esc(r.name)}</td><td>${r.label}</td><td class="goal-over-text">${fmt(r.actual)} ${r.unit}</td><td>${r.lower?'≥':'≤'} ${fmt(r.limit)} ${r.unit}</td></tr>`).join('')||'<tr><td colspan="5">当前没有已确认的超出项。</td></tr>'}</tbody></table></div>`;
  $('referenceDialog').showModal();
}
function updateGoalAudit(){
  if(!model)return;
  goalAudit=ChainStageStats.auditGoals(model.products,stageGoals,phaseDesignValue);
  const token=version+':'+goalsRevision;
  if(token!==goalWatchToken){goalWatchToken=token;goalAlertKeys.clear();clearTimeout(goalNoticeTimer);goalVisibleNotices=[];$('stageLimitNotice').hidden=true}
  for(const record of goalAudit.records){
    if(record.exceeded===null)continue;
    const previous=goalKnownRecords.get(record.key);
    if(goalWatchStarted&&record.exceeded&&!goalDismissedNotices.has(goalNoticeKey(record))&&(previous?.exceeded!==true||previous.actual!==record.actual||goalNoticeKey(previous)!==goalNoticeKey(record)))goalAlertKeys.add(record.key);
    goalKnownRecords.set(record.key,record);
  }
  // Preserve prior known comparisons while a changed recipe is being scheduled.
  const liveKeys=new Set(goalAudit.records.map(r=>r.key));for(const key of goalKnownRecords.keys())if(!liveKeys.has(key))goalKnownRecords.delete(key);
  goalWatchStarted=true;
  const relevant=activeGoalNotices();goalVisibleNotices=relevant;
  if(relevant.length){
    const notice=$('stageLimitNotice');notice.hidden=false;notice.innerHTML=`<span><b>超过阶段预期</b>　${relevant.slice(0,3).map(r=>esc(goalIssueText(r))).join('；')}${relevant.length>3?`；另${relevant.length-3}项`:''}</span><button id="goalNoticeDetails" class="text-button">查看全部</button><button id="goalNoticeClose" aria-label="关闭超出提醒">×</button>`;
    if(goalAlertToken!==token){clearTimeout(goalNoticeTimer);goalNoticeTimer=setTimeout(()=>{const current=activeGoalNotices();if(goalWatchToken!==token||!current.length)return;goalAlertToken=token;goalNoticeToastText=`超过阶段预期：${goalIssueText(current[0])}${current.length>1?`，另${current.length-1}项；已标红`:''}`;toast(goalNoticeToastText)},180)}
  }else{clearTimeout(goalNoticeTimer);$('stageLimitNotice').hidden=true}
  renderStageGoals();markGoalCells();renderGoalHint();
}
function insertGoalTimeRow(targets){
  if(!targets.length||view!=='main')return;
  const existing=$('dataTable').querySelector('.goal-time-row');
  const html=`<tr class="goal-time-row"><td class="product-col">阶段预期范围</td>${targets.map((p,j)=>{const s=ChainStageStats.stageFor(p.level),g=stageGoals[s.id-1];return `<td class="${j&&targets[j-1].building!==p.building?'group-left':''}"><span>${fmt(g.stepMin)}–${withUnit(g.stepMax)}</span><small>${s.label}</small></td>`}).join('')}</tr>`;
  if(existing){const temp=document.createElement('tbody');temp.innerHTML=html;syncMarkup(existing,temp.firstElementChild.innerHTML)}else $('dataTable').querySelector('.time-row')?.insertAdjacentHTML('afterend',html);
}
const goalBaseMatrix=unitMatrix;
unitMatrix=function(targets){goalBaseMatrix(targets);insertGoalTimeRow(targets)};
function markGoalCells(){
  if(view!=='main'||!goalAudit)return;
  const metricKey={W:'cumulative',T:'optimized',wait:'emptyWait',D:'depth',R:'singleComplexity',K:'complexity'};
  for(const input of document.querySelectorAll('input[data-time]')){
    const p=P(input.dataset.time),g=stageGoals[ChainStageStats.stageFor(p.level).id-1],n=Number(input.value),over=!!input.value&&(n<g.stepMin-1e-8||n>g.stepMax+1e-8);
    input.classList.toggle('goal-input-over',over);input.setAttribute('aria-invalid',String(over));input.title=`阶段预期：${g.stepMin}–${g.stepMax} min（提醒，不限制输入）`;
  }
  for(const row of document.querySelectorAll('[data-metric]'))for(const cell of row.querySelectorAll('[data-product]')){
    const record=goalAudit.records.find(r=>r.id===Number(cell.dataset.product)&&r.metric===metricKey[row.dataset.metric]);if(!record)continue;
    cell.classList.toggle('goal-value-over',record.exceeded===true);cell.title=`阶段预期：≤${record.limit}${record.unit}${record.exceeded===null?'；尚未重算/未证最优':record.exceeded?'；已超出':''}`;
  }
}
function renderGoalHint(){
  const input=document.activeElement,p=P(goalFocusId);
  if(view!=='main'||!p||!(input?.dataset.time||input?.dataset.target))return;
  const stage=ChainStageStats.stageFor(p.level),g=stageGoals[stage.id-1];
  input.title=`${p.name} · ${stage.label}预期：单步 ${fmt(g.stepMin)}–${fmt(g.stepMax)} min；累计 ≤${fmt(g.workMax)} min；优化 ≤${fmt(g.optimalMax)} min；空仓等待 ≤${fmt(g.waitMax)} min；深度 ≤${g.depthMax}；单步复杂度 ≤${g.directMax}；累计复杂度 ≤${g.distinctMax}`;
}
document.addEventListener('focusin',event=>{const id=event.target.dataset.time||event.target.dataset.target;if(id&&P(id)){goalFocusId=Number(id);renderGoalHint()}});
let goalInputTimer;
function flushStageGoalInputs(showErrors=false){
  const next=clone(stageGoals);let changed=false;
  for(const e of document.querySelectorAll('input[data-goal-key]')){const index=Number(e.dataset.goalStage)-1,key=e.dataset.goalKey;if(e.value&&Number(e.value)!==next[index][key]){next[index][key]=Number(e.value);changed=true}}
  if(!changed)return;
  try{setStageGoals(next)}catch(e){if(showErrors)toast(e.message)}
}
document.addEventListener('input',event=>{if(event.target.dataset.time)markGoalCells();if(event.target.hasAttribute('data-goal-key')){clearTimeout(goalInputTimer);goalInputTimer=setTimeout(()=>flushStageGoalInputs(),350)}});
document.addEventListener('change',event=>{
  const e=event.target;if(!e.hasAttribute('data-goal-key'))return;
  clearTimeout(goalInputTimer);
  const index=Number(e.dataset.goalStage)-1,key=e.dataset.goalKey,n=Number(e.value),next=clone(stageGoals);next[index][key]=n;
  try{if(!e.value)throw Error('请填写预期值。');setStageGoals(next)}catch(err){e.value=stageGoals[index][key];toast(err.message)}
});
document.addEventListener('focusout',event=>{if(event.target.hasAttribute('data-goal-key')){clearTimeout(goalInputTimer);flushStageGoalInputs(true);setTimeout(()=>renderStageGoals(),0)}});
document.addEventListener('click',event=>{
  const id=event.target.closest('button')?.id;
  if(id==='goalsOpen'){goalsOpen=true;renderStageGoals();$('stageGoalsDialog').showModal()}
  else if(id==='goalsClose'){$('stageGoalsDialog').close()}
  else if(id==='goalsReset')setStageGoals(clone(ChainStageStats.defaultGoals));
  else if(id==='goalAuditBtn'||id==='goalNoticeDetails')showGoalAudit();
  else if(id==='goalNoticeClose')dismissGoalNotice();
});
$('stageGoalsDialog').addEventListener('click',event=>{if(event.target===$('stageGoalsDialog'))$('stageGoalsDialog').close()});

'use strict';
// Fit width is the default display baseline; no extra controls or saved zoom.
function tableFitTargets(){
  return [
    {table:$('dataTable'),scroll:$('tableScroll')},
    {table:document.querySelector('.phase-table'),scroll:document.querySelector('.phase-table-scroll')},
    {table:document.querySelector('.goals-table'),scroll:document.querySelector('.goals-table-scroll')}
  ];
}
function fitTablesToWidth(){
  for(const {table,scroll} of tableFitTargets()){
    if(!table||!scroll||!scroll.clientWidth)continue;
    const top=scroll.scrollTop;
    // Measure unscaled in the same frame, so repeated edits never compound zoom.
    table.style.zoom='1';
    const scale=Math.min(1,Math.max(.01,(scroll.clientWidth-2)/Math.max(1,table.offsetWidth)));
    table.style.zoom=String(scale);
    scroll.scrollTop=top;
    if(scroll.scrollLeft)scroll.scrollLeft=0;
  }
}
const tableFitRender=render;
render=function(force=false){tableFitRender(force);fitTablesToWidth()};
const tableFitPhaseRender=renderPhaseReference;
renderPhaseReference=function(){tableFitPhaseRender();fitTablesToWidth()};
const tableFitGoalsRender=renderStageGoals;
renderStageGoals=function(){tableFitGoalsRender();fitTablesToWidth()};
// Observe containers, not tables, to avoid a feedback loop from scaling.
const tableFitObserver=new ResizeObserver(()=>fitTablesToWidth());
tableFitObserver.observe($('tableScroll'));tableFitObserver.observe($('phaseReference'));tableFitObserver.observe($('stageGoalsDialog'));
new MutationObserver(()=>fitTablesToWidth()).observe($('stageGoalsDialog'),{attributes:true,attributeFilter:['open']});
window.addEventListener('resize',fitTablesToWidth);
