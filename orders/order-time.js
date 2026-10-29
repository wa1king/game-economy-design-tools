const signature=base=>JSON.stringify({products:base.products.map(p=>[p.id,p.level,p.buildingId,p.isCrop,p.category,p.stepMinutes,p.analysisBatchYield,p.inputs,p.coproducts]),sources:base.sources.map(s=>[s.id,s.category,s.id===0||s.name==='农田'||s.name==='田地']),lands:base.landsByLevel});
export function createOrderTimingService({workerFactory=()=>new Worker('./order-time-worker.js',{type:'module'}),onChange=()=>{}}={}){
  let current,stamp,worker,running,notifyTimer;const cache=new Map(),queue=new Map(),waiters=new Set();
  function key(order,level){return JSON.stringify([current.landsByLevel?.[level]??null,order.items]);}
  function notify(){if(notifyTimer==null)notifyTimer=setTimeout(()=>{notifyTimer=null;onChange();},50);for(const check of [...waiters])check();}
  function bind(base){
    if(base===current)return;const next=signature(base);current=base;if(next===stamp)return;
    stamp=next;worker?.terminate();worker=null;running=null;cache.clear();queue.clear();notify();
  }
  function pump(){
    if(running||!queue.size)return;
    if(!worker){
      const instance=workerFactory();worker=instance;
      instance.onmessage=({data})=>{if(worker!==instance||data.key!==running)return;cache.set(data.key,data.timing);running=null;notify();pump();};
      instance.onerror=()=>{if(worker!==instance)return;if(running)cache.set(running,{error:'排产计算中断，请刷新后重试。'});for(const k of queue.keys())cache.set(k,{error:'排产计算中断，请刷新后重试。'});queue.clear();running=null;worker.terminate();worker=null;notify();};
      worker.postMessage({type:'init',base:current});
    }
    const [k,job]=queue.entries().next().value;queue.delete(k);running=k;worker.postMessage({type:'solve',key:k,...job});
  }
  function ensure(base,orders,level){
    bind(base);for(const order of orders){const k=key(order,level);if(!cache.has(k)&&running!==k&&!queue.has(k))queue.set(k,{items:order.items,level});}pump();
  }
  return {get(base,order,level){bind(base);return cache.get(key(order,level));},ensure,
    async waitFor(base,requests){
      bind(base);const wanted=stamp,entries=requests.map(({order,level})=>({key:key(order,level),order,level}));
      for(const {order,level} of entries)ensure(base,[order],level);
      if(entries.every(e=>cache.has(e.key)))return;
      await new Promise((resolve,reject)=>{const check=()=>{if(stamp!==wanted){waiters.delete(check);reject(Error('商品配方已变化，请重新导出。'));}else if(entries.every(e=>cache.has(e.key))){waiters.delete(check);resolve();}};waiters.add(check);check();});
    },destroy(){worker?.terminate();clearTimeout(notifyTimer);}
  };
}
