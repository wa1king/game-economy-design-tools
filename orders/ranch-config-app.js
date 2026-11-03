import {isQuantityConstraintIssue,uniqueQuantityIssueText} from './ranch-quantity-issues.js';
import {ranchObjective} from './ranch-objective.js';
import {createConfigClipboard} from './config-clipboard.js';
import {readRanchTarget,loadRanchWorkspace,saveRanchTargets,saveRanchObjective,calculateRanchWorkspace,watchRanchWorkspace} from './ranch-workspace.js';

export const RANCH_CONFIG_COLUMNS=['targetHours','targetTolerance','targetWork','fitCropMax','fitProductMax'];
export const ranchConfigColumns=target=>ranchObjective(target)==='coins'?['targetCoins','coinTolerance','targetWork','fitCropMax','fitProductMax']:RANCH_CONFIG_COLUMNS;
const LABELS={targetCoins:'四单金币总值',coinTolerance:'金币允许偏差',targetHours:'联合优化时间',targetTolerance:'允许偏差',targetWork:'累计工时目标',fitCropMax:'作物数量上限',fitProductMax:'加工品数量上限'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});
const exact=result=>Boolean(result?.proven&&Number.isFinite(result.optimalMinutes));

export function ranchConfigRowState(plan,currentLevel=null){
  let done=0,proven=0,failed=0;
  for(const group of plan.groups){const r=plan.results.get(group.key);if(exact(r)){done++;proven++;}else if(Number.isFinite(r?.feasibleMinutes))done++;else if(plan.failures.has(group.key))failed++;}
  const total=plan.groups.length;
  if(!total)return {done,proven,total,text:'暂无组合',kind:'empty',detail:''};
  if(plan.capacityError)return {done,proven,total,text:'产能待补全',kind:'error',detail:plan.capacityError};
  if(plan.targetError)return {done,proven,total,text:'目标待调整',kind:'error',detail:plan.targetError};
  if(plan.quantityErrors?.size){const issues=[...plan.quantityErrors],constrained=issues.filter(([id,message])=>isQuantityConstraintIssue(message,plan.quantityFits?.get?.(id)?.diagnostic)).length,review=issues.filter(([id])=>plan.quantityFits?.get?.(id)?.diagnostic?.code==='RANCH_LEGACY_QUANTITY_REVIEW').length,failed=issues.length-constrained-review;const parts=[failed?`${number(failed)} 组需处理`:'',constrained?`未纳入 ${number(constrained)} 组`:'',review?`${number(review)} 组旧记录待复核`:''].filter(Boolean);return {done,proven,total,constrained,review,text:parts.join(' · '),kind:failed?'error':review?'warn':'neutral',errorDetail:uniqueQuantityIssueText(issues.filter(([id,message])=>!isQuantityConstraintIssue(message,plan.quantityFits?.get?.(id)?.diagnostic)&&plan.quantityFits?.get?.(id)?.diagnostic?.code!=='RANCH_LEGACY_QUANTITY_REVIEW').map(v=>v[1])),detail:uniqueQuantityIssueText(issues.map(v=>v[1]))};}
  if(currentLevel===plan.level)return {done,proven,total,text:'计算中',kind:'running',detail:''};
  if(proven===total)return {done,proven,total,text:'最优已确认',kind:'good',detail:''};
  if(done===total)return {done,proven,total,text:'部分待确认最优',kind:'warn',detail:`${total-proven} 组已有可行排产，最短时间仍待确认`};
  if(failed)return {done,proven,total,text:'部分计算失败',kind:'error',detail:uniqueQuantityIssueText([...plan.failures.values()])};
  return {done,proven,total,text:done?'待继续计算':'待计算',kind:'pending',detail:''};
}

