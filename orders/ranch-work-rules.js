export const DEFAULT_RANCH_WORK_RULES={orderWorkMinPercent:20,orderWorkMaxPercent:30};
export function ranchWorkRules(settings={}){
  const values={};
  for(const key of Object.keys(DEFAULT_RANCH_WORK_RULES)){
    const raw=settings?.[key]??DEFAULT_RANCH_WORK_RULES[key],value=Number(raw);
    if(String(raw).trim()===''||!Number.isFinite(value)||value<=0||value>100)throw Error('单个订单累计工时占比须大于 0% 且不超过 100%。');
    values[key]=value;
  }
  if(values.orderWorkMinPercent>25||values.orderWorkMaxPercent<25||values.orderWorkMinPercent>values.orderWorkMaxPercent)throw Error('四单占比合计为 100%，下限须不高于 25%，上限须不低于 25%。');
  return values;
}
export function ranchWorkRangeText(settings){const r=ranchWorkRules(settings);return `${r.orderWorkMinPercent}%～${r.orderWorkMaxPercent}%`;}
export function validRanchWorkShares(shares,settings){
  const r=ranchWorkRules(settings);
  return Array.isArray(shares)&&shares.length===4&&Math.abs(shares.reduce((a,b)=>a+b,0)-1)<=1e-8&&shares.every(v=>Number.isFinite(v)&&v>=r.orderWorkMinPercent/100-1e-10&&v<=r.orderWorkMaxPercent/100+1e-10);
}
