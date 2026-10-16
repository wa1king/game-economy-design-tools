const prepared = new WeakSet();

// Product scope deduplicates recipe branches; order scope sums each requested kind.
export function addOrderComplexity(catalog) {
  if (prepared.has(catalog)) return catalog;
  const products = new Map(catalog.products.map(p => [p.id, p]));
  const memo = new Map(), visiting = new Set();
  function chain(id) {
    if (memo.has(id)) return memo.get(id);
    const product = products.get(id);
    if (!product) throw new Error(`累计复杂度缺少商品 ${id} 的配方。`);
    if (visiting.has(id)) throw new Error(`商品 ${id} 的配方存在循环。`);
    visiting.add(id);
    const kinds = new Set([id]);
    for (const input of product.inputs) for (const kind of chain(input.id)) kinds.add(kind);
    visiting.delete(id);
    memo.set(id, kinds);
    return kinds;
  }
  for (const product of catalog.products) product.cumulativeComplexity = chain(product.id).size;
  for (const order of catalog.orders) {
    order.complexityBreakdown = order.items.map(item => {
      const product = products.get(item.id);
      if (!product) throw new Error(`订单 ${order.id} 缺少商品 ${item.id}。`);
      return {id: item.id, name: product.name, cumulativeComplexity: product.cumulativeComplexity};
    });
    order.cumulativeComplexity = order.complexityBreakdown.reduce((sum, p) => sum + p.cumulativeComplexity, 0);
  }
  prepared.add(catalog);
  return catalog;
}
