/* A fixed-probability fit. No inventory information enters this module. */
import {probabilityFloorPlan,eligibleOrder} from './probability-floor.js';
import {sourceConflict,marginalSourceConflict} from './source-feasibility.js';
import {attachFitQuality} from './fit-quality.js';
export function cdf(x) {
  const z=Math.abs(x)/Math.SQRT2, t=1/(1+.3275911*z);
  const erf=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-z*z);
  return (1+Math.sign(x)*erf)/2;
}
const pdf=x=>Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);
function reference(lo,hi,mean,sigma,bins) {
  // Adjust the parent normal's location so its truncated mean matches the requested mean.
  function moments(loc) {
    const a=(lo-loc)/sigma,b=(hi-loc)/sigma,Z=cdf(b)-cdf(a);
    if(Z<1e-12) return {mean:loc<lo?lo:hi,sd:0,Z};
    const shift=(pdf(a)-pdf(b))/Z;
    return {mean:loc+sigma*shift,sd:sigma*Math.sqrt(Math.max(0,1+(a*pdf(a)-b*pdf(b))/Z-shift*shift)),Z};
  }
  let a=lo-8*sigma,b=hi+8*sigma;
  for(let j=0;j<80;j++){const mid=(a+b)/2;if(moments(mid).mean<mean)a=mid;else b=mid;}
  const loc=(a+b)/2,m=moments(loc);
  // Refine the normal's central region so small sigma cannot hide inside a huge bin.
  const left=Math.max(lo,mean-4*sigma),right=Math.min(hi,mean+4*sigma);
  const edges=[...new Set([lo,...Array.from({length:bins-1},(_,j)=>left+(right-left)*j/(bins-2)),hi])].sort((a,b)=>a-b);
  let probs=edges.slice(0,-1).map((x,j)=>Math.max(0,(cdf((edges[j+1]-loc)/sigma)-cdf((x-loc)/sigma))/m.Z));
  const sum=probs.reduce((a,b)=>a+b,0);probs=probs.map(x=>x/sum);
  return {edges,probs,location:loc,mean:m.mean,sd:m.sd,sigma};
}
function solveLinear(A,b) {
  const n=b.length,L=new Float64Array(n*n),x=new Float64Array(n),y=new Float64Array(n),scaling=Float64Array.from(b,(_,i)=>Math.sqrt(Math.max(A[i*n+i],1e-30)));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let v=A[i*n+j]/scaling[i]/scaling[j];for(let k=0;k<j;k++)v-=L[i*n+k]*L[j*n+k];
    if(i===j&&(!Number.isFinite(v)||v<=1e-14))return null;
    L[i*n+j]=i===j?Math.sqrt(v):v/L[j*n+j];
  }
  for(let i=0;i<n;i++){let v=b[i]/scaling[i];for(let j=0;j<i;j++)v-=L[i*n+j]*y[j];y[i]=v/L[i*n+i];}
  for(let i=n-1;i>=0;i--){let v=y[i];for(let j=i+1;j<n;j++)v-=L[j*n+i]*x[j];x[i]=v/L[i*n+i];}
  for(let i=0;i<n;i++)x[i]/=scaling[i];
  return x;
}
export function fit(catalog,config,onProgress=()=>{}) {
  const pool=catalog.orders.filter(o=>o.minimumLevel<=config.level&&(o.maximumLevel==null||o.maximumLevel>=config.level)),mix=config.mix.map(x=>x/100),q=config.shares.map(x=>x/100);
  if(mix.some(x=>x<0)||Math.abs(mix.reduce((a,b)=>a+b,0)-1)>1e-7)throw Error('每单商品种类占比必须合计 100%。');
  if(config.sourceEnabled&&Math.abs(q.reduce((a,b)=>a+b,0)-1)>1e-6)throw Error('来源工时占比必须合计 100%。请先归一化。');
  // A zero work-share is a genuine exclusion, not a weak numerical target.
  const eligible=pool.filter(o=>eligibleOrder(o,config));
  const groups=[1,2,3].map(k=>eligible.filter(o=>o.itemTypes===k));
  for(let k=0;k<3;k++)if(mix[k]>0&&!groups[k].length)return {blocked:true,reason:`${k+1} 种商品订单占比大于 0，但筛选后没有这类订单。将该类占比设为 0 并补足其他类别至 100%，或恢复被设为 0 的来源权重。`};
  const floorPlan=config.minimumOrderWeight?probabilityFloorPlan(catalog,config):null;
  if(floorPlan&&!floorPlan.feasible)return {blocked:true,reason:floorPlan.reason,floorPlan};
  const marginalConflict=marginalSourceConflict(catalog,config);
  if(marginalConflict)return {blocked:true,reason:marginalConflict.reason,sourceConflict:marginalConflict};
  const lower=floorPlan?1/config.probabilityScale:0,freeMass=groups.map((g,k)=>Math.max(0,mix[k]-g.length*lower));
  const bounds=groups.map(g=>g.length?[Math.min(...g.map(o=>o.cumulativeMinutes)),Math.max(...g.map(o=>o.cumulativeMinutes))]:[0,0]);
  const fixedMean=eligible.reduce((s,o)=>s+lower*o.cumulativeMinutes,0);
  const minMean=fixedMean+bounds.reduce((s,b,k)=>s+freeMass[k]*b[0],0),maxMean=fixedMean+bounds.reduce((s,b,k)=>s+freeMass[k]*b[1],0);
  if(config.mean<minMean-1e-6||config.mean>maxMean+1e-6)return {blocked:true,reason:`${floorPlan?'当前订单占比和每单保底约束下':'当前订单种类占比下'}，平均累计工时目标 ${config.mean.toFixed(1)} 分钟超出 ${minMean.toFixed(1)}～${maxMean.toFixed(1)} 分钟范围。请将均值移入此范围，或调整商品种类占比/保底设置；范围内仍需检查来源和波动的联合约束。`,minMean,maxMean};
  const orders=eligible,lo=Math.min(...orders.map(o=>o.cumulativeMinutes)),hi=Math.max(...orders.map(o=>o.cumulativeMinutes));
  // Dimensionless, centered features make the optimization independent of
  // minute/second units and avoid subtracting two large raw second moments.
  const scale=Math.max((hi-lo)/4,config.sigma,config.mean*.01,1e-12),sourceScale=Math.max(config.mean,1e-12);
  if(Number.isFinite(config.variance)&&config.variance>(hi-lo)**2/4+1e-8)return {blocked:true,reason:`当前工时波动目标 ${(config.sigma/config.mean*100).toFixed(2)}%；候选工时范围下，波动比例不可能超过 ${((hi-lo)/2/config.mean*100).toFixed(2)}%。请降低波动目标。`};

  const edgeInset=(hi-lo)*1e-8;
  const ref=hi===lo?{edges:[lo-.5,hi+.5],probs:[1],mean:lo,sd:0,sigma:config.sigma}:config.sigma===0?{edges:[lo,hi],probs:[1],mean:config.mean,sd:0,sigma:0}:reference(lo,hi,Math.max(lo+edgeInset,Math.min(hi-edgeInset,config.mean)),config.sigma,28),bins=ref.probs.length;
  const targets=[0,(Number.isFinite(config.variance)?config.variance:ref.sd**2)/scale**2],strengths=[1e8,1e8],features=[];
  const sourceIndices=[];
  if(config.sourceEnabled)for(let j=0;j<q.length;j++)if(q[j]>0){sourceIndices.push(j);targets.push(0);strengths.push(1e8);}
  const shapeOffset=targets.length;
  // Shape is deliberately a soft constraint: a finite discrete catalog cannot be exactly continuous normal.
  const shapeStrength=Math.max(1e-12,config.shapeStrength??400);
  for(let b=0;b<bins;b++){targets.push(ref.probs[b]);strengths.push(shapeStrength);}
  const D=targets.length,theta=new Float64Array(D),groupIndices=[[],[],[]];
  for(let i=0;i<orders.length;i++){
    const o=orders[i],ids=[0,1],vals=[(o.cumulativeMinutes-config.mean)/scale,((o.cumulativeMinutes-config.mean)/scale)**2];
    sourceIndices.forEach((j,n)=>{const v=(o.sourceMinutes[j]-q[j]*o.cumulativeMinutes)/sourceScale;if(v){ids.push(n+2);vals.push(v);}});
    let bin=0;while(bin<bins-1&&o.cumulativeMinutes>=ref.edges[bin+1])bin++;
    ids.push(shapeOffset+bin);vals.push(1);features.push({ids,vals,bin});groupIndices[o.itemTypes-1].push(i);
  }
  const fixedFeatures=new Float64Array(D);
  if(lower)for(const f of features)for(let j=0;j<f.ids.length;j++)fixedFeatures[f.ids[j]]+=lower*f.vals[j];
  function evaluate(th,hessian=false) {
    const weights=new Float64Array(orders.length),grad=new Float64Array(D),H=hessian?new Float64Array(D*D):null;
    let loss=0;for(let j=0;j<D;j++){grad[j]=fixedFeatures[j];loss+=th[j]*fixedFeatures[j];}
    for(let k=0;k<3;k++){
      if(!mix[k])continue;
      if(freeMass[k]<=1e-15){groupIndices[k].forEach(i=>weights[i]=lower);continue;}
      const indices=groupIndices[k],logs=new Float64Array(indices.length);let top=-Infinity;
      for(let n=0;n<indices.length;n++){const f=features[indices[n]];let v=0;for(let a=0;a<f.ids.length;a++)v+=th[f.ids[a]]*f.vals[a];logs[n]=v;top=Math.max(top,v);}
      let sum=0;for(let n=0;n<logs.length;n++)sum+=Math.exp(logs[n]-top);
      loss+=freeMass[k]*(top+Math.log(sum/indices.length));const avg=new Float64Array(D);
      for(let n=0;n<indices.length;n++){
        const i=indices[n],w=freeMass[k]*Math.exp(logs[n]-top)/sum,f=features[i];weights[i]=lower+w;
        for(let a=0;a<f.ids.length;a++){const ia=f.ids[a],va=f.vals[a];avg[ia]+=w*va;
          if(H)for(let b=0;b<f.ids.length;b++)H[ia*D+f.ids[b]]+=w*va*f.vals[b];}
      }
      for(let a=0;a<D;a++){grad[a]+=avg[a];if(H)for(let b=0;b<D;b++)H[a*D+b]-=avg[a]*avg[b]/freeMass[k];}
    }
    for(let a=0;a<D;a++){loss-=th[a]*targets[a];loss+=th[a]*th[a]/(2*strengths[a]);grad[a]+=-targets[a]+th[a]/strengths[a];if(H)H[a*D+a]+=1/strengths[a];}
    return {loss,grad,H,weights};
  }
  let state=evaluate(theta,true),iterations=0,converged=false,termination='iteration_limit',backtracks=0,dampedSteps=0;
  for(let step=0;step<95;step++){
    iterations=step+1;const norm=Math.max(...state.grad.map(Math.abs));
    if(norm<2e-8){converged=true;termination='gradient_tolerance';break;}
    let direction=solveLinear(state.H,state.grad);
    if(!direction){
      for(let damping=1e-8;damping<=1&&!direction;damping*=10){const H=state.H.slice();for(let j=0;j<D;j++)H[j*D+j]+=damping*Math.max(state.H[j*D+j],1e-8);direction=solveLinear(H,state.grad);}
      dampedSteps++;
    }
    if(!direction){termination='linear_system_failure';break;}
    const dot=direction.reduce((s,d,j)=>s+d*state.grad[j],0);
    if(!Number.isFinite(dot)||dot<=0){termination='non_descent_direction';break;}
    let rate=1,accepted=false;
    for(let line=0;line<30;line++){
      const candidate=theta.map((t,j)=>t-rate*direction[j]),next=evaluate(candidate);
      if(Number.isFinite(next.loss)&&next.loss<=state.loss-1e-4*rate*dot+1e-12){theta.set(candidate);accepted=true;break;}rate*=.5;backtracks++;
    }
    if(!accepted){termination='line_search_failure';break;}
    state=evaluate(theta,true);if(step%5===0)onProgress({iteration:step+1});
  }
  const probabilities=new Float64Array(catalog.orders.length),index=new Map(catalog.orders.map((o,i)=>[o.id,i]));
  let mean=0,second=0,entropy=0,maxP=0;const sourceWork=catalog.sources.map(()=>0),hist=Array(bins).fill(0),actualMix=[0,0,0];
  orders.forEach((o,i)=>{
    const w=state.weights[i];probabilities[index.get(o.id)]=w;mean+=w*o.cumulativeMinutes;second+=w*o.cumulativeMinutes**2;
    actualMix[o.itemTypes-1]+=w;hist[features[i].bin]+=w;maxP=Math.max(maxP,w);if(w>0)entropy-=w*Math.log(w);
    o.sourceMinutes.forEach((t,j)=>sourceWork[j]+=w*t);
  });
  const shares=sourceWork.map(t=>t/mean),tv=hist.reduce((s,v,b)=>s+Math.abs(v-ref.probs[b]),0)/2;
  const sourceError=config.sourceEnabled?Math.max(...shares.map((v,j)=>Math.abs(v-q[j]))):0;
  const meanError=Math.abs(mean-config.mean),sd=Math.sqrt(Math.max(0,second-mean*mean)),sdError=Math.abs(sd-(Number.isFinite(config.variance)?config.sigma:ref.sd));
  if(config.sourceEnabled&&sourceError>.01){
    const diagnosticConfig={...config,variance:Number.isFinite(config.variance)?config.variance:ref.sd**2};
    const conflict=sourceConflict(catalog,diagnosticConfig,{sourceTolerance:.01})||sourceConflict(catalog,diagnosticConfig,{moments:true,sourceTolerance:.01,meanTolerance:Math.max(.5,config.mean*.01),sdTolerance:Math.max(2,Math.sqrt(diagnosticConfig.variance)*.05)});
    if(conflict){
      const targets=conflict.sourceIndices.map(j=>`${catalog.sources[j].name} ${config.shares[j].toFixed(2)}%`).join('、');
      const reason=conflict.scope==='sources'?`来源目标不能同时满足：${targets}。当前配方、商品种类占比及每单保底已确认存在联合冲突；请调整来源权重，或调整商品种类占比/保底。单个来源落在其范围内也不代表整组可达。`:`来源目标（${targets}）与均值 ${config.mean.toFixed(1)} 分钟、工时波动 ${(config.sigma/config.mean*100).toFixed(2)}% 不能同时满足。请优先调整均值或波动；也可关闭来源约束对比拟合，定位联动影响。尚未计算出保证所有目标可达的替代参数。`;
      return {blocked:true,reason,sourceConflict:conflict};
    }
  }
  const numericalDiagnostics={termination,gradientMax:Math.max(...state.grad.map(Math.abs)),backtracks,dampedSteps,timeScale:scale,sourceScale,momentStrength:1e8,sourceStrength:1e8,shapeStrength,maxIterations:95,gradientTolerance:2e-8,armijo:1e-4};
  return attachFitQuality(catalog,{probabilities:Array.from(probabilities),mean,sd,sdError,shares,sourceWork,actualMix,hist,ref,tv,sourceError,meanError,converged,iterations,minMean,maxMean,count:orders.length,effectiveCount:Math.exp(entropy),maxProbability:maxP,config,floorPlan,numericalDiagnostics});
}
