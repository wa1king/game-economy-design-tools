import {eligibleOrder} from './probability-floor.js';

// Explicit targets decide acceptance. Normal shape remains an optimization
// preference, reported separately rather than vetoing a finite discrete pool.
export function targetsSatisfied(r){
  const c=r.config,sdTarget=Number.isFinite(c.variance)?c.sigma:r.ref.sd;
  const mixTolerance=c.probabilityScale?1/c.probabilityScale+1e-9:1e-7;
  return Boolean(r.converged)&&r.meanError<=Math.max(.5,c.mean*.01)&&
    r.sdError<=Math.max(2,sdTarget*.05)&&(!c.sourceEnabled||r.sourceError<=.01)&&
    r.actualMix.every((p,j)=>Math.abs(p-c.mix[j]/100)<=mixTolerance);
}

export function timeShapeSummary(catalog,r){
  const eligible=catalog.orders.filter(o=>eligibleOrder(o,r.config));
  const times=[...new Set(eligible.map(o=>o.cumulativeMinutes))];
  const occupied=r.ref.probs.map(()=>false);
  for(const t of times){let b=0;while(b<occupied.length-1&&t>=r.ref.edges[b+1])b++;occupied[b]=true;}
  const unavoidableEmptyMass=r.ref.probs.reduce((s,p,b)=>s+(occupied[b]?0:p),0);
  const sigma=Number.isFinite(r.config.variance)?r.config.sigma:r.ref.sd;
  const lower=r.config.mean-sigma,upper=r.config.mean+sigma,bands=[0,0,0];
  catalog.orders.forEach((o,i)=>{const p=r.probabilities[i]||0,t=o.cumulativeMinutes;if(p>0)bands[t<lower?0:t>upper?2:1]+=p;});
  const state=times.length===1?'single':unavoidableEmptyMass>.1?'discrete':r.tv>.1?'review':'close';
  return {state,distinctTimes:times.length,unavoidableEmptyMass,lower,upper,bands,
    label:state==='single'?'仅 1 种工时':state==='discrete'?`仅 ${times.length} 种工时 · 有空档`:state==='review'?'分布待检查':'接近钟形参考',
    acceptance:'informational-only'};
}

export function attachFitQuality(catalog,r){
  return {...r,matched:targetsSatisfied(r),acceptanceBasis:'explicit-targets-v1',
    shapeAssessment:timeShapeSummary(catalog,r)};
}
