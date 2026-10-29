'use strict';
const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])), clone=x=>JSON.parse(JSON.stringify(x));
const fmt=n=>typeof n==='number'?Number(n.toFixed(2)).toLocaleString('zh-CN',{maximumFractionDigits:2}):'—';
const withUnit=(n,unit='min')=>`${fmt(n)}<span class="value-unit">${unit}</span>`;
const STORE='game-economy-pages-chain-v1';
let model,seed,snapshot,analysis,metrics=new Map(),signs=new Map(),oldSigns=new Map(),active=2001,view='levels',loadMode='process',history=[],version=0,timer,busy=false,exporting=false,error='',expanded=true,toastTimer,pendingRender=false;
let recipeIssues=new Map(),recipeBlocked=new Map();
const P=id=>model.products.find(p=>p.id===Number(id)), B=id=>model.buildings.find(b=>b.id===Number(id)), color=id=>id?B(id)?.color||'#DDEBF7':'#E2F0D9';
const M=id=>metrics.get(id), A=id=>analysis?.products.find(p=>p.id===id), fresh=id=>!error&&!recipeBlocked.has(id)&&signs.get(id)===oldSigns.get(id)&&!!A(id);

// Update existing nodes: background calculations must not recreate controls.
function syncMarkup(root,html){
 const next=document.createElement(root.tagName);next.innerHTML=html;
 function sync(parent,wanted){
  for(let i=0;i<wanted.childNodes.length;i++){
   const source=wanted.childNodes[i];let node=parent.childNodes[i];
   if(!node||node.nodeType!==source.nodeType||node.nodeName!==source.nodeName){
    const copy=source.cloneNode(true);if(node)parent.replaceChild(copy,node);else parent.appendChild(copy);continue;
   }
   if(node.nodeType!==1){if(node.nodeValue!==source.nodeValue)node.nodeValue=source.nodeValue;continue}
   const editing=node===document.activeElement&&node.tagName==='INPUT';
   for(const attr of [...node.attributes])if(!source.hasAttribute(attr.name)&&!(editing&&attr.name==='value'))node.removeAttribute(attr.name);
   for(const attr of source.attributes)if(!(editing&&attr.name==='value')&&node.getAttribute(attr.name)!==attr.value)node.setAttribute(attr.name,attr.value);
   sync(node,source);
   if(!editing&&['INPUT','SELECT'].includes(node.tagName)&&node.value!==source.value)node.value=source.value;
  }
  while(parent.childNodes.length>wanted.childNodes.length)parent.lastChild.remove();
 }
 sync(root,next);
}
let lastMatrixStructure='',lastModelbarStructure='';
function refreshUnitMatrix(){
 for(const input of $('dataTable').querySelectorAll('input[data-time],input[data-target]')){
  const p=P(input.dataset.time||input.dataset.target);
  const value=input.dataset.time?String(p.time):String(p.inputs.find(([up])=>up===Number(input.dataset.up))?.[1]||'');
  if(input.value!==value)input.value=value;
  if(input.dataset.target)input.classList.toggle('has-value',!!value);
 }
 for(const row of $('dataTable').querySelectorAll('[data-metric]'))for(const cell of row.querySelectorAll('[data-product]')){
  const html=val(Number(cell.dataset.product),row.dataset.metric);if(cell.innerHTML!==html)cell.innerHTML=html;
 }
}

function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500)}
function status(text,type=''){$('status').textContent=text;$('status').className='status '+type}
function showError(message=''){
 error=message;const panel=$('error');
 if(error){panel.textContent=error;panel.hidden=false;status('需要修正','bad')}
 else if(recipeIssues.size){panel.hidden=false;const first=[...recipeIssues][0];panel.innerHTML=`<span><b>${recipeIssues.size}处配方待设计</b>　${esc(P(first[0]).name)}：${esc(first[1].map(r=>r.message).join('；'))}</span><button id="recipeReviewBtn" class="text-button">调整配方</button>`}
 else{panel.textContent='';panel.hidden=true}
 $('exportBtn').disabled=!!error||recipeBlocked.size>0||busy||exporting;
}
function showRecipeReview(){
 $('referenceDialogTitle').textContent='需要重新设计的配方';
 $('referenceDialogBody').innerHTML=`<p>保留解锁等级、原配方和时间；请手动调整下面的配方。</p><div class="ref-dialog-scroll"><table class="ref-products"><thead><tr><th>物品</th><th>解锁等级</th><th>待调整原因</th><th></th></tr></thead><tbody>${[...recipeIssues].map(([id,issues])=>`<tr><th>${esc(P(id).name)}</th><td>Lv${P(id).level}</td><td>${esc(issues.map(r=>r.message).join('；'))}</td><td><button data-review-recipe="${id}" class="text-button">调整配方 ↗</button></td></tr>`).join('')}</tbody></table></div>`;
 $('referenceDialog').showModal();
}
function markRecipeIssues(){
 if(view!=='main')return;
 for(const button of $('dataTable').querySelectorAll('[data-rename-product]')){const id=Number(button.dataset.renameProduct);button.classList.toggle('recipe-blocked',recipeBlocked.has(id));button.title=recipeBlocked.has(id)?'配方待设计：'+recipeBlocked.get(id).map(root=>P(root).name).join('、'):'点击改名'}
 for(const input of $('dataTable').querySelectorAll('input[data-target]')){const issues=recipeIssues.get(Number(input.dataset.target))||[],issue=issues.find(r=>r.up===Number(input.dataset.up));input.classList.toggle('recipe-conflict',!!issue);input.setAttribute('aria-invalid',String(!!issue));input.title=issue?issue.message+'；请重新设计此配方':''}
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.id==='recipeReviewBtn')showRecipeReview();
 else if(button.dataset.reviewRecipe){const id=Number(button.dataset.reviewRecipe);if($('referenceDialog').open)$('referenceDialog').close();active=id;view='main';$('buildingFilter').value='all';$('search').value='';$('levelFilter').value='20';render(true);const issue=recipeIssues.get(id)?.find(r=>r.up),field=issue?$('dataTable').querySelector(`[data-target="${id}"][data-up="${issue.up}"]`):$('dataTable').querySelector(`[data-building="${id}"]`);if(field){field.scrollIntoView({block:'nearest',inline:'center'});field.focus({preventScroll:true})}}
});

