import {eligibleOrder,probabilityFloorPlan} from './probability-floor.js';

// Exact marginal ratio bounds (up to bisection accuracy), with fixed kind
// masses and probability floors. Mean/variance and other source targets are
// deliberately not imposed: violating these looser bounds proves a conflict.
export function sourceShareRanges(catalog,config){
  const orders=catalog.orders.filter(o=>eligibleOrder(o,config)),groups=[[],[],[]];
  const floor=config.minimumOrderWeight?probabilityFloorPlan(catalog,config):null;
  if(!orders.length||(floor&&!floor.feasible))return [];
  const lower=floor?1/config.probabilityScale:0;
  orders.forEach(o=>groups[o.itemTypes-1].push(o));
  const free=groups.map((g,k)=>config.mix[k]/100-lower*g.length);
  if(groups.some((g,k)=>free[k]>1e-12&&!g.length))return [];
  const fixedTime=orders.reduce((s,o)=>s+lower*o.cumulativeMinutes,0);
  return catalog.sources.map((source,j)=>{
    const fixedWork=orders.reduce((s,o)=>s+lower*o.sourceMinutes[j],0);
    function extreme(maximize){
      let lo=0,hi=1;
      for(let iteration=0;iteration<45;iteration++){
        const ratio=(lo+hi)/2;let support=fixedWork-ratio*fixedTime;
        for(let k=0;k<3;k++){
          if(free[k]<=1e-15)continue;
          let best=maximize?-Infinity:Infinity;
          for(const o of groups[k]){const v=o.sourceMinutes[j]-ratio*o.cumulativeMinutes;best=maximize?Math.max(best,v):Math.min(best,v);}
          support+=free[k]*best;
        }
        if(support>0)lo=ratio;else hi=ratio;
      }
      return (lo+hi)/2;
    }
    return {index:j,name:source.name,min:extreme(false),max:extreme(true),target:config.shares[j]/100};
  });
}

export function marginalSourceConflict(catalog,config,tolerance=.01){
  if(!config.sourceEnabled)return null;
  const ranges=sourceShareRanges(catalog,config),violations=ranges.filter(r=>r.target<r.min-tolerance-1e-9||r.target>r.max+tolerance+1e-9);
  if(!violations.length)return null;
  violations.sort((a,b)=>Math.max(b.min-b.target,b.target-b.max)-Math.max(a.min-a.target,a.target-a.max));
  const r=violations[0];
  const raw=config.rawSourceWeights,other=Array.isArray(raw)?raw.reduce((sum,value,j)=>sum+(j!==r.index&&config.shares[j]>0?value:0),0):0;
  const weightHint=other>0?`其他来源权重保持不变时，${r.name}原始权重约需落在 ${(other*r.min/(1-r.min)).toFixed(3)}～${r.max<1-1e-9?(other*r.max/(1-r.max)).toFixed(3):'无上限'}。`:'';
  return {scope:'sources',ranges,reason:`${r.name}目标 ${(r.target*100).toFixed(2)}%，但当前商品种类占比和每单保底下，可达范围为 ${(r.min*100).toFixed(2)}%～${(r.max*100).toFixed(2)}%。${weightHint}请调整该来源权重，或修改商品种类占比/保底设置。此范围尚未限制均值、波动及其他来源目标，落入范围不保证全部目标同时可达。`};

}

// A positive separating support is a certificate of impossibility. Failure to
// find one is inconclusive, never a claim that the targets are feasible.
export function sourceConflict(catalog,config,{moments=false,iterations=250,sourceTolerance=0,meanTolerance=0,sdTolerance=0}={}){
  if(!config.sourceEnabled)return null;
  const floor=config.minimumOrderWeight?probabilityFloorPlan(catalog,config):null;
  if(floor&&!floor.feasible)return null;
  const orders=catalog.orders.filter(o=>eligibleOrder(o,config));if(!orders.length)return null;
  const lower=floor?1/config.probabilityScale:0,groups=[[],[],[]],q=config.shares.map(v=>v/100);
  const enabled=q.map((v,j)=>v>0?j:-1).filter(j=>j>=0),D=enabled.length+(moments?2:0),scale=Math.max(1,config.mean),variance=Number.isFinite(config.variance)?config.variance:config.sigma**2;
  const secondScale=Math.max(1,variance+config.mean**2),features=new Float64Array(orders.length*D),fixed=new Float64Array(D),x=new Float64Array(D),times=orders.map(o=>o.cumulativeMinutes/scale),fixedTime=times.reduce((s,v)=>s+lower*v,0);
  orders.forEach((o,i)=>{groups[o.itemTypes-1].push(i);const offset=i*D;
    enabled.forEach((j,k)=>features[offset+k]=(o.sourceMinutes[j]-q[j]*o.cumulativeMinutes)/scale);
    if(moments){features[offset+D-2]=(o.cumulativeMinutes-config.mean)/scale;features[offset+D-1]=((o.cumulativeMinutes-config.mean)**2-variance)/secondScale;}
    for(let j=0;j<D;j++)fixed[j]+=lower*features[offset+j];
  });
  const free=groups.map((g,k)=>Math.max(0,config.mix[k]/100-lower*g.length));
  if(groups.some((g,k)=>free[k]>0&&!g.length))return null;
  x.set(fixed);groups.forEach((g,k)=>{for(const i of g)for(let j=0;j<D;j++)x[j]+=free[k]/g.length*features[i*D+j];});
  const dot=(a,b)=>a.reduce((s,v,j)=>s+v*b[j],0);
  for(let step=0;step<iterations;step++){
    const norm=Math.sqrt(dot(x,x));if(norm<1e-8)return null;
    const vertex=Float64Array.from(fixed);
    const sourceAllowance=sourceTolerance*enabled.reduce((s,_,j)=>s+Math.abs(x[j]),0);
    let support=dot(x,fixed)-sourceAllowance*fixedTime;
    groups.forEach((g,k)=>{if(free[k]<=0)return;let best=Infinity,index=-1;
      let certificateBest=Infinity;
      for(const i of g){let value=0;for(let j=0;j<D;j++)value+=x[j]*features[i*D+j];if(value<best){best=value;index=i;}certificateBest=Math.min(certificateBest,value-sourceAllowance*times[i]);}
      support+=free[k]*certificateBest;
      for(let j=0;j<D;j++)vertex[j]+=free[k]*features[index*D+j];
    });
    if(moments){const sd=Math.sqrt(Math.max(0,variance)),low=((Math.max(0,sd-sdTolerance))**2-variance)/secondScale,high=((sd+sdTolerance)**2+meanTolerance**2-variance)/secondScale;
      support-=Math.abs(x[D-2])*meanTolerance/scale+Math.max(x[D-1]*low,x[D-1]*high);}
    const gap=support/norm;
    if(gap>1e-7)return {scope:moments?'combined':'sources',gap,direction:Array.from(x),sourceIndices:enabled,iterations:step+1};
    const delta=vertex.map((v,j)=>v-x[j]),den=dot(delta,delta);if(den<1e-20)return null;
    const rate=Math.max(0,Math.min(1,-dot(x,delta)/den));if(rate<1e-14)return null;
    x.forEach((v,j)=>x[j]=v+rate*delta[j]);
  }
  return null;
}
