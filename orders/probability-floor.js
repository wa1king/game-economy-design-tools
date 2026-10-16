export const PROBABILITY_SCALES=[0,100,1000,10000,100000,1000000,10000000];
export function eligibleOrder(order,config){
  return order.minimumLevel<=config.level&&(order.maximumLevel==null||order.maximumLevel>=config.level)&&config.mix[order.itemTypes-1]>0&&
    (!config.sourceEnabled||order.sourceMinutes.every((v,j)=>v===0||config.shares[j]>0));
}
export function probabilityFloorPlan(catalog,config,scale=config.probabilityScale){
  const counts=[0,0,0];catalog.orders.forEach(o=>{if(eligibleOrder(o,config))counts[o.itemTypes-1]++;});
  const requiredScale=Math.ceil(Math.max(0,...counts.map((n,k)=>n?100*n/config.mix[k]:0))-1e-8);
  const recommendedScale=PROBABILITY_SCALES.find(v=>v>0&&v>=requiredScale)??null;
  const budgets=counts.map((_,k)=>Math.round((scale||0)*config.mix[k]/100));
  const feasible=Boolean(scale>0&&PROBABILITY_SCALES.includes(scale)&&counts.every((n,k)=>budgets[k]>=n));
  const failingGroup=counts.findIndex((n,k)=>budgets[k]<n),total=counts.reduce((s,n)=>s+n,0);
  let reason='';
  if(!scale)reason='每单最低 1 权重需要明确的最小概率单位，请选择有限精度。';
  else if(!feasible)reason=`当前有 ${total.toLocaleString()} 种可生成订单。${failingGroup>=0?`${failingGroup+1} 种商品订单需要至少 ${counts[failingGroup].toLocaleString()} 个权重单位，当前只分到 ${budgets[failingGroup].toLocaleString()} 个。`:''}按当前占比，总权重至少需要 ${requiredScale.toLocaleString()}。${recommendedScale?`建议将概率精度提高至 ${recommendedScale.toLocaleString()} 分制，或关闭每单保底。`:'请减少候选订单、调整种类占比或关闭每单保底。'}`;
  return {counts,budgets,total,requiredScale,recommendedScale,feasible,reason};
}