async function post(url,data,binary=false){const r=await fetch(url,{method:'POST',headers:{'Content-Type':binary?'application/octet-stream':'application/json'},body:binary?data:JSON.stringify(data)}),value=await r.json();if(!r.ok)throw Error(value.error||'操作未完成');return value}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitJob(id,progress,alive=()=>true){while(alive()){const response=await fetch('/api/jobs/'+id),job=await response.json();if(!response.ok||job.status==='error')throw Error(job.error||'计算未完成');if(job.status==='done')return job;progress?.(job);await delay(400)}return null}
function saveLocal(){try{localStorage.setItem(STORE,JSON.stringify({version:1,design:model}))}catch(e){toast('请通过“保存方案”保存当前输入。')}}
// Exact aliases from the user's 2026-10-14 naming list; never match by substring or position.
const CRAFT_NAMES_20261014={
 crops:['芦苇草','棉花','竹子','香绒草','薰衣草','芍药花','墨水花','蜡烛花','浆果珍珠'],
 goods:['芦苇丝','棉绒团','竹条','薄竹片','竹编小垫','绒香粉','薰衣草精油','软棉布','花瓣香水','竹炭画笔','小竹框','竹帘','云朵香粉','薰衣草香棒','墨汁','竹制盆景','绒绒灯罩','花瓣竹板','圈圈蚊香','花蜡','软边小席','乌云绒团','薰衣草软垫','珍珠衣帽架','雨滴篮子','花瓣小灯'],
 buildings:['研磨机','切割机','纺织机','萃取机','窑炉']
};
function craftNameUpdate20261014(current){
 const aliases=new Map([...CRAFT_NAMES_20261014.crops.map((name,i)=>['新作物'+(i+1),name]),...CRAFT_NAMES_20261014.goods.map((name,i)=>['新物品'+(i+1),name])]);
 const buildings=new Map(CRAFT_NAMES_20261014.buildings.map((name,i)=>['新加工坊'+(i+1),name]));
 // The original 8+25 seed and unrelated/new plans are not this user design.
 if(![...aliases.keys()].every(name=>current.products.some(p=>p.name===name))||![...buildings.keys()].every(name=>current.buildings.some(b=>b.name===name)))return null;
 const next=clone(current);
 for(const p of next.products)if(aliases.has(p.name))p.name=aliases.get(p.name);
 for(const b of next.buildings)if(buildings.has(b.name))b.name=buildings.get(b.name);
 if(new Set(next.products.map(p=>p.name)).size!==next.products.length||new Set(next.buildings.map(b=>b.name)).size!==next.buildings.length)throw Error('清单中的名称已被其他内容使用，请先检查重复名称');
 const byId=new Map(next.buildings.map(b=>[b.id,b]));
 for(const p of next.products)p.buildingName=p.building?byId.get(p.building)?.name||p.buildingName:'农田';
 return next;
}
function applyCraftNameUpdate20261014(){
 const marker=STORE+'-craft-names-20261014';
 try{
  if(localStorage.getItem(marker)==='applied')return false;
  const next=craftNameUpdate20261014(model);if(!next)return false;
  history.push(clone(model));model=next;version++;saveLocal();
  localStorage.setItem(marker,'applied');return true;
 }catch(e){toast('未改名：'+e.message);return false}
}
// End of exact naming update.
function sort(){model.buildings.sort((a,b)=>a.level-b.level||a.id-b.id);const order=new Map([[0,0],...model.buildings.map((b,i)=>[b.id,i+1])]);model.products.sort((a,b)=>order.get(a.building)-order.get(b.building)||a.level-b.level||a.id-b.id);for(const p of model.products)p.buildingName=p.building?B(p.building)?.name||'未配置建筑':'农田'}
function calculateLocal(){
 const memo=new Map(),sig=new Map(),stack=new Set(),issues=new Map();
 const issue=(id,record)=>{if(!issues.has(id))issues.set(id,[]);issues.get(id).push(record)};
 function visit(id){
  if(memo.has(id))return memo.get(id);if(stack.has(id))throw Error('配方循环：'+P(id)?.name);const p=P(id);if(!p)throw Error('配方引用了不存在的商品');stack.add(id);
  const bom=new Map([[id,1]]);let depth=0;for(const [up,q]of p.inputs){const branch=visit(up);depth=Math.max(depth,branch.depth+1);for(const [key,count]of branch.bom)bom.set(key,(bom.get(key)||0)+count*q)}
  stack.delete(id);const resourceMinutes=new Map();for(const [up,q]of bom){const source=P(up);resourceMinutes.set(source.building,(resourceMinutes.get(source.building)||0)+source.time*q)}const work=[...resourceMinutes.values()].reduce((s,n)=>s+n,0);memo.set(id,{bom,depth,work,resourceMinutes,R:p.inputs.length,K:bom.size});sig.set(id,JSON.stringify([id,p.name,p.level,p.building,p.time,model.lands_by_level[p.level],p.inputs.map(([up,q])=>[sig.get(up),q])]));return memo.get(id);
 }
 model.products.forEach(p=>visit(p.id));metrics=memo;signs=sig;
 for(const b of model.buildings)if(!Number.isInteger(b.level)||b.level<1||b.level>20)throw Error(b.name+'：建筑等级需为1—20');
 for(const p of model.products){
  if(!p.name.trim()||!Number.isFinite(p.time)||p.time<=0)throw Error(p.name+'：请填写正数时间');
  if(!Number.isInteger(p.level)||p.level<1||p.level>20)throw Error(p.name+'：解锁等级需为1—20');
  if(p.building&&!B(p.building))throw Error(p.name+'：所属建筑不存在');
  if(p.building&&B(p.building).level>p.level)issue(p.id,{kind:'building',message:`所属建筑${B(p.building).name} Lv${B(p.building).level}尚未解锁，请调整所属建筑`});
  if(p.building&&!p.inputs.length)issue(p.id,{kind:'empty',message:'没有原料，请重新设计配方'});
  if(!p.building&&p.inputs.length)throw Error(p.name+'：作物不需要配方');
  for(const [up,q]of p.inputs){if(P(up).level>p.level)issue(p.id,{kind:'ingredient',up,quantity:q,message:`使用${P(up).name} Lv${P(up).level}×${q}，晚于本品Lv${p.level}，请重新设计配方`});if(!Number.isInteger(q)||q<1)throw Error(p.name+'：数量须为正整数')}
  if([...M(p.id).bom.values()].reduce((s,q)=>s+q,0)>500)throw Error(p.name+'：全链超过500次生产');
 }
 const blocked=new Map(),roots=new Map();function dependent(id){if(roots.has(id))return roots.get(id);const found=new Set(issues.has(id)?[id]:[]);for(const [up]of P(id).inputs)for(const root of dependent(up))found.add(root);roots.set(id,found);if(found.size)blocked.set(id,[...found]);return found}model.products.forEach(p=>dependent(p.id));recipeIssues=issues;recipeBlocked=blocked;
}

function signaturesFor(m){const current=model,oldMetrics=metrics,oldSign=signs,oldIssues=recipeIssues,oldBlocked=recipeBlocked;model=m;try{calculateLocal();return new Map(signs)}finally{model=current;metrics=oldMetrics;signs=oldSign;recipeIssues=oldIssues;recipeBlocked=oldBlocked}}
function draftActive(){const e=document.activeElement;if(!e||e.tagName!=='INPUT')return false;const id=Number(e.dataset.time||e.dataset.target);if(e.dataset.time)return e.value!==String(P(id)?.time);if(e.dataset.target){const q=P(id)?.inputs.find(([up])=>up===Number(e.dataset.up))?.[1]||0;return (e.value?Number(e.value):0)!==q}return false}
function change(fn){history.push(clone(model));if(history.length>30)history.shift();fn();sort();version++;saveLocal();clearTimeout(timer);try{calculateLocal();showError();busy=true;status('正在重算…','busy');render();timer=setTimeout(recalculate,280)}catch(e){busy=false;showError(e.message);render()}}
async function recalculate(){
 const currentVersion=version,input=clone(model);input.products=input.products.filter(p=>!recipeBlocked.has(p.id));
 const readyStatus=()=>status(recipeIssues.size?`已更新 · ${recipeIssues.size}处配方待设计`:!model.products.length?'空方案':analysis.all_unlock_schedules_proven_optimal?'全部已更新':'已更新 · 部分未证最优',recipeIssues.size?'bad':'');
 if(!input.products.length){analysis={products:[],all_unlock_schedules_proven_optimal:true};snapshot=input;oldSigns=new Map();busy=false;showError();readyStatus();render();return}
 busy=true;showError();status('正在重算…','busy');buttons();
 try{let r=await post('/api/calculate',input);if(r.jobId)r=await waitJob(r.jobId,j=>{if(version===currentVersion&&!exporting)status(`重算 ${j.current}/${j.total}`,'busy')},()=>version===currentVersion);if(currentVersion!==version||!r)return;analysis=r.analysis;snapshot=input;oldSigns=signaturesFor(snapshot);busy=false;showError();readyStatus();render()}catch(e){if(currentVersion!==version)return;busy=false;showError(e.message);render()}
}

