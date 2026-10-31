import {renderOrderItems} from './item-info.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:0}):'—';
export function ranchLevelCatalogRows(state,query={}){
  const text=String(query.search??'').trim().toLocaleLowerCase(),direction=query.direction==='desc'?-1:1;
  const rows=state.groups.map((g,index)=>({g,index,m:state.metrics(g),r:state.resultFor(g)})).filter(({g})=>(!query.type||g.types.includes(query.type))&&(!query.building||g.slots.some(v=>String(state.products.get(v.id)?.buildingId)===query.building))&&(!text||g.id.toLocaleLowerCase().includes(text)||g.slots.some(v=>state.products.get(v.id)?.name.toLocaleLowerCase().includes(text))));
  const value=row=>query.sort==='optimal'?(row.r?.proven?row.r.optimalMinutes:row.r?.feasibleMinutes):query.sort==='work'?row.m.totalMinutes:query.sort==='complexity'?row.m.complexity:query.sort==='coins'?row.m.coinValue:row.index;
  return rows.sort((a,b)=>{const av=value(a),bv=value(b);if(!Number.isFinite(av)||!Number.isFinite(bv))return Number.isFinite(av)?-1:Number.isFinite(bv)?1:a.index-b.index;return direction*(av-bv)||a.index-b.index;});
}
export function createRanchLevelCatalog(api){
  const dialog=document.createElement('dialog');dialog.id='ranchLevelCatalog';dialog.className='ranch-level-catalog';dialog.setAttribute('aria-labelledby','ranchLevelCatalogTitle');
  dialog.innerHTML=`<div class="panel-heading"><h2 id="ranchLevelCatalogTitle">本级预设组合</h2><button type="button" id="closeLevelCatalog">关闭</button></div><div class="level-catalog-tools"><input id="levelCatalogSearch" type="search" placeholder="搜索商品 / 组合编号" aria-label="搜索本级预设组合"><select id="levelCatalogType" aria-label="全部组合类型"><option value="">全部类型</option><option value="building">同建筑</option><option value="chain">高级加工链</option></select><select id="levelCatalogBuilding" aria-label="全部组合商品来源"></select><select id="levelCatalogSort" aria-label="全部组合排序字段"><option value="id">组合编号</option><option value="optimal">联合优化时间</option><option value="work">累计工时</option><option value="complexity">复杂度</option><option value="coins">金币总值</option></select><select id="levelCatalogDirection" aria-label="全部组合排序方向"><option value="asc">升序</option><option value="desc">降序</option></select></div><div class="level-catalog-scroll"><table><thead><tr><th>编号</th><th>类型</th><th>四单商品</th><th>联合优化 · 分</th><th>累计工时 · 分</th><th>复杂度</th><th>金币总值</th><th>入库状态</th><th></th></tr></thead><tbody id="levelCatalogRows"></tbody></table></div><div class="pagination"><span id="levelCatalogCount"></span><div><button type="button" id="levelCatalogPrev">上一页</button><button type="button" id="levelCatalogNext">下一页</button></div></div>`;
  document.querySelector('main').append(dialog);const $=id=>document.getElementById(id);let page=0;const size=30;
  const query=()=>({search:$('levelCatalogSearch').value,type:$('levelCatalogType').value,building:$('levelCatalogBuilding').value,sort:$('levelCatalogSort').value,direction:$('levelCatalogDirection').value});
  function refresh(){
    const state=api.getState();$('openLevelCatalog').textContent=`本级预设组合 · ${num(state.groups.length)}`;$('openLevelCatalog').disabled=!state.groups.length;
    if(!dialog.open)return;
    const rows=ranchLevelCatalogRows(state,query()),pages=Math.max(1,Math.ceil(rows.length/size));page=Math.min(page,pages-1);
    $('ranchLevelCatalogTitle').textContent=`Lv ${state.level} · 全部预设组合`;
    $('levelCatalogRows').innerHTML=rows.slice(page*size,(page+1)*size).map(({g,index,m,r})=>`<tr><td>${index+1}</td><td>${g.types.map(t=>t==='building'?'同建筑':'高级加工链').join(' / ')}</td><td class="level-catalog-items">${g.slots.map((slot,i)=>`<span class="level-catalog-slot"><small>${'ABCD'[i]}</small>${renderOrderItems({items:[slot]},state.products)}</span>`).join('')}</td><td>${r?r.proven?num(r.optimalMinutes):`<span title="最优时间尚待确认；显示下界至可行完工时间">${num(r.lowerMinutes)}～${num(r.feasibleMinutes)}</span>`:'待计算'}</td><td>${num(m.totalMinutes)}</td><td>${num(m.complexity)}</td><td>${num(m.coinValue)}</td><td>${esc(state.admission?.(g)?.reason??'预设组合')}</td><td><button type="button" data-catalog-group="${esc(g.id)}">查看方案</button></td></tr>`).join('')||'<tr><td colspan="9">没有符合筛选条件的组合</td></tr>';
    $('levelCatalogCount').textContent=`筛选 ${num(rows.length)} / 本级全部 ${num(state.groups.length)} 组 · 第 ${page+1} / ${pages} 页`;$('levelCatalogPrev').disabled=page===0;$('levelCatalogNext').disabled=page>=pages-1;
  }
  $('openLevelCatalog').onclick=()=>{if(api.beforeOpen?.()===false)return;const state=api.getState();page=0;for(const id of ['levelCatalogSearch','levelCatalogType','levelCatalogBuilding'])$(id).value='';$('levelCatalogBuilding').innerHTML='<option value="">全部商品来源</option>'+state.sources.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');dialog.showModal();refresh();};
  $('closeLevelCatalog').onclick=()=>dialog.close();
  for(const id of ['levelCatalogSearch','levelCatalogType','levelCatalogBuilding','levelCatalogSort','levelCatalogDirection'])$(id).oninput=()=>{page=0;refresh();};
  $('levelCatalogPrev').onclick=()=>{page--;refresh();};$('levelCatalogNext').onclick=()=>{page++;refresh();};
  dialog.addEventListener('click',event=>{const chosen=event.target.closest('[data-catalog-group]');if(chosen){const group=api.getState().groups.find(g=>g.id===chosen.dataset.catalogGroup);if(group&&api.onChoose(group)!==false)dialog.close();}});
  return {refresh};
}
