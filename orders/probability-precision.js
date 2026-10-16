import {PROBABILITY_SCALES,eligibleOrder,probabilityFloorPlan} from './probability-floor.js';
import {attachFitQuality} from './fit-quality.js';
export {PROBABILITY_SCALES};

// Largest remainders preserve the integer budget exactly. Ties use catalog order.
export function apportion(weights,budget){
  if(!Number.isInteger(budget)||budget<0||weights.some(v=>!Number.isFinite(v)||v<0))throw Error('无效的整数权重预算。');
  const sum=weights.reduce((a,b)=>a+b,0),out=weights.map(()=>0);
  if(!budget)return out;
  if(!sum)throw Error('没有可分配概率的订单。');
  const quotas=weights.map(v=>v/sum*budget);quotas.forEach((v,i)=>out[i]=Math.floor(v));
  const remainder=budget-out.reduce((a,b)=>a+b,0);
  const priority=quotas.map((v,i)=>({i,fraction:v-out[i]})).sort((a,b)=>b.fraction-a.fraction||a.i-b.i);
  if(remainder<0||remainder>priority.length)throw Error('整数权重分配未能保持总数。');
  priority.slice(0,remainder).forEach(({i})=>out[i]++);
  return out;
}

export function applyProbabilityPrecision(catalog,raw,scale=10000){
  if(raw.blocked)return raw;
  if(!PROBABILITY_SCALES.includes(scale))throw Error('请选择有效的概率精度。');
  const config={...raw.config,probabilityScale:scale};
  const floor=config.minimumOrderWeight?probabilityFloorPlan(catalog,config,scale):null;
  if(floor&&!floor.feasible)throw Error(floor.reason);
  if(floor&&raw.config.probabilityScale!==scale)throw Error('最低概率单位改变后需要重新拟合。');
  if(!scale)return {...raw,config,probabilityScale:0,integerWeights:null,quantization:null};
  const budgets=apportion(config.mix,scale),integerWeights=catalog.orders.map(()=>0),groupTimeBudgets=[];
  for(let group=0;group<3;group++){
    const indices=catalog.orders.map((o,i)=>({o,i})).filter(({o,i})=>o.itemTypes===group+1&&(floor?eligibleOrder(o,config):raw.probabilities[i]>0)).map(({i})=>i);
    // Preserve the fitted time profile before selecting individual orders. Otherwise
    // many tiny tail probabilities disappear together and shrink the variance.
    const buckets=raw.ref.probs.map(()=>[]);
    indices.forEach(i=>{let b=0;const t=catalog.orders[i].cumulativeMinutes;while(b<buckets.length-1&&t>=raw.ref.edges[b+1])b++;buckets[b].push(i);});
    const minimum=floor?1:0,residual=i=>Math.max(0,raw.probabilities[i]-minimum/scale);
    const extraBudget=budgets[group]-minimum*indices.length;
    const extraBins=apportion(buckets.map(bin=>bin.reduce((s,i)=>s+residual(i),0)),extraBudget);
    const binBudgets=extraBins.map((v,b)=>v+minimum*buckets[b].length);groupTimeBudgets.push(binBudgets);
    buckets.forEach((bin,b)=>{const allocated=apportion(bin.map(residual),extraBins[b]);bin.forEach((i,j)=>integerWeights[i]=minimum+allocated[j]);});
  }
  const probabilities=integerWeights.map(v=>v/scale),hist=raw.ref.probs.map(()=>0),sourceWork=catalog.sources.map(()=>0),actualMix=[0,0,0];
  let mean=0,second=0,entropy=0,maxProbability=0,nonZeroOrders=0,zeroedOrders=0,probabilityShift=0;
  catalog.orders.forEach((o,i)=>{
    const p=probabilities[i];probabilityShift+=Math.abs(p-raw.probabilities[i])/2;
    if(!p){if(raw.probabilities[i]>0)zeroedOrders++;return;}
    nonZeroOrders++;mean+=p*o.cumulativeMinutes;second+=p*o.cumulativeMinutes**2;entropy-=p*Math.log(p);maxProbability=Math.max(maxProbability,p);
    actualMix[o.itemTypes-1]+=p;o.sourceMinutes.forEach((v,j)=>sourceWork[j]+=p*v);
    let bin=0;while(bin<hist.length-1&&o.cumulativeMinutes>=raw.ref.edges[bin+1])bin++;hist[bin]+=p;
  });
  const sd=Math.sqrt(Math.max(0,second-mean*mean)),shares=sourceWork.map(v=>v/mean),meanError=Math.abs(mean-config.mean),sdError=Math.abs(sd-(Number.isFinite(config.variance)?config.sigma:raw.ref.sd));
  const tv=hist.reduce((s,v,j)=>s+Math.abs(v-raw.ref.probs[j]),0)/2;
  const sourceError=config.sourceEnabled?Math.max(...shares.map((v,j)=>Math.abs(v-config.shares[j]/100))):0;
  const maxSourceShift=Math.max(...shares.map((v,j)=>Math.abs(v-raw.shares[j])));
  return attachFitQuality(catalog,{...raw,config,probabilityScale:scale,integerWeights,probabilities,continuousProbabilities:raw.probabilities,
    mean,sd,shares,sourceWork,actualMix,hist,tv,sourceError,meanError,sdError,effectiveCount:Math.exp(entropy),maxProbability,
    quantization:{scale,unitProbability:1/scale,minimumOrderWeight:floor?1:0,eligibleOrders:floor?.total??raw.count,groupIntegerWeights:budgets,groupTimeBudgets,nonZeroOrders,zeroedOrders,probabilityShift,
      continuous:{mean:raw.mean,sd:raw.sd,tv:raw.tv,sourceError:raw.sourceError,matched:raw.matched},
      changes:{meanMinutes:mean-raw.mean,sdMinutes:sd-raw.sd,maxSourceShareShift:maxSourceShift},method:'largest-remainder-by-item-type-and-fit-time-bin'}});
}