export function ranchConfigProblemSummary(plans){
  const states=plans.map(p=>({level:p.level,...ranchConfigRowState(p)})),errors=states.filter(v=>v.kind==='error');
  const sections=[];
  const reviews=states.filter(v=>v.review>0);if(reviews.length)sections.push('旧配量记录需复核：'+reviews.map(v=>`Lv ${v.level}：${v.review} 组`).join('；')+'。旧提示没有区分整数约束与内部任务上限，可在单等级预设组合中复核。');
  if(errors.length)sections.push(errors.slice(0,3).map(v=>`Lv ${v.level}：${v.errorDetail||v.detail||v.text}`).join('；')+(errors.length>3?`；另有 ${errors.length-3} 级需处理。`:''));return sections.join('\n');
}

export function ranchConfigSelectionSummary(plans){
  const total=plans.reduce((sum,p)=>sum+(ranchConfigRowState(p).constrained??0),0);
  return total?`预设筛选：${number(total)} 组未纳入实际订单 · 各等级可展开筛选说明`:'';
}

export function ranchConfigColumnFill(key,value,fromLevel,maxLevel){
  if(![...RANCH_CONFIG_COLUMNS,'targetCoins','coinTolerance'].includes(key)||!Number.isInteger(fromLevel)||fromLevel<1||fromLevel>maxLevel)throw Error('无效的数值列或等级。');
  return Array.from({length:maxLevel-fromLevel+1},(_,i)=>({level:fromLevel+i,key,value}));
}

export function renderRanchConfigRow(plan,target){
  const fields=ranchConfigColumns(target).map(key=>`<td><input type="number" data-level="${plan.level}" data-key="${key}" value="${esc(target[key])}" min="${['targetTolerance','coinTolerance'].includes(key)?0:0.000001}" step="${key.startsWith('fit')?1:'any'}" ${key==='targetWork'?'placeholder="自动"':''} aria-label="Lv ${plan.level} ${LABELS[key]}" aria-keyshortcuts="Control+Enter" title="Ctrl+Enter：填充本列当前等级及后续等级"></td>`).join('');
  return `<tr data-level="${plan.level}"><th class="frozen-level" data-select-row="${plan.level}" title="选中本级整行数值；Shift 连选"><button type="button" class="matrix-select-trigger" aria-label="选中 Lv ${plan.level} 整行数值">Lv ${plan.level}</button></th>${fields}<td class="ranch-config-count"><span data-done-count></span><small data-proven-count></small></td><td class="frozen-state"><span data-row-state class="ranch-config-state"></span><details class="ranch-row-issue" data-row-issue hidden><summary>查看说明</summary><p data-row-detail></p></details><a href="ranch.html?level=${plan.level}">查看单级</a></td></tr>`;
}

