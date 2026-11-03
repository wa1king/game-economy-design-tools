import {readFuelRules,writeFuelRules,FUEL_RULES_KEY} from './fuel-rewards.js';

export function setupFuelRules(){
  if(document.getElementById('fuelRulesDialog'))return;
  const actions=document.querySelector('header .shared-data-actions');if(!actions)return;
  const css=document.createElement('link');css.rel='stylesheet';css.href='fuel-rewards.css';document.head.append(css);
  actions.insertAdjacentHTML('afterbegin','<button id="openFuelRules" class="quiet shell-action" type="button" aria-haspopup="dialog" aria-controls="fuelRulesDialog">燃料规则</button>');
  document.body.insertAdjacentHTML('beforeend',`<dialog id="fuelRulesDialog" class="fuel-rules-dialog" aria-labelledby="fuelRulesTitle"><form id="fuelRulesForm"><div class="fuel-rules-heading"><h2 id="fuelRulesTitle">燃料奖励</h2><button id="closeFuelRules" type="button" aria-label="关闭燃料规则">×</button></div><p>普通订单与牧场订单共用，按每张订单的金币奖励向下取整。</p><label class="fuel-conversion"><input id="fuelCoinsPerUnit" aria-label="兑换 1 燃料所需金币" type="number" min="0" step="any" required><span>金币 = <b>1</b> 燃料</span></label><p id="fuelRuleExample" class="fuel-rules-note"></p><p class="fuel-rules-note">牧场四单分别折算后相加；兑换不扣减金币奖励。修改后直接更新统计，无需重新计算订单。</p><p id="fuelRulesError" role="alert" hidden></p><div class="fuel-rules-actions"><button type="submit" class="primary">保存规则</button></div></form></dialog>`);
  const dialog=document.getElementById('fuelRulesDialog'),input=document.getElementById('fuelCoinsPerUnit'),error=document.getElementById('fuelRulesError');
  const example=()=>{const r=Number(input.value);document.getElementById('fuelRuleExample').textContent=r>0?`例如：${r*2.5} 金币 → 2 燃料；不足 ${r} 金币 → 0 燃料。`:'';};
  document.getElementById('openFuelRules').onclick=()=>{try{input.value=readFuelRules().coinsPerFuel;error.hidden=true;example();dialog.showModal();}catch(e){error.textContent=e.message;error.hidden=false;dialog.showModal();}};
  document.getElementById('closeFuelRules').onclick=()=>dialog.close();input.oninput=example;
  document.getElementById('fuelRulesForm').onsubmit=event=>{event.preventDefault();try{writeFuelRules({coinsPerFuel:input.value});window.dispatchEvent(new Event('orders:fuel-changed'));dialog.close();}catch(e){error.textContent=e.message;error.hidden=false;}};
  window.addEventListener('storage',event=>{if(event.key===FUEL_RULES_KEY||event.key===null)window.dispatchEvent(new Event('orders:fuel-changed'));});
}
