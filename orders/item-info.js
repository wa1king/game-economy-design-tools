import {unitCoinValue} from './coin-values.js';
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function renderOrderItems(order, products) {
  return order.items.map(item => {
    const product = products.get(item.id);
    return `<button type="button" class="order-item" data-product-id="${item.id}" data-quantity="${item.quantity}" aria-label="${escapeHTML(product.name)}×${item.quantity}，查看商品信息">${escapeHTML(product.name)}<span>×${item.quantity}</span></button>`;
  }).join('<span class="item-separator" aria-hidden="true"> ＋ </span>');
}

export function renderItemInfo(product, products, quantity) {
  const number=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});
  const minutes=value=>Number.isFinite(value)?number(value)+' 分钟':'未提供';
  // Ordinary orders already provide per-unit work; the ranch uses validated single-yield recipes.
  const visiting=new Set(),work=new Map(),kinds=new Set();
  function upstream(id){
    if(work.has(id))return work.get(id);
    const p=id===product.id?product:products.get(id);if(!p||visiting.has(id))return null;
    visiting.add(id);kinds.add(id);
    const yieldCount=p.analysisBatchYield??1;let total=p.stepMinutes;
    for(const input of p.inputs||[]){const value=upstream(input.id);if(value==null){total=null;break;}total+=input.quantity*value;}
    visiting.delete(id);const value=total==null||!Number.isFinite(total)||!(yieldCount>0)?null:total/yieldCount;work.set(id,value);return value;
  }
  const fallback=upstream(product.id),unitWork=product.unitCumulativeMinutes??(Number.isFinite(product.soloOrderMinutes)&&product.orderQuantity>0?product.soloOrderMinutes/product.orderQuantity:fallback);
  const coins=unitCoinValue(product),coinText=coins===null?'未导入':coins.toLocaleString('zh-CN',{maximumFractionDigits:4})+' 金币';
  const inputs=product.inputs||[],yieldCount=product.analysisBatchYield??1;
  const recipe=inputs.length?inputs.map(input=>`<span class="recipe-ingredient">${escapeHTML(products.get(input.id)?.name??'未知商品 '+input.id)}<b>×${escapeHTML(number(input.quantity))}</b></span>`).join(''):'<span class="recipe-empty">无需原料</span>';
  return `<strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.buildingName)} · ${escapeHTML(product.level)} 级解锁${quantity==null?'':` · 本单需求 ${escapeHTML(quantity)} 个`}</small><dl><dt>累计复杂度</dt><dd>${escapeHTML(product.cumulativeComplexity??kinds.size)} 种</dd><dt>单步时间</dt><dd>${minutes(product.stepMinutes)}</dd><dt>单品累计工时</dt><dd>${minutes(unitWork)}</dd><dt>单价</dt><dd title="${escapeHTML([product.coinValueStatus,product.coinValueSource].filter(Boolean).join(' · '))}">${coinText}${coins!==null&&product.coinValueStatus?.includes('估算')?' <small class="coin-estimate">含估算</small>':''}</dd></dl><section class="item-recipe"><div class="recipe-heading"><span>配方</span><span>每批产出 ${escapeHTML(number(yieldCount))} 个</span></div><div class="recipe-ingredients">${recipe}</div></section>`;
}

export function setupItemInfo(catalog, rows) {
  const products = new Map(catalog.products.map(product => [product.id, product]));
  const tooltip = document.createElement('div');
  tooltip.id = 'itemInfo';
  tooltip.className = 'item-info';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let active, timer;
  function hide() {
    clearTimeout(timer);
    active?.removeAttribute('aria-describedby');
    active = null;
    tooltip.hidden = true;
  }
  function scheduleHide() { clearTimeout(timer); timer = setTimeout(hide, 140); }
  function show(button) {
    clearTimeout(timer);
    if (active !== button) active?.removeAttribute('aria-describedby');
    active = button;
    const host=button.closest('dialog')||document.body;if(tooltip.parentNode!==host)host.append(tooltip);
    const product = products.get(Number(button.dataset.productId??button.dataset.product));
    if(!product){hide();return;}
    tooltip.innerHTML = renderItemInfo(product,products,button.dataset.quantity);
    button.setAttribute('aria-describedby', tooltip.id);
    tooltip.hidden = false;
    const rect = button.getBoundingClientRect(), gap = 8;
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    const left = Math.max(gap, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - gap));
    const top = rect.top >= height + gap * 2 ? rect.top - height - gap : Math.min(rect.bottom + gap, innerHeight - height - gap);
    tooltip.style.left = left + 'px';
    tooltip.style.top = Math.max(gap, top) + 'px';
  }
  const selector='.order-item, .analysis-product[data-product]';
  const buttonFor = event => event.target.closest?.(selector);
  rows.addEventListener('pointerover', event => { const button = buttonFor(event); if (button) show(button); });
  rows.addEventListener('pointerout', event => {
    const button = buttonFor(event);
    if (button && !button.contains(event.relatedTarget) && !tooltip.contains(event.relatedTarget)) scheduleHide();
  });
  rows.addEventListener('focusin', event => { const button = buttonFor(event); if (button) show(button); });
  rows.addEventListener('focusout', scheduleHide);
  rows.addEventListener('click', event => { const button = buttonFor(event); if (button) show(button); });
  tooltip.addEventListener('pointerenter', () => clearTimeout(timer));
  tooltip.addEventListener('pointerleave', scheduleHide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('pointerdown', event => { if (!event.target.closest?.(selector) && !tooltip.contains(event.target)) hide(); });
  window.addEventListener('scroll', event=>{if(event.target!==tooltip)hide();}, true);
  window.addEventListener('resize', hide);
  return {products, hide};
}