function filtered(){const query=$('search').value.trim(),building=$('buildingFilter').value,level=Number($('levelFilter').value);return model.products.filter(p=>p.level<=level&&(building==='all'||p.building===Number(building))&&(!query||p.name.includes(query)||String(p.id).includes(query)))}
function val(id,key){const p=P(id),m=M(id);if(error||!m)return'—';if(recipeBlocked.has(id))return'<span class="pending recipe-blocked">配方待设计</span>';if(key==='W')return withUnit(m.work);if(key==='D')return withUnit(m.depth,'层');if(key==='R')return withUnit(m.R,'种');if(key==='K')return withUnit(m.K,'种');if(!fresh(id))return'<span class="pending">待重算</span>';const s=A(id).schedule_at_unlock;if(!s.is_proven_optimal)return'<span class="pending">未证最优</span>';return withUnit(key==='T'?s.optimal_minutes:s.optimal_minutes-p.time)}
function modelbar(){const key=JSON.stringify([model.lands_by_level,model.products.map(p=>[p.id,p.building]),model.buildings]);if(key===lastModelbarStructure)return;lastModelbarStructure=key;const crops=model.products.filter(p=>!p.building).length,steps=[];for(let lv=1;lv<=20;lv++)if(lv===1||model.lands_by_level[lv]!==model.lands_by_level[lv-1])steps.push(`<b>Lv${lv} / ${model.lands_by_level[lv]}片</b>`);$('modelbar').innerHTML=`<span><b>20</b> 级</span><span><b>${crops}</b> 作物 · <b>${model.products.length-crops}</b> 加工品</span><span><b>${model.buildings.length}</b> 建筑 · 各 1 工位</span><span class="landline">田地 ${steps.join('<i>→</i>')}</span><span class="fixed-note">每次产 1 件</span>`;const old=$('buildingFilter').value;$('buildingFilter').innerHTML='<option value="all">全部建筑</option><option value="0">农田</option>'+model.buildings.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');$('buildingFilter').value=[...$('buildingFilter').options].some(o=>o.value===old)?old:'all'}
function levels(rows){$('dataTable').className='levels-table';function group(ps,lv,kind){return ps.map(p=>`<span class="level-token" style="--chip:${color(p.building)}"><button class="token-name" data-edit-product="${p.id}" draggable="true" data-drag-id="${p.id}" title="点击修改名称和建筑；拖到其他等级">${esc(p.name)}</button><button class="token-delete" data-delete-id="${p.id}" aria-label="删除${esc(p.name)}" title="删除">×</button></span>`).join('')+`<button class="level-add" data-add="${kind}" data-level="${lv}" aria-label="${lv}级新增${kind==='crop'?'作物':'物品'}">＋</button>`}const maximum=Number($('levelFilter').value);$('dataTable').innerHTML='<thead><tr>'+['等级','新增土地','累计土地','新增作物','新增建筑','新增物品'].map((x,i)=>`<th class="${i===0?'product-col':''}">${x}</th>`).join('')+'</tr></thead><tbody>'+Array.from({length:maximum},(_,i)=>{const lv=i+1,ps=rows.filter(p=>p.level===lv),lands=lv===1?6:model.lands_by_level[lv]-model.lands_by_level[lv-1];return`<tr data-drop-level="${lv}" class="${lands?'expansion-row':''}"><td class="product-col level-number">Lv ${lv}</td><td class="land-cell">${lv===1?'6':`<select data-land="${lv}" aria-label="${lv}级新增土地"><option value="0" ${lands===0?'selected':''}>0</option><option value="6" ${lands===6?'selected':''}>6</option></select>`}</td><td>${model.lands_by_level[lv]}</td><td>${group(ps.filter(p=>!p.building),lv,'crop')}</td><td>${model.buildings.filter(b=>b.level===lv).map(b=>`<span class="level-token" style="--chip:${b.color}"><button class="token-name" data-rename-building="${b.id}" title="点击改名；拖到其他等级" draggable="true" data-drag-building="${b.id}">${esc(b.name)}</button><button class="token-delete" data-delete-building="${b.id}" aria-label="删除${esc(b.name)}" title="删除">×</button></span>`).join('')}<button class="level-add" data-add="building" data-level="${lv}" aria-label="${lv}级新增建筑">＋</button></td><td>${group(ps.filter(p=>p.building),lv,'product')}</td></tr>`}).join('')+'</tbody>'}
function header(targets,label){return'<thead><tr><th class="product-col">'+label+'</th>'+targets.map((p,j)=>`<th class="${j&&targets[j-1].building!==p.building?'group-left ':''}${p.id===active?'col-selected':''}" style="background:${color(p.building)}"><button class="column-name" data-rename-product="${p.id}" title="点击改名">${esc(p.name)}</button><small class="col-level">Lv ${p.level}</small></th>`).join('')+'</tr></thead>'}
function metricRows(targets){
 const definitions=[['W','累计时间','min','全链生产次数×本项时间求和，含作物和目标'],['T','优化时间','min','空仓、田地并行、同建筑串行的最短完工时间'],['wait','空仓等待时间','min','优化时间－本步时间'],['D','加工链深度','层','最长依赖路径的加工层数，作物为0'],['R','单步复杂度','种','直接投入的商品种类数'],['K','累计复杂度','种','全链去重商品种类数，含目标自身']];
 const boundary=j=>j&&targets[j-1].building!==targets[j].building?'group-left':'';
 let html='<tr class="metric-toggle-row"><td class="product-col"><button id="toggleMetrics" class="text-button" aria-expanded="'+expanded+'" aria-label="'+(expanded?'折叠计算指标':'展开计算指标')+'">'+(expanded?'▾ 折叠指标':'▸ 展开指标')+'</button></td>'+targets.map((p,j)=>'<td class="'+boundary(j)+'"></td>').join('')+'</tr>';
 if(expanded)html+=definitions.map(([key,label,unit,description])=>'<tr class="metric-row" data-metric="'+key+'"><td class="product-col" title="'+description+'">'+label+'</td>'+targets.map((p,j)=>'<td class="metric-value '+boundary(j)+(key==='T'?' metric-optimal':'')+'" data-product="'+p.id+'">'+val(p.id,key)+'</td>').join('')+'</tr>').join('');
 return html;
}
$('dataTable').addEventListener('click',event=>{if(event.target.closest('#toggleMetrics')){expanded=!expanded;render(true)}});
function unitMatrix(targets){$('dataTable').className='matrix unit-matrix';const groupClass=(targets,j)=>j&&targets[j-1].building!==targets[j].building?'group-left':'';let html=header(targets,'投入工序 / 目标物品')+'<tbody><tr class="unit-control"><td class="product-col">所属建筑</td>'+targets.map((p,j)=>`<td class="${groupClass(targets,j)}">${p.building?`<select data-building="${p.id}" aria-label="${esc(p.name)}所属建筑">${model.buildings.map(b=>`<option value="${b.id}" ${b.id===p.building?'selected':''}>${esc(b.name)}</option>`).join('')}</select>`:'<span class="crop-label">农田</span>'}</td>`).join('')+'</tr><tr class="unit-control time-row"><td class="product-col">单步时间</td>'+targets.map((p,j)=>`<td class="${groupClass(targets,j)}"><span class="time-input-wrap"><input type="number" step="any" min="0" data-time="${p.id}" value="${p.time}" aria-label="${esc(p.name)}单步时间"><span class="input-unit">min</span><span class="time-arrows"><button type="button" data-time-step="5" data-time-id="${p.id}" aria-label="${esc(p.name)}增加5分钟">▴</button><button type="button" data-time-step="-5" data-time-id="${p.id}" aria-label="${esc(p.name)}减少5分钟">▾</button></span></span></td>`).join('')+'</tr>'+metricRows(targets)+'<tr class="matrix-separator"><td class="product-col">配方投入 <small>件</small></td>'+targets.map(p=>'<td></td>').join('')+'</tr>';
html+=model.products.map((up,i)=>`<tr class="${i&&model.products[i-1].building!==up.building?'group-start':''}"><td class="product-col" style="background:${color(up.building)}"><span>${esc(up.name)}</span><small>${esc(up.buildingName)}</small></td>${targets.map((p,j)=>{const q=p.inputs.find(([id])=>id===up.id)?.[1]||0,own=p.id===up.id,allowed=p.building&&!own&&(up.level<=p.level||q>0);return`<td class="${groupClass(targets,j)} ${own?'diag':allowed?'':'locked'}">${own?'1':allowed?`<input type="number" min="0" step="1" value="${q||''}" data-target="${p.id}" data-up="${up.id}" class="quantity ${q?'has-value':''}" aria-label="${esc(p.name)}投入${esc(up.name)}数量" placeholder="">`:''}</td>`}).join('')}</tr>`).join('');$('dataTable').innerHTML=html+'</tbody>';if(!targets.length)$('dataTable').innerHTML='<tr><td class="empty">没有匹配的物品</td></tr>'}
function loadMatrix(targets){$('dataTable').className='matrix';const sources=loadMode==='process'?model.products:[{id:0,name:'农田',building:0},...model.buildings.map(b=>({id:b.id,name:b.name,building:b.id}))];$('dataTable').innerHTML=header(targets,loadMode==='process'?'上游工序 / 目标物品':'建筑 / 目标物品')+'<tbody>'+sources.map((up,i)=>`<tr class="${loadMode==='building'||i&&sources[i-1].building!==up.building?'group-start':''}"><td class="product-col" style="background:${color(up.building)}">${esc(up.name)}<small>${loadMode==='process'?esc(up.buildingName):'同建筑工序合计'}</small></td>${targets.map((p,j)=>{let value=0;if(!error&&!recipeBlocked.has(p.id)){if(loadMode==='process')value=(M(p.id).bom.get(up.id)||0)*up.time/p.time;else value=(M(p.id).resourceMinutes.get(up.id)||0)/p.time}return`<td class="${j&&targets[j-1].building!==p.building?'group-left ':''}${up.id===p.id&&loadMode==='process'?'diag':value>1.00000001?'pressure-high':''}">${error||recipeBlocked.has(p.id)?'—':value?fmt(value):''}</td>`}).join('')}</tr>`).join('')+'</tbody>'}
function channelMinutesMatrix(targets){
 $('dataTable').className='matrix channel-minutes';
 const sources=[{id:0,name:'农田',note:'各地块工序累加'},...model.buildings.map(b=>({id:b.id,name:b.name,note:'全链工序累加'}))];
 const boundary=j=>j&&targets[j-1].building!==targets[j].building?'group-left':'';
 const cell=(p,j,value,total=false)=>`<td class="${boundary(j)} ${total?'channel-total':''} ${value===0?'channel-unused':''}">${error?'—':recipeBlocked.has(p.id)?'<span class="pending recipe-blocked">配方待设计</span>':withUnit(value)}</td>`;
 let html=header(targets,'生产渠道 / 目标物品')+'<tbody>';
 html+=sources.map(up=>`<tr class="group-start"><td class="product-col" style="background:${color(up.id)}">${esc(up.name)}<small>${up.note}</small></td>${targets.map((p,j)=>cell(p,j,M(p.id)?.resourceMinutes.get(up.id)||0)).join('')}</tr>`).join('');
 html+=`<tr class="group-start channel-total-row"><td class="product-col">合计<small>等于累计时间</small></td>${targets.map((p,j)=>cell(p,j,M(p.id)?.work||0,true)).join('')}</tr></tbody>`;
 $('dataTable').innerHTML=targets.length?html:'<tr><td class="empty">没有匹配的物品</td></tr>';
}
function outputs(){const panel=$('resultsPanel');panel.hidden=true;panel.innerHTML=''}

function turnoverValue(row,value){return value===null?'—':(row.complete?'':'≥ ')+withUnit(value,'件')}
function turnoverDetail(row,id){
 if(row.capacities.get(id)===null)return `Lv ${P(id).level}尚未解锁`;
 const list=row.details.get(id)||[];
 const text=list.map(d=>`${B(d.building).name}：${d.quantity}件 × ${d.slots}次 = ${d.amount}件（${d.products.map(up=>P(up).name).join(' / ')}）`).join('；')||'已解锁配方不消耗此商品';
 return text+(row.complete?'':'；存在配方待设计，当前仅为已配置有效配方的下限');
}
function turnoverMatrix(targets){
 $('dataTable').className='matrix turnover-matrix';
 const stats=ChainTurnover.rows(model),maximum=Number($('levelFilter').value);
 let html='<thead><tr><th class="product-col">等级 / 周转容量</th><th class="turnover-total-head">全仓单次<br>投料上限<small>件</small></th>'+targets.map((p,j)=>`<th class="${!j||targets[j-1].building!==p.building?'group-left':''}" style="background:${color(p.building)}"><span class="column-name">${esc(p.name)}</span><small class="col-level">Lv ${p.level}</small></th>`).join('')+'</tr></thead><tbody>';
 html+=stats.slice(0,maximum).map(row=>`<tr data-turnover-level="${row.level}" class="${row.level>1&&(row.level-1)%5===0?'group-start':''}"><td class="product-col">Lv ${row.level}<small data-turnover-warning>${row.complete?'':esc(row.invalid.length+'项配方待设计')}</small></td><td class="turnover-total" data-turnover-total>${turnoverValue(row,row.total)}</td>${targets.map((p,j)=>`<td data-turnover-product="${p.id}" class="${!j||targets[j-1].building!==p.building?'group-left ':''}${row.capacities.get(p.id)===null?'locked':''}" title="${esc(turnoverDetail(row,p.id))}">${turnoverValue(row,row.capacities.get(p.id))}</td>`).join('')}</tr>`).join('');
 $('dataTable').innerHTML=html+'</tbody>';
}
function refreshTurnoverMatrix(){
 const stats=ChainTurnover.rows(model);
 for(const node of $('dataTable').querySelectorAll('[data-turnover-level]')){
  const row=stats[Number(node.dataset.turnoverLevel)-1];
  node.querySelector('[data-turnover-total]').innerHTML=turnoverValue(row,row.total);
  node.querySelector('[data-turnover-warning]').textContent=row.complete?'':row.invalid.length+'项配方待设计';
  for(const cell of node.querySelectorAll('[data-turnover-product]')){const id=Number(cell.dataset.turnoverProduct);cell.innerHTML=turnoverValue(row,row.capacities.get(id));cell.title=turnoverDetail(row,id)}
 }
}
function renderQueueDialog(){
 const config=ChainTurnover.settings(model);$('queueIncludeActive').checked=config.includeActive;
 const table=$('queueTable');
 const html='<thead><tr><th>等级</th>'+model.buildings.map(b=>`<th style="background:${b.color}">${esc(b.name)}<small>Lv ${b.level}</small></th>`).join('')+'</tr></thead><tbody>'+Array.from({length:20},(_,i)=>{const level=i+1;return'<tr><th>Lv '+level+'</th>'+model.buildings.map(b=>level<b.level?'<td class="queue-locked">未解锁</td>':`<td><input type="number" min="0" step="1" data-queue-building="${b.id}" data-queue-level="${level}" value="${config.queues[b.id][i]}" aria-label="${esc(b.name)}${level}级队列等待长度"></td>`).join('')+'</tr>'}).join('')+'</tbody>';
 syncMarkup(table,html);
 $('queueDialogNote').textContent=config.includeActive?'默认2个等待位 + 1个在产位 = 可投料3次。':'队列长度就是可投料次数，含在产位；默认可投料2次。';
}
function commitQueueSettings(fn){
 const draft=clone(model);fn(draft);draft.turnover=ChainTurnover.settings(draft);ChainTurnover.rows(draft);
 if(JSON.stringify(draft.turnover)===JSON.stringify(ChainTurnover.settings(model)))return;
 history.push(clone(model));if(history.length>30)history.shift();model.turnover=draft.turnover;saveLocal();render();if($('queueDialog').open)renderQueueDialog();
}
let queueDrafts=new Map(),queueTimer;
function queueDraft(field){const key=field.dataset.queueBuilding+':'+field.dataset.queueLevel;queueDrafts.delete(key);queueDrafts.set(key,{bid:Number(field.dataset.queueBuilding),level:Number(field.dataset.queueLevel),text:field.value})}
function flushQueueDrafts(){
 clearTimeout(queueTimer);if(!queueDrafts.size)return;
 const records=[...queueDrafts.values()];queueDrafts.clear();const valid=[],invalid=[];
 for(const record of records){const n=Number(record.text);if(!record.text.trim()||!Number.isSafeInteger(n)||n<0)invalid.push(record);else valid.push({...record,value:n})}
 try{if(valid.length)commitQueueSettings(draft=>{for(const record of valid)ChainTurnover.setQueue(draft,record.bid,record.level,record.value)})}
 catch(e){invalid.push(...valid);toast(e.message)}
 for(const record of invalid){const field=document.querySelector(`[data-queue-building="${record.bid}"][data-queue-level="${record.level}"]`);if(field)field.value=ChainTurnover.settings(model).queues[record.bid][record.level-1]}
 if(invalid.length)toast('队列等待长度须为非负整数');
}
$('queueOpen').onclick=()=>{renderQueueDialog();$('queueDialog').showModal()};
$('queueClose').onclick=()=>{flushQueueDrafts();$('queueDialog').close()};
$('queueDialog').addEventListener('click',event=>{if(event.target===$('queueDialog')){flushQueueDrafts();$('queueDialog').close()}});
$('queueDialog').addEventListener('close',flushQueueDrafts);
$('queueIncludeActive').addEventListener('change',event=>{const checked=event.target.checked;flushQueueDrafts();commitQueueSettings(draft=>{draft.turnover=ChainTurnover.settings(draft);draft.turnover.includeActive=checked})});
document.addEventListener('input',event=>{if(!event.target.dataset.queueBuilding)return;queueDraft(event.target);clearTimeout(queueTimer);queueTimer=setTimeout(flushQueueDrafts,350)});
document.addEventListener('focusout',event=>{if(event.target.dataset.queueBuilding)flushQueueDrafts()});
document.addEventListener('change',event=>{
 const field=event.target;if(!field.dataset.queueBuilding)return;queueDraft(field);flushQueueDrafts();
});
$('turnoverCsv').onclick=()=>{
 const config=ChainTurnover.settings(model),data=ChainTurnover.rows(model),cell=x=>'"'+String(x).replace(/"/g,'""')+'"';
 const rows=[['预期仓容=单次投料+作物种类×12+加工品种类×2；各商品投料最大值不可相加；'+(config.includeActive?'等待队列+在产1件':'队列已含在产位')],['等级','状态','全仓单次投料上限/件','作物种类数','加工品种类数','作物备货/件','加工品备货/件','订单备货合计/件','预期仓容/件',...model.buildings.map(b=>b.name+'等待长度'),...model.products.map(p=>p.name+'/件')]];
 for(const row of data)rows.push([row.level,row.complete?'完整':'配方待设计：仅为下限',row.total,row.cropKinds,row.productKinds,row.cropStock,row.productStock,row.orderStock,row.expectedCapacity,...model.buildings.map(b=>row.queues.get(b.id)??'未解锁'),...model.products.map(p=>row.capacities.get(p.id)??'未解锁')]);
 download('\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n'),'商品周转容量_'+date()+'.csv','text/csv;charset=utf-8');toast('已导出全部20级周转容量和队列设置');
};

function scheduleTable(rows){$('dataTable').className='schedule-table';$('dataTable').innerHTML='<thead><tr>'+['物品','等级','田地数','严格下界','优化时间','可行上界','状态'].map((x,i)=>`<th class="${i===0?'product-col':''}">${x}</th>`).join('')+'</tr></thead><tbody>'+rows.map(p=>{const s=A(p.id)?.schedule_at_unlock,f=fresh(p.id);return`<tr class="${p.id===active?'selected':''}"><td class="product-col"><button class="text-button" data-schedule-id="${p.id}">${esc(p.name)}</button></td><td>${p.level}</td><td>${model.lands_by_level[p.level]}</td><td>${f?withUnit(s.lower_bound_minutes):'—'}</td><td>${val(p.id,'T')}</td><td>${f?withUnit(s.feasible_minutes):'—'}</td><td>${f?s.is_proven_optimal?'已证明最优':'未证最优':recipeBlocked.has(p.id)?'配方待设计':'待重算'}</td></tr>`}).join('')+'</tbody>'}
function timeline(){const panel=$('schedulePanel');panel.hidden=view!=='schedule';if(view!=='schedule')return;if(!model.products.length){panel.innerHTML='<p>暂无物品，请到等级规划点＋新增。</p>';return}const p=P(active)||model.products[0];active=p.id;if(!fresh(p.id)){panel.innerHTML='<h3>'+esc(p.name)+' · 排程待重算</h3>';return}const s=A(p.id).schedule_at_unlock,lanes=[];for(const resource of new Set(s.schedule.map(t=>t.resource))){const tasks=s.schedule.filter(t=>t.resource===resource).sort((a,b)=>a.start_minutes-b.start_minutes),rows=[];for(const t of tasks){let index=rows.findIndex(r=>r.end<=t.start_minutes+1e-8);if(index<0){index=rows.length;rows.push({end:0,tasks:[]})}rows[index].end=t.end_minutes;rows[index].tasks.push(t)}rows.forEach((row,i)=>lanes.push({name:resource==='土地'?'农田 '+(i+1):B(Number(resource))?.name||resource,tasks:row.tasks}))}const width=1100,left=100,plot=width-left-25,height=lanes.length*38+40,scale=plot/s.feasible_minutes;let svg=`<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-label="排程时间线" role="img">`;for(let i=0;i<=5;i++){const x=left+plot*i/5;svg+=`<line x1="${x}" x2="${x}" y1="24" y2="${height}" stroke="#e6ebdf"/><text x="${x}" y="14" text-anchor="middle">${fmt(s.feasible_minutes*i/5)} min</text>`}lanes.forEach((lane,i)=>{const y=30+38*i;svg+=`<text x="0" y="${y+16}">${esc(lane.name)}</text>`;for(const t of lane.tasks){const x=left+t.start_minutes*scale,w=Math.max(1,(t.end_minutes-t.start_minutes)*scale);svg+=`<g><title>${esc(t.name)}：${fmt(t.start_minutes)}—${fmt(t.end_minutes)} min</title><rect x="${x}" y="${y}" width="${w}" height="25" rx="3" fill="${color(P(t.product_id).building)}" stroke="#a8b29a"/>${w>50?`<text x="${x+w/2}" y="${y+17}" text-anchor="middle">${esc(t.name)}</text>`:''}</g>`}});svg+='</svg>';panel.innerHTML=`<h3>${esc(p.name)} · ${s.is_proven_optimal?'最优排程':'可行排程（未证最优）'}</h3><p>${s.is_proven_optimal?'最优完工 '+fmt(s.optimal_minutes):'最优区间 '+fmt(s.lower_bound_minutes)+'—'+fmt(s.feasible_minutes)} min · ${model.lands_by_level[p.level]}片田地 · 同建筑串行</p><div class="timeline">${svg}</div>`}
function buttons(){$('undoBtn').disabled=!history.length;$('exportBtn').disabled=!!error||recipeBlocked.size>0||busy||exporting||!model?.products.length;$('exportBtn').textContent=exporting?'正在导出…':'导出 Excel ↗'}
function render(force=false){if(!model)return;if(!force&&draftActive()){pendingRender=true;buttons();return}pendingRender=false;const focused=document.activeElement,focusSelector=focused?.dataset.time?`[data-time="${focused.dataset.time}"]`:focused?.dataset.target?`[data-target="${focused.dataset.target}"][data-up="${focused.dataset.up}"]`:null;modelbar();const rows=filtered(),title={levels:['等级解锁规划','＋ 直接新增 · 点击物品修改信息 · 拖动可调整等级'],main:['单位矩阵','这里只调整建筑、时间、投入数量；空白为不投入，蓝色1为本品产出'],load:['工序负载矩阵','上游需求量 × 上游时间 ÷ 目标时间 · 粗线分隔不同建筑'],turnover:['各等级商品周转容量','各建筑最大直接耗量 × 可投料次数，再对建筑求和 · 指向数字可查看来源'],channels:['各渠道累计时间','从零做1件 · 全链工序次数 × 单步时间，按生产渠道汇总 · 农田不除地块数'],schedule:['空仓排程','按本品解锁等级的田地数计算 · 点击物品查看时间线']}[view];$('viewTitle').querySelector('h2').textContent=title[0];$('viewSubtitle').textContent=title[1];document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===view));$('loadControls').hidden=view!=='load';$('turnoverControls').hidden=view!=='turnover';const scroll=$('tableScroll'),x=scroll.scrollLeft,y=scroll.scrollTop;const structure=JSON.stringify([view,expanded,rows.map(p=>p.id),model.products.map(p=>[p.id,p.name,p.level,p.building]),model.buildings]);
if(view==='main'&&structure===lastMatrixStructure)refreshUnitMatrix();else if(view==='turnover'&&structure===lastMatrixStructure)refreshTurnoverMatrix();else{if(view==='levels')levels(rows);else if(view==='main'){unitMatrix(rows);$('dataTable').style.width=(148+rows.length*92)+'px'}else if(view==='load'){loadMatrix(rows);$('dataTable').style.width=(148+rows.length*92)+'px'}else if(view==='channels'){channelMinutesMatrix(rows);$('dataTable').style.width=(148+rows.length*92)+'px'}else if(view==='turnover'){turnoverMatrix(rows);$('dataTable').style.width=(148+(rows.length+1)*92)+'px'}else scheduleTable(rows);if(!['main','load','channels','turnover'].includes(view))$('dataTable').style.width='';lastMatrixStructure=structure}
scroll.scrollLeft=x;scroll.scrollTop=y;outputs(rows);timeline();markRecipeIssues();$('countLabel').textContent=`${rows.length} / ${model.products.length} 个物品`;$('footerNote').textContent=view==='levels'?'等级表不填写时间和配方':'输入自动保存到本机';buttons();if(focusSelector&&view==='main'){const next=document.querySelector(focusSelector);if(next&&next!==focused)next.focus({preventScroll:true})}}
let inputTimer,inputDrafts=new Map();
function flushInputDrafts(){
 clearTimeout(inputTimer);const drafts=[...inputDrafts.values()];inputDrafts.clear();const edits=[];
 for(const data of drafts){const p=P(data.time||data.target);if(!p)continue;const n=data.text?Number(data.text):0;
  if(data.time){if(data.text&&Number.isFinite(n)&&n>0&&p.time!==n)edits.push({id:p.id,time:n})}
  else if(Number.isInteger(n)&&n>=0&&n!==(p.inputs.find(([id])=>id===Number(data.up))?.[1]||0))edits.push({id:p.id,up:Number(data.up),quantity:n});
 }
 if(edits.length)change(()=>{for(const edit of edits){const p=P(edit.id);if(edit.time!==undefined)p.time=edit.time;else{p.inputs=p.inputs.filter(([up])=>up!==edit.up);if(edit.quantity)p.inputs.push([edit.up,edit.quantity]);p.inputs.sort((a,b)=>a[0]-b[0])}}});
}
document.addEventListener('change',flushInputDrafts,true);
document.addEventListener('input',event=>{const field=event.target;if(!field.dataset.time&&!field.dataset.target)return;const data={time:field.dataset.time,target:field.dataset.target,up:field.dataset.up,text:field.value};inputDrafts.set(data.time?'time:'+data.time:'quantity:'+data.target+':'+data.up,data);clearTimeout(inputTimer);inputTimer=setTimeout(flushInputDrafts,350)});

