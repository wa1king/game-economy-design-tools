import {ranchWorkRules} from './ranch-work-rules.js';
import {coinConstraintConflict,quantityIssueError} from './ranch-quantity-issues.js';

// Gold is linear in delivery quantities. Enumerate at most three independent
// integer axes, then solve the fourth axis analytically inside all share bounds.
// No scheduling estimate or old time target participates in this search.
export function ranchCoinCandidates(model,group,profile,options){
  const rules=ranchWorkRules(options),loShare=rules.orderWorkMinPercent/100,hiShare=rules.orderWorkMaxPercent/100;
  const prices=group.slots.map(v=>model.by.get(v.id).coinValue);
  if(prices.some(v=>!Number.isFinite(v)||v<0))throw Error('金币目标需要四种交付商品都有有效金币单价，请先导入价格。');
  const conflict=coinConstraintConflict(model,group,profile,options);if(conflict)throw quantityIssueError(conflict);
  const axes=[];group.slots.forEach((v,i)=>{let axis=axes.find(a=>a.id===v.id);if(!axis){axis={id:v.id,indices:[],max:model.cropIds.has(v.id)?options.cropMax:options.productMax};axes.push(axis);}axis.indices.push(i);});
  for(const axis of axes){axis.price=axis.indices.reduce((s,i)=>s+prices[i],0);axis.work=axis.indices.reduce((s,i)=>s+profile.units[i].total,0);axis.tasks=axis.indices.reduce((s,i)=>s+profile.units[i].tasks,0);}
  const pivot=axes.reduce((a,b)=>b.price>a.price?b:a);if(!(pivot.price>0))throw Error('交付商品金币单价均为0，无法配到正数金币目标。');
  const rest=axes.filter(a=>a!==pivot),q=[1,1,1,1],best=[],pivotSet=new Set(pivot.indices);let considered=0,taskLimited=0,shareFeasible=0;
  function visit(depth){
    if(depth<rest.length){const axis=rest[depth];for(let n=1;n<=axis.max;n++){for(const i of axis.indices)q[i]=n;visit(depth+1);}return;}
    const otherWork=profile.units.reduce((s,u,i)=>s+(pivotSet.has(i)?0:u.total*q[i]),0),otherCoins=prices.reduce((s,v,i)=>s+(pivotSet.has(i)?0:v*q[i]),0),otherTasks=profile.units.reduce((s,u,i)=>s+(pivotSet.has(i)?0:u.tasks*q[i]),0);
    let lower=1,upper=pivot.max,possible=true;
    // c*q >= d; reverse when c is negative. Intersect the actual four slot rules.
    function bound(c,d){if(Math.abs(c)<1e-12){if(d>1e-8)possible=false;}else if(c>0)lower=Math.max(lower,d/c);else upper=Math.min(upper,d/c);}
    for(let i=0;i<4;i++){const c=pivotSet.has(i)?profile.units[i].total:0,d=pivotSet.has(i)?0:profile.units[i].total*q[i];bound(c-loShare*pivot.work,loShare*otherWork-d);bound(hiShare*pivot.work-c,d-hiShare*otherWork);}
    if(!possible||Math.ceil(lower-1e-9)>Math.floor(upper+1e-9))return;
    shareFeasible++;
    const taskUpper=(1200-otherTasks)/pivot.tasks;if(taskUpper<upper)taskLimited++;upper=Math.min(upper,taskUpper);
    const first=Math.ceil(lower-1e-9),last=Math.floor(upper+1e-9);if(!possible||first>last)return;
    const ideal=(options.targetCoins-otherCoins)/pivot.price;
    for(const n of new Set([first,last,Math.floor(ideal),Math.ceil(ideal)].map(n=>Math.max(first,Math.min(last,n))))){
      for(const i of pivot.indices)q[i]=n;considered++;
      const work=otherWork+pivot.work*n;if(!profile.units.every((u,i)=>u.total*q[i]>=loShare*work-1e-8&&u.total*q[i]<=hiShare*work+1e-8))continue;
      const coins=otherCoins+pivot.price*n,score=[Math.abs(coins-options.targetCoins),Math.abs(work-options.targetWorkMinutes),q.reduce((a,b)=>a+b,0)];
      const compare=(a,b)=>{for(let i=0;i<3;i++)if(Math.abs(a[i]-b[i])>1e-8)return a[i]-b[i];return 0;};
      if(best.length===32&&compare(score,best.at(-1).score)>=0)continue;
      let index=best.length;while(index&&compare(score,best[index-1].score)<0)index--;best.splice(index,0,{q:[...q],score,coins,work});if(best.length>32)best.pop();
    }
  }
  visit(0);
  if(!best.length)throw quantityIssueError(shareFeasible?{code:'RANCH_TASK_LIMIT',kind:'limit',message:'存在满足工时占比的数量配置，但展开后均超过当前排产器每组 1200 个生产任务的计算上限。尚不能据此断言金币目标无解；请查看该组加工链或减少需求规模。'}:{code:'RANCH_QUANTITY_INFEASIBLE',kind:'constraint',message:`本预设组合在作物上限 ${options.cropMax}、加工品上限 ${options.productMax}、每单工时占比 ${rules.orderWorkMinPercent}%～${rules.orderWorkMaxPercent}% 下，没有符合要求的整数数量配置（相同商品同数量）。该组合暂不入库，其他组合可正常使用。`});
  return {candidates:best,considered,taskLimited};
}
