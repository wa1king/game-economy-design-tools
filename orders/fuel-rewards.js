import {ordinaryOrderReward,orderCoinValue} from './coin-values.js';

export const FUEL_RULES_KEY='order-fuel-rules-v1';
export const DEFAULT_FUEL_RULES=Object.freeze({coinsPerFuel:10});
export function fuelRules(raw=DEFAULT_FUEL_RULES){
  const value=raw?.coinsPerFuel;
  if(value==null||String(value).trim()==='')throw Error('请填写大于 0 的金币兑换数量。');
  const coinsPerFuel=Number(value);
  if(!Number.isFinite(coinsPerFuel)||coinsPerFuel<=0)throw Error('金币兑换数量必须大于 0。');
  return {coinsPerFuel};
}
export function readFuelRules(storage=globalThis.localStorage){
  const saved=storage?.getItem(FUEL_RULES_KEY);
  return saved?fuelRules(JSON.parse(saved)):{...DEFAULT_FUEL_RULES};
}
export function writeFuelRules(raw,storage=globalThis.localStorage){
  const rules=fuelRules(raw);
  if(!storage)throw Error('当前无法保存燃料规则，请检查浏览器存储。');
  storage.setItem(FUEL_RULES_KEY,JSON.stringify(rules));return rules;
}
// Decimal ratios avoid flooring an exact boundary such as 0.6 / 0.2 to 2.
function fraction(value){
  const [digits,exponent='0']=String(value).toLowerCase().split('e'),[whole,decimal='']=digits.split('.');
  const power=Number(exponent)-decimal.length,numerator=BigInt(whole+decimal);
  return power>=0?[numerator*10n**BigInt(power),1n]:[numerator,10n**BigInt(-power)];
}
export function fuelReward(coins,rules=readFuelRules()){
  if(!Number.isFinite(coins)||coins<0)return null;
  const {coinsPerFuel}=fuelRules(rules),[a,b]=fraction(coins),[c,d]=fraction(coinsPerFuel);
  const value=Number(a*d/(b*c));
  return Number.isSafeInteger(value)?value:null;
}
export function ordinaryFuelReward(order,products,rules=readFuelRules()){
  return fuelReward(ordinaryOrderReward(order,products),rules);
}
export function ranchFuelReward(group,products,rules=readFuelRules()){
  const values=group.slots.map(item=>fuelReward(orderCoinValue({items:[item]},products),rules));
  return {values,total:values.some(v=>v===null)?null:values.reduce((a,b)=>a+b,0)};
}
export function summarizeFuel(rows,products,{multiplier=1,slots=false,equalWeight=false,rules=readFuelRules()}={}){
  rules=fuelRules(rules);
  const active=rows.filter(r=>Number.isFinite(r.weight)&&r.weight>0),mass=active.reduce((s,r)=>s+(equalWeight?1:r.weight),0);
  const summary={count:active.length,mean:null,min:null,max:null,missingCount:0,coinsPerFuel:rules.coinsPerFuel};
  if(!mass)return summary;
  let sum=0,minimum=Infinity,maximum=-Infinity;
  for(const row of active){
    const value=slots?ranchFuelReward({slots:row.items},products,rules).total:fuelReward(orderCoinValue({items:row.items},products)===null?null:orderCoinValue({items:row.items},products)*multiplier,rules);
    if(value===null){summary.missingCount++;continue;}
    sum+=value*(equalWeight?1:row.weight)/mass;minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);
  }
  if(!summary.missingCount){summary.mean=sum;summary.min=minimum;summary.max=maximum;}
  return summary;
}
