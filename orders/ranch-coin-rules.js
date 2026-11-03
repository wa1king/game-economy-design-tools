export const RANCH_SHARE_METRIC='coins-v1';
export const DEFAULT_RANCH_COIN_RULES={orderCoinMinPercent:20,orderCoinMaxPercent:30};
export function ranchCoinRules(settings={}){
  const values={};
  for(const key of Object.keys(DEFAULT_RANCH_COIN_RULES)){
    // Keep user-entered numeric bounds when moving from the former work rule.
    const legacy=key==='orderCoinMinPercent'?'orderWorkMinPercent':'orderWorkMaxPercent';
    const raw=settings?.[key]??settings?.[legacy]??DEFAULT_RANCH_COIN_RULES[key],value=Number(raw);
    if(String(raw).trim()===''||!Number.isFinite(value)||value<=0||value>100)throw Error('单个订单金币占比须大于 0% 且不超过 100%。');
    values[key]=value;
  }
  if(values.orderCoinMinPercent>25||values.orderCoinMaxPercent<25||values.orderCoinMinPercent>values.orderCoinMaxPercent)throw Error('四单占比合计为 100%，下限须不高于 25%，上限须不低于 25%。');
  return values;
}
export function ranchCoinRangeText(settings){const r=ranchCoinRules(settings);return `${r.orderCoinMinPercent}%～${r.orderCoinMaxPercent}%`;}
export function validRanchCoinShares(shares,settings){
  const r=ranchCoinRules(settings);
  return Array.isArray(shares)&&shares.length===4&&Math.abs(shares.reduce((a,b)=>a+b,0)-1)<=1e-8&&shares.every(v=>Number.isFinite(v)&&v>=r.orderCoinMinPercent/100-1e-10&&v<=r.orderCoinMaxPercent/100+1e-10);
}
