// Editors keep raw weights; the fitting pipeline continues to receive percentages.
export function normalizedMixWeights(weights,counts){
  const available=weights.map((v,j)=>counts[j]>0&&Number.isFinite(v)&&v>0?v:0);
  const largest=Math.max(0,...available);
  if(!largest)return available.map(()=>0);
  const scaled=available.map(v=>v/largest),total=scaled.reduce((sum,v)=>sum+v,0);
  return scaled.map(v=>v/total*100);
}

export function mixWeightsIssue(weights,counts){
  if(!Array.isArray(weights)||weights.length!==3||weights.some(v=>!Number.isFinite(v)||v<0))return '商品种类权重必须是非负数。';
  if(!weights.some((v,j)=>counts[j]>0&&v>0))return '至少设置一种有候选订单的商品种类为正权重。';
  return null;
}