export function createRanchConfigPage(api={}){
  const doc=api.document??document,$=id=>doc.getElementById(id),loadWorkspace=api.loadRanchWorkspace??loadRanchWorkspace,readTarget=api.readRanchTarget??readRanchTarget,saveTargets=api.saveRanchTargets??saveRanchTargets,calculateWorkspace=api.calculateRanchWorkspace??calculateRanchWorkspace,watchWorkspace=api.watchRanchWorkspace??watchRanchWorkspace,makeClipboard=api.createConfigClipboard??createConfigClipboard;
  const body=$('ranchConfigRows'),head=$('ranchConfigHead');
  let ws=null,busy=false,loading=false,writing=false,controller=null,currentLevel=null,paused=false,headerAnchor=null,externalChange=false,disposed=false,activeRun=null,lastRunError=null,navigating=false;
  const currentColumns=()=>ranchConfigColumns(ws?.settings),saveObjective=api.saveRanchObjective??saveRanchObjective;
  function objectiveUI(){
    const coins=ranchObjective(ws?.settings)==='coins';$('ranchObjective').value=coins?'coins':'time';$('ranchObjective').disabled=busy||loading;
    $('primaryColumn').dataset.selectColumn=coins?'targetCoins':'targetHours';$('primaryColumn').innerHTML=`<button type="button" class="matrix-select-trigger">${coins?'四单金币总值 · 金币':'联合优化时间 · 小时'}</button>`;
    $('toleranceColumn').dataset.selectColumn=coins?'coinTolerance':'targetTolerance';$('toleranceColumn').innerHTML=`<button type="button" class="matrix-select-trigger">允许偏差 ±${coins?'金币':'分钟'}</button>`;
    $('targetColumnGroup').dataset.selectGroup=currentColumns().slice(0,3).join(' ');$('targetColumnGroup').innerHTML='<button type="button" class="matrix-select-trigger">两类共用配量目标</button>';
  }
  const invalid=new Map(),maxLevel=()=>ws?.base.maxLevel??0;
  function message(text){$('ranchConfigMessage').textContent=text??'';}
  function error(text){$('ranchConfigError').hidden=!text;$('ranchConfigError').textContent=text??'';}
  function highlight(range){
    const allRows=range?.top===1&&range?.bottom===maxLevel(),allColumns=range?.left===0&&range?.right===currentColumns().length-1;
    head.querySelectorAll('[data-select-column]').forEach(cell=>{const col=currentColumns().indexOf(cell.dataset.selectColumn);cell.classList.toggle('matrix-header-selected',Boolean(allRows&&col>=range.left&&col<=range.right));});
    body.querySelectorAll('[data-select-row]').forEach(cell=>cell.classList.toggle('matrix-header-selected',Boolean(allColumns&&Number(cell.dataset.selectRow)>=range.top&&Number(cell.dataset.selectRow)<=range.bottom)));
    head.querySelector('[data-select-all]')?.classList.toggle('matrix-header-selected',Boolean(allRows&&allColumns));
  }
  function markValid(cell){const key=cell.level+':'+cell.key;invalid.delete(key);const input=body.querySelector(`input[data-level="${cell.level}"][data-key="${cell.key}"]`);input?.removeAttribute('aria-invalid');}
  function apply(cells){
    if(!ws||busy)throw Error('计算中不能修改配置。');
    writing=true;try{saveTargets(ws,cells);cells.forEach(markValid);error(invalid.size?[...invalid.values()][0]:'');}finally{writing=false;}
  }
  const clipboard=makeClipboard({root:body,getColumns:()=>currentColumns(),getRowCount:maxLevel,isBusy:()=>busy,onApply:apply,onRefresh:refresh,onMessage:message,onSelectionChange:highlight});
  function refresh(){
    if(!ws)return;objectiveUI();const selection=$('ranchConfigSelection');if(selection){selection.textContent=ranchConfigSelectionSummary(ws.plans);selection.hidden=!selection.textContent;}
    for(const plan of ws.plans){const row=body.querySelector(`tr[data-level="${plan.level}"]`);if(!row)continue;const state=ranchConfigRowState(plan,currentLevel);row.querySelector('[data-done-count]').textContent=`${number(state.done)} / ${number(state.total)}`;row.querySelector('[data-proven-count]').textContent=state.total?`最优已确认 ${number(state.proven)} 组`:'';const label=row.querySelector('[data-row-state]');label.textContent=state.text;label.className='ranch-config-state '+state.kind;label.title=state.detail;const issue=row.querySelector('[data-row-issue]'),detail=row.querySelector('[data-row-detail]');if(issue&&detail){issue.hidden=!state.detail;issue.dataset.kind=state.kind;detail.textContent=state.detail;}}
    body.querySelectorAll('input[data-key]').forEach(input=>{input.disabled=busy;});
    for(const id of ['fitRanchLevels'])$(id).disabled=busy||loading||!ws.plans.some(p=>p.groups.length);
    $('pauseRanchLevels').hidden=!busy;$('pauseRanchLevels').disabled=Boolean(controller?.signal.aborted);$('resumeRanchLevels').hidden=!paused||busy;$('resumeRanchLevels').disabled=loading;
    $('reloadRanchConfig').disabled=busy||loading;$('ranchConfigChanged').hidden=!externalChange;
  }
  function sync(cells){for(const cell of cells){const input=body.querySelector(`input[data-level="${cell.level}"][data-key="${cell.key}"]`);if(input)input.value=String(readTarget(ws.settings,cell.level)[cell.key]??'');}refresh();}
  function maybeReload(){
    if(disposed||navigating||!externalChange||busy||loading||invalid.size||body.contains(doc.activeElement))return;
    void load();
  }
  function commit(input){
    if(!input?.matches?.('input[data-level][data-key]')||!body.contains(input)||input.disabled)return true;
    const cell={level:Number(input.dataset.level),key:input.dataset.key,value:input.value};
    try{if(input.validity?.badInput)throw Error('请输入有效数字。');apply([cell]);refresh();message(`已保存 Lv ${cell.level} · ${LABELS[cell.key]}`);return true;}catch(e){const text=`Lv ${cell.level} ${LABELS[cell.key]}：${e.message}`;invalid.set(cell.level+':'+cell.key,text);input.setAttribute('aria-invalid','true');error(text);return false;}
  }
  function selectHeader(cell,shift){
    if(!ws)return;const columns=currentColumns(),max=maxLevel();
    if(cell.dataset.selectColumn!=null){const col=columns.indexOf(cell.dataset.selectColumn),start=shift&&headerAnchor?.type==='column'?headerAnchor.index:col;if(col<0)return;if(!shift||headerAnchor?.type!=='column')headerAnchor={type:'column',index:col};clipboard.selectRange({top:1,bottom:max,left:Math.min(start,col),right:Math.max(start,col)});}
    else if(cell.dataset.selectRow!=null){const level=Number(cell.dataset.selectRow),start=shift&&headerAnchor?.type==='row'?headerAnchor.index:level;if(!shift||headerAnchor?.type!=='row')headerAnchor={type:'row',index:level};clipboard.selectRange({top:Math.min(start,level),bottom:Math.max(start,level),left:0,right:columns.length-1});}
    else if(cell.dataset.selectGroup!=null){const indices=cell.dataset.selectGroup.split(' ').map(key=>columns.indexOf(key)).filter(i=>i>=0);if(indices.length){headerAnchor=null;clipboard.selectRange({top:1,bottom:max,left:Math.min(...indices),right:Math.max(...indices)});}}
    else{headerAnchor=null;clipboard.selectRange({top:1,bottom:max,left:0,right:columns.length-1});}
  }
  async function load(){
    if(busy||loading)return;loading=true;error('');refresh();
    try{const next=await loadWorkspace();ws=next;invalid.clear();externalChange=false;paused=false;headerAnchor=null;$('ranchConfigWorkspace').hidden=!ws;$('ranchConfigEmpty').hidden=Boolean(ws);if(!ws)return;
      body.innerHTML=ws.plans.map(plan=>renderRanchConfigRow(plan,readTarget(ws.settings,plan.level))).join('');$('ranchConfigSummary').textContent=`${ws.base.maxLevel} 级 · 同建筑与高级加工链共用目标`;message('');$('ranchConfigProgressWrap').hidden=true;clipboard.refresh();
    }catch(e){error(e.message);if(!ws){$('ranchConfigWorkspace').hidden=true;$('ranchConfigEmpty').hidden=false;}}
    finally{loading=false;refresh();if(ws)error(ranchConfigProblemSummary(ws.plans));}
  }
  async function performRun(){
    const mode='quantity';
    let lastPaint=0;const paintProgress=()=>{if(Date.now()-lastPaint>=160){lastPaint=Date.now();refresh();}};
    if(busy||loading||!ws)return;if(!commit(doc.activeElement)||invalid.size){error([...invalid.values()][0]||'请先修正无效数值。');return;}
    busy=true;paused=false;lastRunError=null;controller=new AbortController();const signal=controller.signal;error('');message('');$('ranchConfigProgressWrap').hidden=false;$('ranchConfigProgress').value=0;$('ranchConfigProgressText').textContent='开始按目标配量…';refresh();
    try{const report=await calculateWorkspace(ws,{mode,signal,onProgress:p=>{currentLevel=p.level??null;const value=p.total>0?Math.max(0,Math.min(1,p.index/p.total)):0;$('ranchConfigProgress').value=value;$('ranchConfigProgressText').textContent=p.message||(p.level?`Lv ${p.level} · ${p.index??0} / ${p.total??0}`:'计算中…');paintProgress();},onChange:paintProgress});if(!signal.aborted){$('ranchConfigProgress').value=1;$('ranchConfigProgressText').textContent=report?.failed?`本轮完成 · ${number(report.failed)} 项需处理`:report?.excluded?'本轮计算完成 · 筛选结果已保存':'本轮计算完成';error(ranchConfigProblemSummary(ws.plans)||(report?.failed?`本轮有 ${number(report.failed)} 项未完成，请查看各级状态。`:''));}}
    catch(e){lastRunError=e;error(e.message);}
    finally{paused=signal.aborted;busy=false;currentLevel=null;controller=null;if(paused)$('ranchConfigProgressText').textContent=lastRunError?'已停止，部分结果未保存':'已暂停，已完成结果已保留';refresh();if(!paused)maybeReload();}
  }
  function run(){
    if(busy||loading||!ws||navigating||disposed)return Promise.resolve();
    const task=performRun();activeRun=task;
    const clear=()=>{if(activeRun===task)activeRun=null;};task.then(clear,clear);return task;
  }
  async function beforeNavigate({leaving=true}={}){
    if(!commit(doc.activeElement)||invalid.size){const text=[...invalid.values()][0]||'请先修正无效数值。';error(text);throw Error(text);}
    navigating=leaving;const pending=activeRun;
    try{if(pending){controller?.abort();refresh();await pending;if(lastRunError)throw lastRunError;}}
    catch(e){navigating=false;error(e.message);throw e;}
  }
  body.addEventListener('change',event=>commit(event.target));
  body.addEventListener('focusout',()=>{Promise.resolve().then(maybeReload);});
  body.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||!event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||event.repeat)return;
    const input=event.target;if(!input.matches?.('input[data-level][data-key]')||input.disabled||busy)return;event.preventDefault();event.stopPropagation();
    try{if(input.validity?.badInput)throw Error('请输入有效数字后再向下填充。');const cells=ranchConfigColumnFill(input.dataset.key,input.value,Number(input.dataset.level),maxLevel());apply(cells);sync(cells);message(`已填充 Lv ${input.dataset.level}～${maxLevel()} · ${LABELS[input.dataset.key]}`);}catch(e){error(e.message);}
  });
  head.addEventListener('click',event=>{const cell=event.target.closest?.('[data-select-column],[data-select-group],[data-select-all]');if(cell){event.preventDefault();selectHeader(cell,event.shiftKey);}});
  body.addEventListener('click',event=>{const cell=event.target.closest?.('[data-select-row]');if(cell){event.preventDefault();selectHeader(cell,event.shiftKey);}});
  $('ranchObjective').onchange=()=>{if(!ws||busy||loading)return;try{if(!commit(doc.activeElement)||invalid.size)throw Error('请先修正无效输入。');writing=true;saveObjective(ws,$('ranchObjective').value);invalid.clear();headerAnchor=null;body.innerHTML=ws.plans.map(p=>renderRanchConfigRow(p,readTarget(ws.settings,p.level))).join('');clipboard.refresh();refresh();message('已切换配量目标；原有另一套目标值已保留。');}catch(e){error(e.message);objectiveUI();}finally{writing=false;}};
  $('reloadRanchConfig').onclick=load;$('fitRanchLevels').onclick=()=>run();$('pauseRanchLevels').onclick=()=>{controller?.abort();refresh();};$('resumeRanchLevels').onclick=()=>run();
  const unwatch=watchWorkspace(()=>{if(writing)return;externalChange=true;refresh();maybeReload();});
  const ready=load();
  return {ready,reload:load,run,refresh,beforeNavigate,getWorkspace:()=>ws,dispose(){disposed=true;controller?.abort();unwatch?.();}};
}

if(typeof document!=='undefined'&&document.getElementById('ranchConfigWorkspace')){
  const page=createRanchConfigPage();
  if(typeof window!=='undefined'){window.ranchBeforeNavigate=options=>page.beforeNavigate(options);window.addEventListener('pagehide',()=>page.dispose(),{once:true});}
}
