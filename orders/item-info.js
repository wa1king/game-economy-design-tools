const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function renderOrderItems(order, products) {
  return order.items.map(item => {
    const product = products.get(item.id);
    return `<button type="button" class="order-item" data-product-id="${item.id}" data-quantity="${item.quantity}" aria-label="${escapeHTML(product.name)}×${item.quantity}，查看商品信息">${escapeHTML(product.name)}<span>×${item.quantity}</span></button>`;
  }).join('<span class="item-separator" aria-hidden="true"> ＋ </span>');
}

export function setupItemInfo(catalog, rows) {
  const products = new Map(catalog.products.map(product => [product.id, product]));
  const tooltip = document.createElement('div');
  tooltip.id = 'itemInfo';
  tooltip.className = 'item-info';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  const minutes = value => Number(value).toLocaleString('zh-CN', {maximumFractionDigits:2}) + ' 分钟';
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
    const product = products.get(Number(button.dataset.productId));
    const unitWork = product.unitCumulativeMinutes ?? product.soloOrderMinutes / product.orderQuantity;
    tooltip.innerHTML = `<strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.buildingName)} · ${product.level} 级解锁 · 本单需求 ${button.dataset.quantity} 个</small><dl><dt>累计复杂度</dt><dd>${product.cumulativeComplexity} 种</dd><dt>单步时间</dt><dd>${minutes(product.stepMinutes)}</dd><dt>单品累计工时</dt><dd>${minutes(unitWork)}</dd></dl>`;
    button.setAttribute('aria-describedby', tooltip.id);
    tooltip.hidden = false;
    const rect = button.getBoundingClientRect(), gap = 8;
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
    const left = Math.max(gap, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - gap));
    const top = rect.top >= height + gap * 2 ? rect.top - height - gap : Math.min(rect.bottom + gap, innerHeight - height - gap);
    tooltip.style.left = left + 'px';
    tooltip.style.top = Math.max(gap, top) + 'px';
  }
  const buttonFor = event => event.target.closest?.('.order-item');
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
  document.addEventListener('pointerdown', event => { if (!event.target.closest?.('.order-item') && !tooltip.contains(event.target)) hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  return {products, hide};
}
