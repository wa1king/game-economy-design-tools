export const isPlaceholderProductName=name=>/^(?:新)?(?:作物|物品|商品|产品|加工品)\s*\d+$/u.test(String(name??'').trim());
export function productNameUpdates(base,candidate){
  if(!base?.products?.length||candidate?.products?.length!==base.products.length)return [];
  const by=new Map(candidate.products.map(p=>[p.id,p]));
  if(by.size!==base.products.length||base.products.some(p=>{const q=by.get(p.id);return !q||q.level!==p.level||q.buildingId!==p.buildingId;}))return [];
  const updates=base.products.flatMap(p=>{const name=String(by.get(p.id).name??'').trim();return isPlaceholderProductName(p.name)&&name&&!isPlaceholderProductName(name)?[{id:p.id,from:p.name,to:name}]:[];});
  const names=base.products.map(p=>updates.find(u=>u.id===p.id)?.to??p.name);
  return new Set(names).size===names.length?updates:[];
}
export function applyProductNameUpdates(base,updates){
  const next=structuredClone(base),by=new Map(updates.map(u=>[u.id,u]));
  if(by.size!==updates.length||updates.some(u=>!base.products.some(p=>p.id===u.id)||!String(u.to??'').trim()||isPlaceholderProductName(u.to)))throw Error('商品名称更新清单无效。');
  for(const p of next.products){const u=by.get(p.id);if(!u)continue;if(p.name!==u.from||!isPlaceholderProductName(p.name))throw Error('商品名称已变化，请刷新后再更新。');p.gameIdentityName??=p.name;p.name=String(u.to).trim();}
  if(new Set(next.products.map(p=>p.name)).size!==next.products.length)throw Error('更新后的商品名称重复。');
  return next;
}
