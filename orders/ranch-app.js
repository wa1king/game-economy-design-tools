import {createProjectStore} from './project-storage.js';
import {readChainExcel} from './excel-import.js';
import {prepareRanch,ranchCapacities,ranchFamilies,generateRanchGroups,groupMetrics} from './ranch-engine.js';

const $=id=>document.getElementById(id),esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=1)=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d}),letters=['A','B','C','D'],animals=['史莱姆','吞吞貘','陆行鸟','宝箱怪'],colors=['#39866a','#a67b39','#647fac','#a46a80'];
let base,model,filename,type='building',level=20,families=[],groups=[],current,capacities={},worker,busy=false,page=0,results=new Map(),failures=new Map(),savedSettings={},storageKey,weightRecords={},downloadUrl;
const weightContext=()=>`${level}:${type}:${$('family').value}`;
const generationKey=()=>JSON.stringify([Number($('cropQuantity').value),Number($('productQuantity').value),$('allowRepeated').checked]);
function message(text=''){ $('message').textContent=text;$('message').hidden=!text; }
function fingerprint(value){let h=2166136261;for(const c of JSON.stringify(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
function persist(){
  if(!model)return;
  savedSettings={...savedSettings,level,type,family:$('family').value,cropQuantity:Number($('cropQuantity').value),productQuantity:Number($('productQuantity').value),allowRepeated:$('allowRepeated').checked,searchLimit:$('searchLimit').value,weights:weightRecords,selection:current?{context:weightContext(),generation:generationKey(),group:current}:null};
  try{localStorage.setItem(storageKey,JSON.stringify(savedSettings));}catch{message('本页设置未能保存，请导出需求组备份。');}
}
function stop(){worker?.terminate();worker=null;busy=false;$('stop').hidden=true;$('solveAll').disabled=false;$('solveOne').disabled=!current;}
function family(){return families.find(v=>v.id===$('family').value);}
function clearResults(){stop();results.clear();failures.clear();}
function install(newBase,name,rules){
  stop();prepareRanch(newBase);base=structuredClone(newBase);model=prepareRanch(base);filename=name||base.filename||'加工链路';
  storageKey='ranch-settings-v1:'+fingerprint({products:base.products,sources:base.sources,lands:base.landsByLevel});
  savedSettings={};try{savedSettings=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{message('牧场设置无法恢复，已读取商品；原订单项目未改动。');}
  weightRecords=savedSettings.weights||{};type=savedSettings.type==='chain'?'chain':'building';
  level=Math.min(base.maxLevel||20,Math.max(1,savedSettings.level??level));
  $('cropQuantity').value=savedSettings.cropQuantity??rules?.cropQuantity??7;$('productQuantity').value=savedSettings.productQuantity??rules?.productQuantity??1;
  $('allowRepeated').checked=savedSettings.allowRepeated??false;$('searchLimit').value=savedSettings.searchLimit||'2000';
  $('projectName').textContent=filename;$('sourceMeta').textContent=`${base.products.length} 商品 · ${base.products.filter(v=>v.coinValue!=null).length} 个已定价`;
  $('level').innerHTML=Array.from({length:base.maxLevel||20},(_,i)=>`<option value="${i+1}">Lv ${i+1}</option>`).join('');$('level').value=level;
  $('empty').hidden=true;$('workspace').hidden=false;$('exportButton').disabled=false;
  capacities={...ranchCapacities(model,level),...(savedSettings.capacities?.[level]||{})};renderCapacities();updateFamilies(savedSettings.family);
}
function readCurrent(){
  const project=createProjectStore(localStorage).load();if(!project)throw Error('当前还没有导入订单项目，请选择加工链路 Excel。');
  install(project.base,project.filename,project.rules);localStorage.setItem('ranch-source-v1',JSON.stringify({kind:'current'}));message();
}
function renderCapacities(){
  $('capacities').innerHTML=base.sources.filter(s=>s.level<=level).map(s=>`<label>${esc(s.name)} <input data-cap="${s.id}" aria-label="${esc(s.name)}并行容量" type="number" min="1" max="1000" value="${capacities[s.id]??''}" placeholder="待填"></label>`).join('');
}
function updateFamilies(preferred){
  clearResults();families=ranchFamilies(model,level,type);
  $('buildingType').classList.toggle('active',type==='building');$('chainType').classList.toggle('active',type==='chain');$('buildingType').setAttribute('aria-pressed',String(type==='building'));$('chainType').setAttribute('aria-pressed',String(type==='chain'));
  $('familyCaption').textContent=type==='building'?'生产建筑':'高级成品';
  $('family').innerHTML=families.length?families.map(f=>`<option value="${esc(f.id)}">${esc(f.name)}</option>`).join(''):'<option value="">本级无可用范围</option>';
  if(families.some(f=>f.id===preferred))$('family').value=preferred;
  else if(!$('allowRepeated').checked){const usable=families.find(f=>f.productIds.length>=4);if(usable)$('family').value=usable.id;}
  rebuild();
}
function rebuild(){
  clearResults();page=0;message();
  try{groups=generateRanchGroups(model,family(),{cropQuantity:Number($('cropQuantity').value),productQuantity:Number($('productQuantity').value),allowRepeated:$('allowRepeated').checked});
    const weights=weightRecords[weightContext()]||{};groups.forEach(g=>g.weight=weights[g.id]??1);
  }catch(error){groups=[];message(error.message);}
  const previous=savedSettings.selection;
  const validSelection=previous?.context===weightContext()&&previous.generation===generationKey()&&previous.group?.slots?.length===4&&previous.group.slots.every(v=>family()?.productIds.includes(v.id)&&Number.isSafeInteger(v.quantity)&&v.quantity>0);
  current=validSelection?structuredClone(previous.group):groups.length?structuredClone(groups[0]):null;
  $('shuffle').disabled=!groups.length;$('solveAll').disabled=!groups.length;renderSelected();renderTable();persist();
  if(current){const missing=base.sources.find(s=>s.level<=level&&!(Number.isSafeInteger(Number(capacities[s.id]))&&Number(capacities[s.id])>0));
    if(missing){$('settings').hidden=false;$('openSettings').setAttribute('aria-expanded','true');message(`原项目未保存${missing.name}容量。请重新导入含累计土地的 Excel，或在产能设置填写实际容量。`);}
    else run([current]);}
}
function renderSelected(keepSlotInputs=false){
  $('groupTitle').textContent=current?.id==='custom'?'自定义需求组':family()?.name||'本级无可用需求组';
  $('groupMeta').textContent=current?`Lv ${level} · ${type==='building'?'同建筑':'高级加工链'} · 四位固定分配`:($('allowRepeated').checked?'本范围无法组成至少两种商品的四位需求。':'不足四种商品，可更换范围或在设置中允许重复。');
  $('solveOne').disabled=!current||busy;
  if(!current){$('slots').innerHTML='';for(const id of ['optimal','totalMinutes','complexity','coins'])$(id).textContent='—';$('schedule').innerHTML='<div class="placeholder">选择可用建筑或高级加工链</div>';$('completion').hidden=true;$('solveState').textContent='无候选';return;}
  const choice=family()?.productIds||[],ps=choice.map(id=>model.by.get(id));
  if(!keepSlotInputs)$('slots').innerHTML=current.slots.map((slot,i)=>{const p=model.by.get(slot.id);return `<article class="slot"><div class="slot-top"><b>动物 ${letters[i]}</b><span>${animals[i]}</span></div><select data-slot="${i}" aria-label="动物${letters[i]}需求商品">${ps.map(v=>`<option value="${v.id}" ${slot.id===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select><div class="slot-number"><span class="muted">需求数量</span><input data-quantity="${i}" aria-label="动物${letters[i]}需求数量" type="number" min="1" max="1000" value="${slot.quantity}"></div><div class="slot-info"><span>${esc(p.buildingName)} · Lv ${p.level}</span><span>单步 ${fmt(p.stepMinutes)}分 · 复杂度 ${model.chains.get(p.id).size}</span></div></article>`;}).join('');
  let metrics;try{metrics=groupMetrics(model,current,level);}catch(error){message(error.message);return;}
  $('totalMinutes').textContent=fmt(metrics.totalMinutes);$('complexity').textContent=fmt(metrics.complexity,0);$('coins').textContent=fmt(metrics.coinValue);
  $('coinNote').textContent=metrics.coinValue==null?'存在未导入金币单价的商品':current.slots.some(v=>String(model.by.get(v.id).coinValueStatus||'').includes('估算'))?'数量 × 导入单价 · 含估算价格':'数量 × 导入金币单价 · 非Token奖励';
  const r=results.get(current.id),error=failures.get(current.id);
  $('optimalLabel').textContent=r&&!r.proven?'四单可行完工时间':'四单联合优化时间';
  $('optimal').textContent=r?fmt(r.proven?r.optimalMinutes:r.feasibleMinutes):'—';$('optimalNote').textContent=r?(r.proven?'已证明最优 · 四单全部备齐':`可行排程 ${fmt(r.feasibleMinutes)}分 · 最优下界 ${fmt(r.lowerMinutes)}分`):'空仓 · 统一安排全部生产任务';
  $('solveState').textContent=error?'计算失败':r?(r.proven?'已证明最优':'待证明最优'):busy?'计算中':'待计算';$('solveState').className='badge'+(error||r&&!r.proven?' warn':'');
  renderSchedule(r);if(error)message(error);
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
  const field=$('sort').value,sign=$('direction').value==='asc'?1:-1;
  return groups.map((g,i)=>({g,i,m:results.get(g.id)||groupMetrics(model,g,level),r:results.get(g.id)})).sort((a,b)=>{
    if(field==='default')return (a.i-b.i)*sign;
    const av=field==='optimal'?a.r?.optimalMinutes:a.m[field],bv=field==='optimal'?b.r?.optimalMinutes:b.m[field];
    if(av==null||bv==null)return av==null&&bv==null?a.i-b.i:av==null?1:-1;return (av-bv)*sign||a.i-b.i;
  });
}
function renderTable(){
  const list=entries(),maxPage=Math.max(0,Math.ceil(list.length/30)-1);page=Math.min(page,maxPage);
  $('candidateCount').textContent=`${groups.length.toLocaleString()} 组`;
  const proven=[...results.values()].filter(r=>r.proven),computed=groups.filter(g=>results.has(g.id)).length,done=groups.filter(g=>results.get(g.id)?.proven).length;
  $('candidateSummary').textContent=busy?`计算中 ${computed+failures.size} / ${groups.length} · 已证明 ${done} 组`:`已计算 ${computed} / ${groups.length} · 已证明 ${done} · 失败 ${failures.size}`;
  $('batchStats').hidden=!done;
  if(done){const values=groups.filter(g=>results.get(g.id)?.proven).map(g=>results.get(g.id).optimalMinutes).sort((a,b)=>a-b),mean=values.reduce((a,b)=>a+b,0)/values.length,mid=(values[(values.length-1)>>1]+values[values.length>>1])/2;
    $('batchStats').innerHTML=`<span>已证明候选 · 逐组等权</span><span>平均<b>${fmt(mean)}分</b></span><span>中位数<b>${fmt(mid)}分</b></span><span>最短<b>${fmt(values[0])}分</b></span><span>最长<b>${fmt(values.at(-1))}分</b></span>`;}
  $('rows').innerHTML=list.slice(page*30,page*30+30).map(({g,i,m,r})=>`<tr class="${g.id===current?.id?'selected':''}"><td><button class="group-button" data-select="${esc(g.id)}">R${String(i+1).padStart(4,'0')}</button></td><td>${g.slots.map((v,j)=>`<span class="slot-item"><span style="color:${colors[j]}">${letters[j]}</span> ${esc(model.by.get(v.id).name)} ×${v.quantity}</span>`).join('')}</td><td>${r?(r.proven?fmt(r.optimalMinutes)+'分':`<span title="最优下界 ${fmt(r.lowerMinutes)}分；当前可行排程 ${fmt(r.feasibleMinutes)}分">${fmt(r.lowerMinutes)}～${fmt(r.feasibleMinutes)}分</span>`):failures.has(g.id)?`<span title="${esc(failures.get(g.id))}">计算失败</span>`:'—'}</td><td>${fmt(m.totalMinutes)}分</td><td>${fmt(m.complexity,0)}</td><td>${fmt(m.coinValue)}</td><td><input type="number" min="0" step="any" class="row-weight" aria-label="需求组R${i+1}权重" data-weight="${esc(g.id)}" value="${g.weight}"></td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;padding:25px">本范围暂无符合规则的四位需求组</td></tr>';
  $('range').textContent=groups.length?`${page*30+1}—${Math.min(groups.length,page*30+30)} / ${groups.length.toLocaleString()} 组`:'0 组';$('prev').disabled=page===0;$('next').disabled=page>=maxPage;
}
function run(items){
  stop();if(!items.length)return;message();busy=true;$('solveOne').disabled=true;$('solveAll').disabled=true;$('stop').hidden=false;$('solveState').textContent='计算中';
  worker=new Worker('./ranch-worker.js',{type:'module'});const ownedWorker=worker;let lastPaint=0;
  worker.onmessage=({data})=>{
    if(worker!==ownedWorker)return;
    if(data.type==='result')results.set(data.id,data.result);
    if(data.type==='groupError')failures.set(data.id,data.message);
    if(data.type==='result'||data.type==='groupError'){
      if(data.id===current?.id)renderSelected();
      if(performance.now()-lastPaint>200||data.index===data.total){renderTable();lastPaint=performance.now();}
    }
    if(data.type==='error'){stop();message(data.message);renderSelected();renderTable();}
    if(data.type==='done'){stop();renderSelected();renderTable();}
  };
  worker.onerror=event=>{if(worker!==ownedWorker)return;stop();message(event.message||'排产计算中断。');renderSelected();renderTable();};
  worker.postMessage({base,groups:items,level,capacities,timeLimitMs:Number($('searchLimit').value)});
}
function editSlot(event){
  const index=event.target.dataset.slot??event.target.dataset.quantity;if(index==null||!current)return;const slot=Number(index);
  const value=Number(event.target.value),quantityInput=event.target.dataset.quantity!=null;
  if(!Number.isSafeInteger(value)||(quantityInput?value<1:!model.by.has(value))){
    message('需求数量必须是正整数。');$('solveOne').disabled=true;
    if(event.type==='change'){event.target.value=quantityInput?current.slots[slot].quantity:current.slots[slot].id;$('solveOne').disabled=busy;}
    return;
  }
  stop();const copy=structuredClone(current);copy.id='custom';if(event.target.dataset.slot!=null)copy.slots[slot].id=value;else copy.slots[slot].quantity=value;
  current=copy;results.delete('custom');failures.delete('custom');message();renderSelected(quantityInput);renderTable();persist();
}
function sample(){
  const sum=groups.reduce((s,g)=>s+g.weight,0);if(!(sum>0)&&groups.length){message('至少一个需求组需要正权重。');return;}
  const random=new Uint32Array(1);crypto.getRandomValues(random);let x=random[0]/4294967296*sum;
  const selected=groups.find(g=>(x-=g.weight)<0)||groups.filter(g=>g.weight>0).at(-1);if(!selected)return;
  current=structuredClone(selected);renderSelected();renderTable();persist();if(!results.has(current.id))run([current]);
}
function exportData(){
  if(!model)return;
  const sum=groups.reduce((s,g)=>s+g.weight,0),payload={schema:'ranch-demand-groups-v1',source:{filename,sha256:base.source?.sha256??null},level,type,family:family(),capacities,assumptions:{inventory:0,actionsMinutes:0,facilitiesAvailableAt:0,warehouseCapacity:'unlimited',singleYield:true,scope:'production_only_not_digesting',chainDefinition:'selected_advanced_product_and_all_ancestors',slots:'fixed_A_B_C_D'},products:base.products,groups:groups.map(g=>({...g,probability:sum>0?g.weight/sum:0,metrics:groupMetrics(model,g,level),scheduleResult:results.get(g.id)??null,error:failures.get(g.id)??null})),selected:current?{...current,metrics:groupMetrics(model,current,level),scheduleResult:results.get(current.id)??null}:null};
  const json=JSON.stringify(payload,null,2);$('exportJson').value=json;
  if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  $('downloadLink').href=downloadUrl;$('downloadLink').download=`牧场需求组_Lv${level}_${type}.json`;$('downloadArea').hidden=false;
  $('exportSummary').textContent=`已生成 Lv ${level} · ${groups.length} 个需求组 · 含已计算的排程`;
}
$('importButton').onclick=$('importEmpty').onclick=()=>$('importFile').click();$('readCurrent').onclick=()=>{try{readCurrent();}catch(e){message(e.message);}};
$('importFile').onchange=async()=>{const file=$('importFile').files[0];if(!file)return;try{const imported=await readChainExcel(file);install(imported,file.name);localStorage.setItem('ranch-source-v1',JSON.stringify({kind:'import',base:imported,filename:file.name}));message();}catch(error){message(error.message);}finally{$('importFile').value='';}};
$('readProject').onclick=()=>{try{readCurrent();}catch(error){message(error.message);}};
$('level').onchange=()=>{level=Number($('level').value);capacities={...ranchCapacities(model,level),...(savedSettings.capacities?.[level]||{})};renderCapacities();updateFamilies();};
$('buildingType').onclick=()=>{if(type==='building')return;type='building';updateFamilies();};$('chainType').onclick=()=>{if(type==='chain')return;type='chain';updateFamilies();};$('family').onchange=rebuild;
$('openSettings').onclick=()=>{$('settings').hidden=!$('settings').hidden;$('openSettings').setAttribute('aria-expanded',String(!$('settings').hidden));};
$('applySettings').onclick=()=>{try{const updated={...capacities};for(const input of $('capacities').querySelectorAll('input')){const n=Number(input.value);if(!Number.isSafeInteger(n)||n<1)throw Error('所有已解锁设施的并行容量都必须是正整数。');updated[input.dataset.cap]=n;}
  const cq=Number($('cropQuantity').value),pq=Number($('productQuantity').value);if(!Number.isSafeInteger(cq)||cq<1||!Number.isSafeInteger(pq)||pq<1)throw Error('需求数量必须是正整数。');
  capacities=updated;(savedSettings.capacities??={})[level]={...capacities};rebuild();}catch(error){message(error.message);}};
$('slots').addEventListener('change',editSlot);$('slots').addEventListener('input',event=>{if(event.target.dataset.quantity!=null)editSlot(event);});$('solveOne').onclick=()=>current&&run([current]);$('shuffle').onclick=sample;
$('solveAll').onclick=()=>run(groups.filter(g=>!results.get(g.id)?.proven));$('stop').onclick=()=>{stop();renderSelected();renderTable();};
$('sort').onchange=$('direction').onchange=()=>{page=0;renderTable();};$('prev').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
$('rows').onclick=event=>{const target=event.target.closest('[data-select]');if(!target)return;current=structuredClone(groups.find(g=>g.id===target.dataset.select));renderSelected();renderTable();persist();};
$('rows').onchange=event=>{const id=event.target.dataset.weight;if(!id)return;const value=Number(event.target.value),g=groups.find(v=>v.id===id);if(!Number.isFinite(value)||value<0||value>1e12){event.target.value=g.weight;message('组权重需为0至1万亿之间的数值。');return;}g.weight=value;(weightRecords[weightContext()]??={})[id]=value;persist();};
$('exportButton').onclick=exportData;
$('closeDownload').onclick=()=>{$('downloadArea').hidden=true;};
$('copyExport').onclick=async()=>{try{await navigator.clipboard.writeText($('exportJson').value);$('exportSummary').textContent='需求组 JSON 已复制';}catch{$('exportJson').closest('details').open=true;$('exportJson').focus();$('exportJson').select();$('exportSummary').textContent='请按 Ctrl+C 复制已选中的配置';}};
try{const saved=JSON.parse(localStorage.getItem('ranch-source-v1')||'null');if(saved?.kind==='import')install(saved.base,saved.filename);else readCurrent();}catch(error){message(error.message);}
