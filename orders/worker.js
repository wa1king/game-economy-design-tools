import {fit} from './solver.js';
let catalog;
self.onmessage=({data})=>{
  try {
    if(data.type==='init'){catalog=data.catalog;self.postMessage({type:'ready'});return;}
    const result=fit(catalog,data.config,p=>self.postMessage({type:'progress',request:data.request,...p}));
    self.postMessage({type:'result',result,initial:data.initial,request:data.request});
  }catch(e){self.postMessage({type:'error',message:e.message,request:data.request});}
};
