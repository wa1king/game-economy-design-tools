import {prepareRanch,ranchCapacities,solveProductionDemand} from './ranch-engine.js';
let model,error;
self.onmessage=({data})=>{
  if(data.type==='init'){try{model=prepareRanch(data.base);error=null;}catch(e){model=null;error=e.message;}return;}
  if(data.type!=='solve')return;
  try{
    if(error)throw Error(error);
    const capacities=ranchCapacities(model,data.level);
    for(const source of model.base.sources)if(!Number.isSafeInteger(capacities[source.id])||capacities[source.id]<1)throw Error(`Lv ${data.level} 缺少 ${source.name} 的并行容量；请补齐 Excel 中的“累计土地”信息。`);
    const r=solveProductionDemand(model,data.items,data.level,capacities,{timeLimitMs:200,nodeLimit:3000});
    const {optimalMinutes,feasibleMinutes,lowerMinutes,proven,taskCount}=r;
    self.postMessage({key:data.key,timing:{optimalMinutes,feasibleMinutes,lowerMinutes,proven,taskCount}});
  }catch(e){self.postMessage({key:data.key,timing:{error:e.message}});}
};
