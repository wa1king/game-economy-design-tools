import {prepareRanch,ranchCapacities,solveProductionDemand} from './ranch-engine.js';
let model,error;
self.onmessage=({data})=>{
  if(data.type==='init'){try{model=prepareRanch(data.base);error=null;}catch(e){model=null;error=e.message;}return;}
  if(data.type!=='solve')return;
  try{
    if(error)throw Error(error);
    const r=solveProductionDemand(model,data.items,data.level,ranchCapacities(model,data.level),{timeLimitMs:200,nodeLimit:3000});
    const {optimalMinutes,feasibleMinutes,lowerMinutes,proven,taskCount}=r;
    self.postMessage({key:data.key,timing:{optimalMinutes,feasibleMinutes,lowerMinutes,proven,taskCount}});
  }catch(e){self.postMessage({key:data.key,timing:{error:e.message}});}
};
