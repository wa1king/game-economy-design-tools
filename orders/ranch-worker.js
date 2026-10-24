import {prepareRanch,solveRanchGroup} from './ranch-engine.js';
import {fitRanchQuantities} from './ranch-quantity.js';
self.onmessage=async({data})=>{
  try{
    const model=prepareRanch(data.base);
    for(let i=0;i<data.groups.length;i++){
      const group=data.groups[i];
      try{
        if(data.mode==='quantity'){
          const fit=fitRanchQuantities(model,group,data.level,data.capacities,data.options,data.baselines?.[group.id]??null,progress=>self.postMessage({type:'quantityProgress',id:group.id,index:i+1,total:data.groups.length,...progress}));
          self.postMessage({type:'quantityResult',id:group.id,fit,index:i+1,total:data.groups.length});
        }else{const result=solveRanchGroup(model,group,data.level,data.capacities,{timeLimitMs:data.timeLimitMs,nodeLimit:10000});self.postMessage({type:'result',id:group.id,result,index:i+1,total:data.groups.length});}
      }
      catch(error){self.postMessage({type:'groupError',id:group.id,message:error.message,index:i+1,total:data.groups.length});}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    self.postMessage({type:'done'});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
