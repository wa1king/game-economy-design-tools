import {DEFAULT_CROP_QUANTITY,readRanchSettings,saveRanchQuantityRules} from './order-quantity-rules.js';
import {ranchSource,notifyRanchChange} from './ranch-workspace.js';
import {prepareRanch,ranchCapacities} from './ranch-engine.js';
import {ranchSettingsKey} from './ranch-import.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function applyRanchRuleDraft(base,previous,draft){
  const level=Number(draft.level);if(!Number.isInteger(level)||level<1||level>base.maxLevel)throw Error('请选择有效等级。');
  for(const key of ['cropQuantity','productQuantity'])if(!Number.isSafeInteger(Number(draft[key]))||Number(draft[key])<1||Number(draft[key])>1000)throw Error('每位需求数量必须是 1～1000 的整数。');
  if(!['2000','10000','30000'].includes(String(draft.searchLimit)))throw Error('请选择有效搜索时限。');
  const capacities={...(previous.capacities?.[level]??{})};
  for(const source of base.sources.filter(s=>(s.level??1)<=level)){const n=Number(draft.capacities[source.id]);if(!Number.isSafeInteger(n)||n<1||n>1000)throw Error(source.name+'的并行容量必须是 1～1000 的整数。');capacities[source.id]=n;}
  return {...structuredClone(previous),cropQuantity:Number(draft.cropQuantity),productQuantity:Number(draft.productQuantity),allowRepeated:Boolean(draft.allowRepeated),searchLimit:String(draft.searchLimit),capacities:{...structuredClone(previous.capacities??{}),[level]:capacities}};
}
export const RANCH_RULES_FORM='<div id="settings" class="settings"><div class="panel-heading"><h2 id="ranchRulesTitle">订单规则</h2><button id="closeSettings" type="button">关闭</button></div><label class="rule-level">产能等级 <select id="ranchRuleLevel" aria-label="订单规则产能等级"></select></label><div class="settings-grid"><label>每位作物数量<input id="cropQuantity" type="number" min="1" max="1000" value="6"></label><label>每位加工品数量<input id="productQuantity" type="number" min="1" max="1000" value="1"></label><label>每组搜索时限<select id="searchLimit"><option value="2000">2 秒</option><option value="10000">10 秒</option><option value="30000">30 秒</option></select></label><label class="check"><input id="allowRepeated" type="checkbox">高级加工链允许重复商品</label></div><div class="settings-bottom"><div id="capacities" class="capacities"></div><button id="applySettings">应用规则</button></div><p class="micro">同建筑不含作物 · 可重复 2—4 位 · 空仓 · 所有设施在起点可用 · 每批1件 · 操作即时 · 不限制仓库 · 数量规则用于全部等级；产能按等级保存</p></div>';
export function setupRanchRulesDialog(){
  const dialog=document.createElement('dialog');dialog.id='ranchRulesDialog';dialog.className='ranch-rules-dialog';dialog.setAttribute('aria-labelledby','ranchRulesTitle');
  dialog.innerHTML=RANCH_RULES_FORM+'<p id="ranchRulesError" role="alert" hidden></p>';document.body.append(dialog);
  const $=id=>document.getElementById(id);let base,key,settings;
  const read=()=>{const source=ranchSource();if(!source?.base)throw Error('请先导入加工链路。');base=source.base;key=ranchSettingsKey(base);settings=readRanchSettings(localStorage,key);};
  const error=text=>{$('ranchRulesError').hidden=!text;$('ranchRulesError').textContent=text;};
  function fill(globalFields=true){
    read();const lv=Number($('ranchRuleLevel').value)||Number($('level')?.value)||Number(settings.level)||base.maxLevel;
    if(globalFields){$('cropQuantity').value=settings.cropQuantity??DEFAULT_CROP_QUANTITY;$('productQuantity').value=settings.productQuantity??1;$('allowRepeated').checked=settings.allowRepeated??false;$('searchLimit').value=settings.searchLimit??'2000';}
    const caps={...ranchCapacities(prepareRanch(base),lv),...(settings.capacities?.[lv]??{})};
    $('capacities').innerHTML=base.sources.filter(s=>(s.level??1)<=lv).map(s=>`<label>${esc(s.name)} <input data-cap="${s.id}" aria-label="${esc(s.name)}并行容量" type="number" min="1" max="1000" value="${esc(caps[s.id]??'')}" placeholder="待填"></label>`).join('');
  }
  function open(){try{read();$('ranchRuleLevel').innerHTML=Array.from({length:base.maxLevel},(_,i)=>`<option value="${i+1}">Lv ${i+1}</option>`).join('');$('ranchRuleLevel').value=$('level')?.value||settings.level||base.maxLevel;fill();error('');if(!dialog.open)dialog.showModal();}catch(e){const host=$('message')??$('ranchConfigError')??$('distributionError');if(host){host.hidden=false;host.textContent=e.message;}}}
  $('openSettings').onclick=open;$('closeSettings').onclick=()=>dialog.close();
  $('ranchRuleLevel').onchange=()=>{try{fill(false);}catch(e){error(e.message);}};
  $('applySettings').onclick=()=>{try{
    if(document.querySelector('#stop:not([hidden]),#pauseRanchLevels:not([hidden]),#pauseDistribution:not([hidden])'))throw Error('请先暂停当前计算，再修改订单规则。');
    read();const capacities=Object.fromEntries([...$('capacities').querySelectorAll('input')].map(input=>[input.dataset.cap,input.value]));
    const next=applyRanchRuleDraft(base,settings,{level:$('ranchRuleLevel').value,cropQuantity:$('cropQuantity').value,productQuantity:$('productQuantity').value,allowRepeated:$('allowRepeated').checked,searchLimit:$('searchLimit').value,capacities});
    localStorage.setItem(key,JSON.stringify(next));saveRanchQuantityRules(next);notifyRanchChange(key,'rules');dialog.close();window.dispatchEvent(new CustomEvent('ranch:rules-applied'));
  }catch(e){error(e.message);}};
  // Cancelling must not leave unsaved rule values in controls read by the detail view.
  dialog.addEventListener('close',()=>{try{fill();}catch{}});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  return {open};
}
