import {customOrdersAt,customOrderOverview,editCustomOrders,filterCustomLibrary} from './custom-orders.js';
import {renderOrderItems} from './item-info.js';
import {ordinaryOrderReward} from './coin-values.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>value==null?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:1});
export function createCustomOrdersView(api){
  const root=document.getElementById('customPanel');let level=1,page=0,mode='pick',catalog,products,query={};const size=25;
  root.innerHTML=`<div class="level-analysis-toolbar custom-heading"><div class="level-context"><h2 hidden>定制订单</h2><select id="customLevel" class="level-selector" aria-label="定制订单等级"></select><span id="customSummary" class="hint level-context-info"></span></div><div class="level-toolbar-actions"><nav class="custom-heading-actions" aria-label="定制订单视图"><button type="button" data-custom-mode="pick" class="view-tab active">挑选订单</button><button type="button" data-custom-mode="overview" class="view-tab">全部等级总览</button></nav></div></div><p id="customMessage" class="custom-message" role="status" hidden></p>
  <div id="customPick" class="custom-layout"><section class="panel custom-library"><div class="panel-heading"><h3>本级订单库 <span id="customLibraryCount"></span></h3><button type="button" class="quiet" id="customAddPage">加入本页</button></div>
  <div class="custom-filters"><input id="customSearch" type="search" placeholder="搜索商品 / 订单编号" aria-label="搜索定制订单"><select id="customKinds" aria-label="商品种类"><option value="">全部种类数</option><option value="1">1 种商品</option><option value="2">2 种商品</option><option value="3">3 种商品</option></select><select id="customSource" aria-label="商品所属来源"></select><select id="customSelected" aria-label="选择状态"><option value="">全部选择状态</option><option value="no">尚未选择</option><option value="yes">已选择</option></select></div>
  <div class="custom-filters custom-filter-ranges"><label>累计工时 <input id="customMinTime" type="number" min="0" placeholder="最小" aria-label="最小累计工时"> — <input id="customMaxTime" type="number" min="0" placeholder="最大" aria-label="最大累计工时"> 分</label><label>复杂度 <input id="customMinComplexity" type="number" min="0" placeholder="最小" aria-label="最小累计复杂度"> — <input id="customMaxComplexity" type="number" min="0" placeholder="最大" aria-label="最大累计复杂度"></label><div class="custom-sort"><select id="customSort" aria-label="定制订单排序字段"><option value="id">订单编号</option><option value="cumulativeMinutes">累计工时</option><option value="cumulativeComplexity">累计复杂度</option><option value="itemTypes">商品种类数</option><option value="coinValue">金币总值</option></select><select id="customDirection" aria-label="定制订单排序方向"><option value="asc">升序</option><option value="desc">降序</option></select><button id="customReset" type="button" class="quiet">重置筛选</button></div></div>
  <div class="custom-table-scroll"><table class="custom-table"><thead><tr><th>选择</th><th>订单 / 商品</th><th title="空仓联合排产；农田按当前等级累计土地，每个加工建筑1条生产线">优化时间 · 分</th><th>累计工时 · 分</th><th>累计复杂度</th><th>金币奖励</th></tr></thead><tbody id="customLibraryRows"></tbody></table></div><div class="pagination"><span id="customPageInfo"></span><div><button id="customPrev" class="quiet" type="button">上一页</button><button id="customNext" class="quiet" type="button">下一页</button></div></div></section>
  <aside class="panel custom-picked"><div class="panel-heading"><h3>已选任务 <span id="customPickedCount"></span></h3><button id="customClear" class="quiet" type="button">清空本级</button></div><div id="customPickedStats" class="custom-picked-stats"></div><div id="customPickedRows" class="custom-picked-rows"></div></aside></div>
  <section id="customOverview" class="panel" hidden><div class="table-scroll"><table class="custom-overview-table"><thead><tr><th>等级</th><th>已选任务</th><th>平均优化时间 · 分</th><th>平均累计工时 · 分</th><th>平均复杂度</th><th>状态</th><th></th></tr></thead><tbody id="customOverviewRows"></tbody></table></div></section>`;
  const $=id=>root.querySelector('#'+id),fields={search:'customSearch',kinds:'customKinds',source:'customSource',selected:'customSelected',minTime:'customMinTime',maxTime:'customMaxTime',minComplexity:'customMinComplexity',maxComplexity:'customMaxComplexity',sort:'customSort',direction:'customDirection'};
  const selection=()=>api.getSelection(),selectedIds=()=>new Set(selection()?.levels?.[level]??[]);
  const filtered=()=>filterCustomLibrary(api.getInfo(level).orders,products,query,selectedIds());
  const pageOrders=()=>filtered().slice(page*size,(page+1)*size);
  function timingText(order,lv,withUnit=false){
    const t=api.getTiming?.(order,lv);
    if(t?.error)return `<span class="error-text" title="${esc(t.error)}">无法排产</span>`;
    if(t?.proven)return num(t.optimalMinutes)+(withUnit?' 分':'');
    if(t&&Number.isFinite(t.feasibleMinutes))return `<span title="尚未证明最优，显示排产下界至可行完工时间">${num(t.lowerMinutes)}～${num(t.feasibleMinutes)}${withUnit?' 分':''}</span>`;
    return '<span class="hint">计算中…</span>';
  }
  function meanTiming(lv){
    const entries=customOrdersAt(catalog,selection(),lv).filter(e=>e.order),all=entries.map(e=>api.getTiming?.(e.order,lv)),times=all.filter(t=>t?.proven);
    return times.length?`${num(times.reduce((sum,t)=>sum+t.optimalMinutes,0)/times.length)}<small class="hint"> · ${times.length}/${entries.length} 已证明</small>`:!entries.length?'—':all.some(t=>!t)?'计算中…':all.every(t=>t.error)?'无法排产':'未证最优';
  }
  function message(text='',error=false){$('customMessage').hidden=!text;$('customMessage').textContent=text;$('customMessage').classList.toggle('error-text',error);}
  function edit(action,ids=[]){try{if(api.isBusy())throw Error('请等待当前计算结束。');api.onChange(editCustomOrders(selection(),catalog,level,action,ids));message('已保存');refreshResults();}catch(error){message(error.message,true);}}
  function showMode(next){mode=next;$('customPick').hidden=mode!=='pick';$('customOverview').hidden=mode!=='overview';if(mode==='overview'&&catalog)for(let lv=1;lv<=catalog.maxLevel;lv++)api.ensureTimings?.(customOrdersAt(catalog,selection(),lv).flatMap(e=>e.order?[e.order]:[]),lv);root.querySelectorAll('[data-custom-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.customMode===mode);b.setAttribute('aria-pressed',String(b.dataset.customMode===mode));});}
  function refreshResults(){
    const chosen=selectedIds(),orders=filtered(),pages=Math.max(1,Math.ceil(orders.length/size));page=Math.min(page,pages-1);
    const entries=customOrdersAt(catalog,selection(),level),valid=entries.filter(e=>e.order);
    api.ensureTimings?.([...valid.map(e=>e.order),...orders.slice(page*size,(page+1)*size)],level);
    if(mode==='overview')for(let lv=1;lv<=catalog.maxLevel;lv++)api.ensureTimings?.(customOrdersAt(catalog,selection(),lv).flatMap(e=>e.order?[e.order]:[]),lv);
    $('customLibraryCount').textContent=`${num(orders.length)} / ${num(api.getInfo(level).orders.length)}`;
    $('customLibraryRows').innerHTML=orders.slice(page*size,(page+1)*size).map(o=>`<tr class="${chosen.has(o.id)?'custom-row-picked':''}"><td><button type="button" class="custom-pick-button" data-custom-add="${esc(o.id)}" ${chosen.has(o.id)||api.isBusy()?'disabled':''}>${chosen.has(o.id)?'已选':'添加'}</button></td><td><small class="custom-order-id">${esc(o.id)}</small>${renderOrderItems(o,products)}</td><td class="custom-optimal">${timingText(o,level)}</td><td>${num(o.cumulativeMinutes)}</td><td>${o.cumulativeComplexity}</td><td>${num(ordinaryOrderReward(o,products))}</td></tr>`).join('')||'<tr><td colspan="6" class="custom-empty">没有符合筛选条件的订单</td></tr>';
    $('customPageInfo').textContent=`第 ${page+1} / ${pages} 页 · ${num(orders.length)} 单`;$('customPrev').disabled=page===0;$('customNext').disabled=page>=pages-1;
    $('customAddPage').disabled=api.isBusy()||!pageOrders().some(o=>!chosen.has(o.id));$('customClear').disabled=api.isBusy()||!entries.length;
    $('customPickedCount').textContent=entries.length;
    $('customPickedStats').textContent=valid.length?`平均 ${num(valid.reduce((s,e)=>s+e.order.cumulativeMinutes,0)/valid.length)} 分 · 平均复杂度 ${num(valid.reduce((s,e)=>s+e.order.cumulativeComplexity,0)/valid.length)}`:'尚未选择任务';
    $('customPickedRows').innerHTML=entries.map((entry,i)=>`<article class="custom-picked-card${entry.order?'':' invalid'}"><div class="custom-picked-title"><b>${i+1}</b><small>${esc(entry.id)}</small><div><button type="button" data-custom-up="${esc(entry.id)}" aria-label="任务${i+1}上移" ${!i||api.isBusy()?'disabled':''}>↑</button><button type="button" data-custom-down="${esc(entry.id)}" aria-label="任务${i+1}下移" ${i===entries.length-1||api.isBusy()?'disabled':''}>↓</button><button type="button" data-custom-remove="${esc(entry.id)}" aria-label="移除任务${i+1}" ${api.isBusy()?'disabled':''}>移除</button></div></div><div>${entry.order?renderOrderItems(entry.order,products):'<span class="error-text">当前等级或规则下不可用，请移除</span>'}</div>${entry.order?`<p>优化 ${timingText(entry.order,level,true)} · 累计 ${num(entry.order.cumulativeMinutes)} 分 · 复杂度 ${entry.order.cumulativeComplexity} · ${num(ordinaryOrderReward(entry.order,products))} 金币</p>`:''}</article>`).join('')||'<div class="custom-empty">从左侧订单库添加任务</div>';
    const overview=customOrderOverview(catalog,selection());
    $('customSummary').textContent=`已定制 ${overview.filter(r=>r.count).length} / ${catalog.maxLevel} 级 · 共 ${num(overview.reduce((s,r)=>s+r.count,0))} 个任务`;
    $('customOverviewRows').innerHTML=overview.map(r=>`<tr><td>Lv ${r.level}</td><td>${r.count}</td><td class="custom-optimal">${meanTiming(r.level)}</td><td>${num(r.meanMinutes)}</td><td>${num(r.meanComplexity)}</td><td class="${r.invalid?'error-text':''}">${r.invalid?`${r.invalid} 项不可用`:r.count?'已配置':'未配置'}</td><td><button type="button" class="text-button" data-custom-open="${r.level}">挑选订单 →</button></td></tr>`).join('');
  }
  function render(){
    catalog=api.getCatalog();if(!catalog)return;products=new Map(catalog.products.map(p=>[p.id,p]));level=Math.min(level,catalog.maxLevel);
    $('customLevel').innerHTML=Array.from({length:catalog.maxLevel},(_,i)=>`<option value="${i+1}">Lv ${i+1}</option>`).join('');$('customLevel').value=level;
    $('customSource').innerHTML='<option value="">全部来源</option>'+catalog.sources.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');$('customSource').value=query.source??'';
    if($('customSource').value!==String(query.source??''))query.source='';
    refreshResults();showMode(mode);
  }
  root.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b||b.disabled)return;const d=b.dataset;
    if(d.customMode)showMode(d.customMode);
    else if(d.customOpen){level=Number(d.customOpen);page=0;render();showMode('pick');}
    else if(d.customAdd)edit('add',[d.customAdd]);else if(d.customRemove)edit('remove',[d.customRemove]);
    else if(d.customUp)edit('up',[d.customUp]);else if(d.customDown)edit('down',[d.customDown]);
  });
  for(const [key,id] of Object.entries(fields))$(id).addEventListener('input',()=>{query[key]=$(id).value;page=0;refreshResults();});
  $('customLevel').onchange=()=>{level=Number($('customLevel').value);page=0;message();refreshResults();};
  $('customPrev').onclick=()=>{page--;refreshResults();};$('customNext').onclick=()=>{page++;refreshResults();};
  $('customAddPage').onclick=()=>edit('add',pageOrders().map(o=>o.id));$('customClear').onclick=()=>edit('clear');
  $('customReset').onclick=()=>{query={};page=0;for(const id of Object.values(fields))$(id).value=id==='customSort'?'id':id==='customDirection'?'asc':'';refreshResults();};
  return {render,refreshTimings:refreshResults,open(nextLevel){if(nextLevel)level=nextLevel;render();}};
}