function newName(prefix,items){let i=1;while(items.some(x=>x.name===prefix+i))i++;return prefix+i}
function stepProductionTime(id,delta){flushInputDrafts();const p=P(id),input=document.querySelector(`[data-time="${id}"]`),current=Number(input?.value??p.time),next=Number((current+delta).toFixed(8));if(!Number.isFinite(current)||!input?.value||current<=0){toast('请先填写正数时间');return}if(next<=0){toast('时间需大于0，不能继续减少');return}clearTimeout(inputTimer);input.value=String(next);input.focus({preventScroll:true});change(()=>p.time=next)}
document.addEventListener('click',event=>{const e=event.target.closest('button[data-time-step]');if(e)stepProductionTime(Number(e.dataset.timeId),Number(e.dataset.timeStep))});
document.addEventListener('keydown',event=>{if(event.target.dataset.time&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();stepProductionTime(Number(event.target.dataset.time),event.key==='ArrowUp'?5:-5)}});
function add(kind,level){if(kind==='building'){const b={id:Math.max(500,...model.buildings.map(x=>x.id))+1,name:newName('新加工坊',model.buildings),level,color:['#DDEBF7','#FFF2CC','#F2DCDB','#FCE4D6','#E4DFEC','#DDEBD5'][model.buildings.length%6]};change(()=>model.buildings.push(b));toast('已新增建筑；点击名称可改名');return}const buildings=model.buildings.filter(b=>b.level<=level),crop=model.products.find(p=>!p.building&&p.level<=level);if(kind==='product'&&(!buildings.length||!crop)){toast(!buildings.length?'请先新增本级或更早的建筑':'请先新增作物');return}const factory=kind==='crop'?0:buildings.at(-1).id,id=Math.max(0,...model.products.map(p=>p.id))+1,name=newName(kind==='crop'?'新作物':'新物品',model.products);change(()=>{model.products.push({id,name,level,building:factory,buildingName:factory?B(factory).name:'农田',time:kind==='crop'?2:10,inputs:factory?[[crop.id,1]]:[],type:factory?'加工品':'作物',yield:1});active=id});toast('已新增；点击物品修改名称和建筑')}
let editingProduct=null;
function editProduct(id){
 flushInputDrafts();const p=P(id);if(!p)return;
 editingProduct=id;$('productEditTitle').textContent=p.building?'编辑物品':'编辑作物';
 $('productEditName').value=p.name;$('productEditError').textContent='';
 const field=$('productEditBuilding');field.disabled=!p.building;
 field.innerHTML=p.building?model.buildings.map(b=>`<option value="${b.id}" ${b.id===p.building?'selected':''} ${b.level>p.level&&b.id!==p.building?'disabled':''}>${esc(b.name)}${b.level>p.level?'（本级未解锁）':''}</option>`).join(''):'<option value="0">农田</option>';
 $('productEditDialog').showModal();$('productEditName').focus({preventScroll:true});$('productEditName').select();
}
function saveProductEdit(event){
 event.preventDefault();const p=P(editingProduct);if(!p)return;
 const name=$('productEditName').value.trim(),building=Number($('productEditBuilding').value);
 const invalid=message=>{$('productEditError').textContent=message};
 if(!name){invalid('请输入名称');$('productEditName').focus();return}
 if(model.products.some(other=>other.id!==p.id&&other.name===name)){invalid('名称已存在');$('productEditName').focus();return}
 if(p.building&&(!B(building)||building!==p.building&&B(building).level>p.level)){invalid('请选择本级已解锁的建筑');return}
 const changed=p.name!==name||p.building!==building;
 $('productEditDialog').close();
 if(changed)change(()=>{p.name=name;p.building=building});
}
$('productEditForm').addEventListener('submit',saveProductEdit);
for(const id of ['productEditClose','productEditCancel'])$(id).addEventListener('click',()=>$('productEditDialog').close());
$('productEditDialog').addEventListener('close',()=>{editingProduct=null});
function rename(kind,id){const item=kind==='building'?B(id):P(id),name=prompt('修改名称',item.name)?.trim();if(!name||name===item.name)return;if((kind==='building'?model.buildings:model.products).some(x=>x.id!==id&&x.name===name)){toast('名称已存在');return}change(()=>item.name=name)}
function remove(kind,id){const refs=kind==='building'?model.products.filter(p=>p.building===id):model.products.filter(p=>p.inputs.some(([up])=>up===id));if(refs.length){toast('仍被使用：'+refs.map(p=>p.name).join('、'));return}change(()=>{if(kind==='building'){model.buildings=model.buildings.filter(b=>b.id!==id);if(model.turnover?.queues)delete model.turnover.queues[id]}else model.products=model.products.filter(p=>p.id!==id);if(!P(active))active=model.products[0]?.id||null})}
document.addEventListener('click',event=>{const e=event.target.closest('button');if(!e)return;if(e.dataset.tab){view=e.dataset.tab;render(true)}else if(e.dataset.add)add(e.dataset.add,Number(e.dataset.level));else if(e.dataset.editProduct)editProduct(Number(e.dataset.editProduct));else if(e.dataset.renameProduct)rename('product',Number(e.dataset.renameProduct));else if(e.dataset.renameBuilding)rename('building',Number(e.dataset.renameBuilding));else if(e.dataset.deleteId)remove('product',Number(e.dataset.deleteId));else if(e.dataset.deleteBuilding)remove('building',Number(e.dataset.deleteBuilding));else if(e.dataset.scheduleId){active=Number(e.dataset.scheduleId);render(true)}else if(e.dataset.load){loadMode=e.dataset.load;document.querySelectorAll('[data-load]').forEach(b=>b.classList.toggle('active',b===e));render(true)}});
document.addEventListener('change',event=>{const e=event.target;if(e.dataset.land){const lv=Number(e.dataset.land),delta=Number(e.value)-(model.lands_by_level[lv]-model.lands_by_level[lv-1]);change(()=>{for(let l=lv;l<=20;l++)model.lands_by_level[l]+=delta})}else if(e.dataset.time){const p=P(e.dataset.time),n=Number(e.value);if(!e.value||!Number.isFinite(n)||n<=0){e.value=p.time;toast('请输入正数时间');return}if(p.time!==n)change(()=>p.time=n)}else if(e.dataset.building){const p=P(e.dataset.building);if(p.building!==Number(e.value))change(()=>p.building=Number(e.value))}else if(e.dataset.target){const target=P(e.dataset.target),up=Number(e.dataset.up),n=e.value?Number(e.value):0;if(!Number.isInteger(n)||n<0){e.value=target.inputs.find(([id])=>id===up)?.[1]||'';toast('投入件数须为非负整数');return}if(n===(target.inputs.find(([id])=>id===up)?.[1]||0))return;change(()=>{target.inputs=target.inputs.filter(([id])=>id!==up);if(n)target.inputs.push([up,n]);target.inputs.sort((a,b)=>a[0]-b[0])})}});
document.addEventListener('focusout',()=>setTimeout(()=>{if(pendingRender&&!draftActive())render()},0));
let dragged=null;document.addEventListener('dragstart',e=>{const token=e.target.closest('[data-drag-id],[data-drag-building]');if(!token)return;dragged={kind:token.dataset.dragBuilding?'building':'product',id:Number(token.dataset.dragBuilding||token.dataset.dragId)};e.dataTransfer.setData('text/plain',JSON.stringify(dragged));e.dataTransfer.effectAllowed='move'});document.addEventListener('dragover',e=>{if(dragged&&e.target.closest('[data-drop-level]')){e.preventDefault();e.dataTransfer.dropEffect='move'}});document.addEventListener('drop',e=>{const row=e.target.closest('[data-drop-level]');if(!row||!dragged)return;e.preventDefault();const item=dragged.kind==='building'?B(dragged.id):P(dragged.id),level=Number(row.dataset.dropLevel);if(item.level!==level)change(()=>item.level=level);dragged=null});document.addEventListener('dragend',()=>dragged=null);
function flushVisible(){clearTimeout(inputTimer);inputDrafts.clear();const times=[],quantities=[];document.querySelectorAll('input[data-time]').forEach(e=>{const p=P(e.dataset.time),n=Number(e.value);if(e.value&&Number.isFinite(n)&&n>0&&p.time!==n)times.push([p.id,n])});document.querySelectorAll('input[data-target]').forEach(e=>{const p=P(e.dataset.target),up=Number(e.dataset.up),n=e.value?Number(e.value):0;if(Number.isInteger(n)&&n>=0&&n!==(p.inputs.find(([id])=>id===up)?.[1]||0))quantities.push([p.id,up,n])});if(!times.length&&!quantities.length)return false;clearTimeout(inputTimer);change(()=>{times.forEach(([id,n])=>P(id).time=n);quantities.forEach(([id,up,n])=>{const p=P(id);p.inputs=p.inputs.filter(([key])=>key!==up);if(n)p.inputs.push([up,n]);p.inputs.sort((a,b)=>a[0]-b[0])})});clearTimeout(timer);return true}
function download(data,name,mime){const url=URL.createObjectURL(new Blob([data],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function date(){return new Date().toLocaleDateString('sv-SE')}
$('importBtn').onclick=()=>$('importFile').click();$('importFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{let r,goals=null;if(file.name.toLowerCase().endsWith('.xlsx'))r=await post('/api/import-excel',await file.arrayBuffer(),true);else{const payload=JSON.parse((await file.text()).replace(/^\uFEFF/,''));goals=validateImportedStageGoals(payload.stageTargets);r=await post('/api/validate',payload)}change(()=>model=r.design);if(goals)setStageGoals(goals);toast('方案已导入'+(goals?'，包含阶段预期':''))}catch(err){toast('导入失败：'+err.message)}e.target.value=''};
$('saveBtn').onclick=()=>{if(flushVisible()&&!error)recalculate();download(JSON.stringify({version:1,design:model,stageTargets:exportedStageGoals()},null,2),'加工链路方案_'+date()+'.json','application/json');toast('方案已保存，包含阶段预期')};
$('exportBtn').onclick=async()=>{if(error||recipeBlocked.size||busy||exporting)return;if(flushVisible()){if(error||recipeBlocked.size)return;await recalculate();if(error||recipeBlocked.size||busy)return}exporting=true;buttons();const current=version,count=model.products.length;try{const r=await post('/api/export',clone(model));await waitJob(r.jobId,j=>status(j.product==='正在生成Excel'?'正在生成 Excel…':`导出计算 ${j.current}/${j.total}`,'busy'));const f=await fetch('/api/download/'+r.jobId);if(!f.ok)throw Error('下载未完成');download(await f.arrayBuffer(),'加工链路数值设计表_'+date()+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');toast(`已导出 ${count} 个物品`+(current!==version?'；导出后续修改前的方案':''))}catch(e){toast(e.message)}finally{exporting=false;buttons();if(!busy&&!error)status('已更新')}};
$('undoBtn').onclick=()=>{if(!history.length)return;model=history.pop();version++;sort();saveLocal();clearTimeout(timer);try{calculateLocal();showError();busy=true;render(true);timer=setTimeout(recalculate,0)}catch(e){busy=false;showError(e.message);render(true)}};
$('clearBtn').onclick=()=>{flushVisible();clearTimeout(inputTimer);clearTimeout(timer);$('search').value='';$('buildingFilter').value='all';view='levels';change(()=>{model.products=[];model.buildings=[];delete model.turnover;model.lands_by_level=Object.fromEntries(Array.from({length:20},(_,i)=>[String(i+1),6]));active=null});toast('已清空，可点撤销恢复')};
$('resetBtn').onclick=()=>{if(confirm('恢复初始方案？可通过撤销恢复修改。'))change(()=>model=clone(seed))};
$('helpBtn').onclick=()=>$('help').showModal();$('closeHelp').onclick=()=>$('help').close();$('help').onclick=e=>{if(e.target===$('help'))$('help').close()};$('search').oninput=()=>render(true);$('buildingFilter').onchange=()=>render(true);$('levelFilter').onchange=()=>render(true);
async function boot(){try{const r=await fetch('/api/bootstrap');if(!r.ok)throw Error('服务未就绪');const data=await r.json();model=data.design;seed=clone(model);snapshot=clone(model);analysis=data.analysis;oldSigns=signaturesFor(snapshot);$('levelFilter').innerHTML=Array.from({length:20},(_,i)=>`<option value="${i+1}" ${i===19?'selected':''}>≤ ${i+1} 级</option>`).join('');try{const stored=JSON.parse(localStorage.getItem(STORE)||'null');if(stored?.version===1&&Array.isArray(stored.design?.products))model=stored.design}catch(e){toast('本机旧方案读取失败')}const namesUpdated=applyCraftNameUpdate20261014();sort();if(!P(active))active=model.products[0]?.id||null;try{calculateLocal();showError();render(true);if(!model.products.every(p=>fresh(p.id)))recalculate();else status(recipeIssues.size?`已更新 · ${recipeIssues.size}处配方待设计`:model.products.length?'全部已更新':'空方案',recipeIssues.size?'bad':'');if(namesUpdated)toast('已按清单更新商品和建筑名称，等级、时间和配方未改变；可撤销')}catch(e){showError(e.message);render(true)}}catch(e){showError('读取失败：'+e.message)}}
// Chain pages are generated from an explicit, immutable design snapshot.
const CHAIN_SNAPSHOT_STORE=STORE+'-chain-snapshot';
let chainGenerating=false,chainSnapshot=null;
const validChainSnapshot=value=>value&&typeof value.url==='string'&&/^snapshot-viewer\.html\?id=[0-9a-f]{32}$/.test(value.url);
try{const saved=JSON.parse(localStorage.getItem(CHAIN_SNAPSHOT_STORE)||'null');if(validChainSnapshot(saved))chainSnapshot=saved}catch(e){}
function updateChainSnapshotButtons(){
 $('generateChainBtn').disabled=!model||!model.products.length||!!error||recipeBlocked.size>0||busy||chainGenerating;
 $('generateChainBtn').textContent=chainGenerating?'正在生成…':'生成链路';
 $('viewChainBtn').disabled=!validChainSnapshot(chainSnapshot);
 if(chainSnapshot){const date=new Date(chainSnapshot.generatedAt);$('viewChainBtn').title=`${Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'已生成'} · ${chainSnapshot.products}个物品 · 静态快照，修改后需重新生成`}
}
async function generateChainSnapshot(){
 if(chainGenerating||!model||!model.products.length||error||recipeBlocked.size)return;
 if(flushVisible())timer=setTimeout(recalculate,0);
 if(error||recipeBlocked.size||draftActive()){toast('请先修正未完成的时间或配方输入');return}
 const design=clone(model),capturedVersion=version;
 chainGenerating=true;updateChainSnapshotButtons();
 try{
  const result=await post('/api/generate-chain',design);
  const job=await waitJob(result.jobId,progress=>{$('generateChainBtn').title=progress.product||'正在按当前方案生成链路'});
  if(!validChainSnapshot(job.snapshot))throw Error('生成结果不完整，请重新生成');
  chainSnapshot=job.snapshot;
  try{localStorage.setItem(CHAIN_SNAPSHOT_STORE,JSON.stringify(chainSnapshot))}catch(e){}
  toast(capturedVersion===version?'链路快照已生成，点击“查看快照”打开':'已生成点击时的方案快照；之后的修改需再次生成');
 }catch(e){toast(e.message)}
 finally{chainGenerating=false;$('generateChainBtn').title='按当前完整配方生成独立链路快照，不随之后的修改变化';updateChainSnapshotButtons();if(model&&!error&&!busy&&!model.products.every(p=>fresh(p.id)))recalculate()}
}
$('generateChainBtn').addEventListener('click',generateChainSnapshot);
$('viewChainBtn').addEventListener('click',()=>{if(validChainSnapshot(chainSnapshot))document.defaultView.open(chainSnapshot.url,'_blank','noopener')});
const chainSnapshotBaseButtons=buttons;
buttons=function(){chainSnapshotBaseButtons();updateChainSnapshotButtons()};
// Horizontal panning never edits cells or rebuilds the table.
let tablePanPointer=null,tablePanMenuPending=false;
const tablePanAvailable=()=>['main','load','channels','turnover'].includes(view);
function updateTablePan(){
 if(!tablePanAvailable())finishTablePan();
 else $('footerNote').textContent='输入自动保存 · Ctrl + 右键拖动横移';
}
function finishTablePan(){
 const scroll=$('tableScroll');
 if(tablePanPointer){const id=tablePanPointer.id;tablePanPointer=null;if(scroll.hasPointerCapture(id))scroll.releasePointerCapture(id)}
 scroll.classList.remove('pan-dragging');
}
$('tableScroll').addEventListener('pointerdown',event=>{
 tablePanMenuPending=false;
 const scroll=$('tableScroll');
 if(!tablePanAvailable()||event.pointerType==='touch'||!event.ctrlKey||event.button!==2)return;
 const rect=scroll.getBoundingClientRect();
 if(event.clientX>=rect.left+scroll.clientWidth||event.clientY>=rect.top+scroll.clientHeight)return;
 if(scroll.scrollWidth<=scroll.clientWidth)return;
 event.preventDefault();event.stopPropagation();tablePanMenuPending=true;
 tablePanPointer={id:event.pointerId,x:event.clientX,left:scroll.scrollLeft};
 scroll.setPointerCapture(event.pointerId);scroll.classList.add('pan-dragging');
},true);
$('tableScroll').addEventListener('pointermove',event=>{
 if(!tablePanPointer||tablePanPointer.id!==event.pointerId)return;
 if(!event.ctrlKey||!(event.buttons&2)){finishTablePan();return}
 event.preventDefault();$('tableScroll').scrollLeft=tablePanPointer.left+tablePanPointer.x-event.clientX;
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])$('tableScroll').addEventListener(type,event=>{if(tablePanPointer?.id===event.pointerId)finishTablePan()});
$('tableScroll').addEventListener('contextmenu',event=>{
 // Keep the gesture marked until the next press: some browsers open the menu on release, after Ctrl is released.
 if(event.button===2&&tablePanAvailable()&&(event.ctrlKey||tablePanMenuPending)){event.preventDefault();event.stopPropagation()}
});
$('tableScroll').addEventListener('auxclick',event=>{if(event.button===2&&tablePanMenuPending)event.preventDefault()});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape')finishTablePan();
});
document.addEventListener('keyup',event=>{if(event.key==='Control')finishTablePan()});
document.defaultView?.addEventListener('blur',()=>{finishTablePan();tablePanMenuPending=false});
const tablePanBaseRender=render;
render=function(force=false){tablePanBaseRender(force);updateTablePan()};
boot();
