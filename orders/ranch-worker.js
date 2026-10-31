import {prepareRanch,solveRanchGroup} from './ranch-engine.js';
import {fitRanchQuantities} from './ranch-quantity.js';
let model=null,sourceSignature=null;
self.onmessage=async({data})=>{
  const post=message=>self.postMessage({...message,requestId:data.requestId});
  try{
    const signature=JSON.stringify(data.base);
    if(signature!==sourceSignature){const prepared=prepareRanch(data.base);model=prepared;sourceSignature=signature;}
    for(let i=0;i<data.groups.length;i++){
      const group=data.groups[i];
      try{
        if(data.mode==='quantity'){
          const fit=fitRanchQuantities(model,group,data.level,data.capacities,data.options,data.baselines?.[group.id]??null,progress=>post({type:'quantityProgress',id:group.id,index:i+1,total:data.groups.length,...progress}));
          post({type:'quantityResult',id:group.id,fit,index:i+1,total:data.groups.length});
        }else{const result=solveRanchGroup(model,group,data.level,data.capacities,{timeLimitMs:data.timeLimitMs,nodeLimit:10000});post({type:'result',id:group.id,result,index:i+1,total:data.groups.length});}
      }
      catch(error){post({type:'groupError',id:group.id,message:error.message,index:i+1,total:data.groups.length});}
      // This runs off the UI thread; pausing terminates the worker directly.
      // Per-group timers add browser timer throttling without making it safer.
    }
    post({type:'done'});
  }catch(error){post({type:'error',message:error.message});}
};
