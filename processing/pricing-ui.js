'use strict';
// Price settings share the saved design; dismissals are local display preferences.
const PRICE_DISMISSED_STORE=STORE+'-dismissed-price-notices';
let priceDraft=null,priceResult=null,priceWatchToken='',priceVisibleWarnings=[],priceExportPending=null;
let priceDismissed=new Set();
try{const saved=JSON.parse(localStorage.getItem(PRICE_DISMISSED_STORE)||'[]');if(Array.isArray(saved))priceDismissed=new Set(saved.filter(x=>typeof x==='string'))}catch(e){}
$('goalsOpen').insertAdjacentHTML('afterend','<button id="priceOpen" class="text-button">价格配置</button>');
$('feedbackRail').insertAdjacentHTML('afterbegin','<div id="priceExportNotice" class="price-notice" role="alert" hidden></div><div id="priceTimeNotice" class="price-notice" role="alert" hidden></div>');
document.body.insertAdjacentHTML('beforeend',`<dialog id="priceDialog" aria-labelledby="priceDialogTitle"><div class="dialog-head"><h2 id="priceDialogTitle">价格配置</h2><button id="priceClose" aria-label="关闭价格配置">×</button></div><p class="price-formula">价格 = int（原料总价 + 本步时间价值 × 来源系数）</p><div class="price-config-grid"><section><h3>时间价值 <small>支持粘贴 Excel 区域</small></h3><div class="price-config-scroll"><table id="priceTimesTable" class="price-config-table"><thead><tr><th>时间（s）</th><th>价值</th><th></th></tr></thead><tbody></tbody></table></div><button id="priceAddTime" class="text-button">＋ 时间点</button></section><section><h3>来源系数</h3><div class="price-config-scroll"><table id="priceSourcesTable" class="price-config-table"><thead><tr><th>来源</th><th>价值系数</th></tr></thead><tbody></tbody></table></div></section></div><p id="priceConfigError" role="alert"></p><p class="price-method">缺失时间按相邻点线性插值；超出范围按端点延伸，最低为 0。每个商品最后取整。</p><details id="pricePreview"><summary>商品价格 <span id="priceSummary"></span></summary><div class="price-preview-scroll"><table class="price-preview-table"><thead><tr><th>物品</th><th>来源</th><th>本步时间</th><th>原料总价</th><th>本步增值</th><th>价格</th></tr></thead><tbody id="pricePreviewBody"></tbody></table></div></details></dialog>`);
const pricingSources=()=>[{id:0,name:'田地'},...model.buildings];
const priceNoticeKey=w=>JSON.stringify([w.id,w.name,w.seconds]);
function currentPricing(){return ChainPricing.normalizeConfig(model.pricing,model.buildings)}
function refreshPrices(){
  if(!model)return;
  try{priceResult=ChainPricing.evaluate(model,currentPricing())}catch(e){priceResult=null;priceExportPending=null;priceVisibleWarnings=[];priceWatchToken='';$('priceExportNotice').hidden=true;$('priceTimeNotice').hidden=true;$('priceSummary').textContent='';$('pricePreviewBody').innerHTML='';$('priceConfigError').textContent=e.message;return}
  const token=JSON.stringify([model,priceResult.config]);
  if(token!==priceWatchToken){
    priceWatchToken=token;
    // A pending confirmation belongs to one exact export snapshot.
    if(priceExportPending){priceExportPending=null;$('priceExportNotice').hidden=true}
    priceVisibleWarnings=priceResult.warnings.filter(w=>!priceDismissed.has(priceNoticeKey(w)));
    const notice=$('priceTimeNotice');notice.hidden=!priceVisibleWarnings.length;
    if(priceVisibleWarnings.length){const rows=priceVisibleWarnings.slice(0,3);notice.innerHTML=`<b>时间价值未配置</b><span>${rows.map(w=>`${esc(w.name)} · ${fmt(w.seconds)} s`).join('；')}${priceVisibleWarnings.length>3?`；另 ${priceVisibleWarnings.length-3} 项`:''}</span><small>已按${priceVisibleWarnings.some(w=>w.mode==='extrapolation')?'插值／外推':'插值'}临时估价。</small><div><button id="priceNoticeSettings" class="text-button">去配置</button><button id="priceNoticeClose" class="notice-close" aria-label="关闭时间价值提醒">×</button></div>`}
  }
  renderPricePreview();
}
function renderPricePreview(){
  if(!priceResult)return;
  const estimated=priceResult.products.filter(p=>p.priceEstimated||p.estimated).length;
  $('priceSummary').textContent=estimated?`· ${estimated} 项含临时估值`:'';
  if(!$('pricePreview').open)return;
  syncMarkup($('pricePreviewBody'),priceResult.products.map(p=>`<tr><th>${esc(p.name)}</th><td>${esc(p.id!==undefined?(P(p.id)?.building?B(P(p.id).building)?.name:'田地'):'')}</td><td>${withUnit(p.seconds,'s')}</td><td>${fmt(p.materialCost)}</td><td>${fmt(p.addedValue)}</td><td title="${esc(p.error||((p.priceEstimated||p.estimated)?'含未配置时间的临时估值':''))}" class="${p.error?'price-invalid':(p.priceEstimated||p.estimated)?'price-estimated':''}"><b>${fmt(p.price)}</b>${p.error?' · 待修正':(p.priceEstimated||p.estimated)?' *':''}</td></tr>`).join(''));
}
function renderPriceEditor(){
  if(!priceDraft)return;
  syncMarkup($('priceTimesTable').tBodies[0],priceDraft.timeValues.map((r,i)=>`<tr><td><input type="number" min="0.000001" step="any" data-price-time="${i}" data-price-field="seconds" aria-label="时间点 ${i+1} 秒" value="${esc(r.seconds)}"></td><td><input type="number" min="0" step="any" data-price-time="${i}" data-price-field="value" aria-label="时间点 ${i+1} 价值" value="${esc(r.value)}"></td><td><button class="text-button" data-price-delete="${i}" aria-label="删除时间点 ${i+1}" ${priceDraft.timeValues.length<=2?'disabled':''}>×</button></td></tr>`).join(''));
  syncMarkup($('priceSourcesTable').tBodies[0],pricingSources().map((b,i)=>`<tr><th>${esc(b.name)}</th><td><input type="number" min="0" step="any" data-price-source="${b.id}" data-price-source-row="${i}" aria-label="${esc(b.name)} 价值系数" value="${esc(priceDraft.sourceCoefficients[b.id]??(b.id?2:1))}"></td></tr>`).join(''));
  renderPricePreview();
}
function openPriceConfig(){
  if(!model)return;
  try{priceDraft=clone(currentPricing());$('priceConfigError').textContent='';renderPriceEditor();if(!$('priceDialog').open)$('priceDialog').showModal()}catch(e){toast(e.message)}
}
function capturePriceDraft(){
  for(const input of $('priceDialog').querySelectorAll('[data-price-time]')){const row=priceDraft.timeValues[Number(input.dataset.priceTime)];if(row)row[input.dataset.priceField]=input.value===''?'':Number(input.value)}
  for(const input of $('priceDialog').querySelectorAll('[data-price-source]'))priceDraft.sourceCoefficients[input.dataset.priceSource]=input.value===''?'':Number(input.value);
}
function commitPriceDraft(){
  capturePriceDraft();
  try{
    const normalized=ChainPricing.normalizeConfig(priceDraft,model.buildings);
    if(JSON.stringify(currentPricing())!==JSON.stringify(normalized)){
      history.push(clone(model));if(history.length>30)history.shift();model.pricing=normalized;saveLocal();buttons();
    }
    $('priceConfigError').textContent='';refreshPrices();return true;
  }catch(e){$('priceConfigError').textContent=e.message+' 修改尚未保存。';return false}
}
function closePriceConfig(){
  if(!commitPriceDraft())return;
  priceDraft=null;$('priceDialog').close();
}
function dismissPriceNotice(){
  for(const w of priceVisibleWarnings)priceDismissed.add(priceNoticeKey(w));
  try{localStorage.setItem(PRICE_DISMISSED_STORE,JSON.stringify([...priceDismissed]))}catch(e){}
  priceVisibleWarnings=[];$('priceTimeNotice').hidden=true;
}
function preparePriceExport(kind){
  refreshPrices();
  if(!priceResult){toast('价格配置无效，请修正后导出。');return}
  const design=clone(model);design.pricing=clone(priceResult.config);
  const bundle={design,prices:clone(priceResult.products),stageTargets:exportedStageGoals()};
  const action=()=>kind==='json'?savePricedPlan(bundle):exportPricedExcel(bundle);
  if(!priceResult.warnings.length){action();return}
  priceExportPending={token:priceWatchToken,action};
  const warnings=priceResult.warnings;
  $('priceExportNotice').innerHTML=`<b>导出前确认</b><span>${warnings.length} 个物品的时间未配置：${warnings.slice(0,2).map(w=>`${esc(w.name)} ${fmt(w.seconds)} s`).join('、')}${warnings.length>2?'…':''}</span><small>本次将包含临时估算价格。</small><div><button id="priceExportContinue">继续${kind==='json'?'保存':'导出'}</button><button id="priceExportSettings" class="text-button">去配置</button><button id="priceExportCancel" class="notice-close" aria-label="取消本次导出">×</button></div>`;
  $('priceExportNotice').hidden=false;
}
function savePricedPlan(bundle){
  download(JSON.stringify({version:1,...bundle},null,2),'加工链路方案_'+date()+'.json','application/json');toast('已保存方案、价格配置和商品价格');
}
async function exportPricedExcel(bundle){
  if(exporting)return;
  exporting=true;buttons();const current=version,count=bundle.design.products.length;
  try{const r=await post('/api/export',bundle.design);await waitJob(r.jobId,j=>status(j.product==='正在生成Excel'?'正在生成 Excel…':`导出计算 ${j.current}/${j.total}`,'busy'));const f=await fetch('/api/download/'+r.jobId);if(!f.ok)throw Error('下载未完成');download(await f.arrayBuffer(),'加工链路数值设计表_'+date()+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');toast(`已导出 ${count} 个物品，含商品价格`+(current!==version?'；导出为确认时的方案':''))}catch(e){toast(e.message)}finally{exporting=false;buttons();if(!busy&&!error)status('已更新')}
}
$('saveBtn').onclick=()=>{if(!model)return;if(flushVisible()&&!error)recalculate();preparePriceExport('json')};
$('exportBtn').onclick=async()=>{if(error||recipeBlocked.size||busy||exporting)return;if(flushVisible()){if(error||recipeBlocked.size)return;await recalculate();if(error||recipeBlocked.size||busy)return}preparePriceExport('excel')};
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(['priceOpen','priceNoticeSettings','priceExportSettings'].includes(button.id))openPriceConfig();
  else if(button.id==='priceClose')closePriceConfig();
  else if(button.id==='priceNoticeClose')dismissPriceNotice();
  else if(button.id==='priceExportCancel'){priceExportPending=null;$('priceExportNotice').hidden=true}
  else if(button.id==='priceExportContinue'){
    const pending=priceExportPending;priceExportPending=null;$('priceExportNotice').hidden=true;
    if(pending&&pending.token===priceWatchToken)pending.action();
  }else if(button.id==='priceAddTime'){
    capturePriceDraft();priceDraft.timeValues.push({seconds:'',value:''});renderPriceEditor();$('priceTimesTable').querySelector(`input[data-price-time="${priceDraft.timeValues.length-1}"]`).focus();
  }else if(button.hasAttribute('data-price-delete')){
    capturePriceDraft();priceDraft.timeValues.splice(Number(button.dataset.priceDelete),1);renderPriceEditor();commitPriceDraft();
  }
});
document.addEventListener('change',event=>{if(event.target.matches('[data-price-time],[data-price-source]'))commitPriceDraft()});
document.addEventListener('paste',event=>{
  const input=event.target;if(!input.closest?.('#priceDialog')||!input.matches('[data-price-time],[data-price-source]'))return;
  const text=event.clipboardData?.getData('text/plain');if(!text||!/[\t\r\n]/.test(text.trim()))return;
  event.preventDefault();
  try{
    capturePriceDraft();const next=clone(priceDraft);
    if(input.hasAttribute('data-price-time'))next.timeValues=ChainPricing.pasteTimes(text,currentPricing().timeValues,Number(input.dataset.priceTime),text.includes('\t')?0:input.dataset.priceField==='value'?1:0);
    else next.sourceCoefficients=ChainPricing.pasteCoefficients(text,model.buildings,priceDraft.sourceCoefficients,Number(input.dataset.priceSourceRow),1);
    const normalized=ChainPricing.normalizeConfig(next,model.buildings);priceDraft=normalized;
    // syncMarkup intentionally retains focused input drafts. Update that one explicitly after paste.
    if(input.hasAttribute('data-price-time'))input.value=priceDraft.timeValues[Number(input.dataset.priceTime)]?.[input.dataset.priceField]??'';
    else input.value=priceDraft.sourceCoefficients[input.dataset.priceSource];
    renderPriceEditor();commitPriceDraft();
  }catch(e){$('priceConfigError').textContent=e.message+' 原配置未改动。'}
});
$('priceDialog').addEventListener('cancel',event=>{event.preventDefault();closePriceConfig()});
$('priceDialog').addEventListener('click',event=>{if(event.target===$('priceDialog'))closePriceConfig()});
$('pricePreview').addEventListener('toggle',renderPricePreview);
const pricingBaseRender=render;
render=function(force=false){pricingBaseRender(force);refreshPrices()};
if(model)refreshPrices();
