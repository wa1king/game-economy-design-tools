(function(){
 'use strict';
 const base=new URL('./',document.currentScript.src),originalFetch=globalThis.fetch.bind(globalThis),jobs=new Map(),pending=new Map();
 let engine,sequence=0,bootstrapPromise;
 const uuid=()=>crypto.randomUUID().replaceAll('-','');
 function rpc(kind,payload,onProgress){
  if(!engine){
   engine=new Worker(new URL('browser-worker.js',base));
   engine.onmessage=({data})=>{
    if(data.startupError){for(const operation of pending.values())operation.reject(Error('计算环境加载失败，请刷新后重试。'+data.startupError));pending.clear();engine.terminate();engine=null;return}
    const operation=pending.get(data.id);if(!operation)return;
    if(data.progress){operation.onProgress?.(data.progress);return}
    pending.delete(data.id);if(data.error)operation.reject(Error(data.error));else operation.resolve(data.result);
   };
   engine.onerror=event=>{for(const operation of pending.values())operation.reject(Error(event.message||'浏览器计算未完成'));pending.clear();engine.terminate();engine=null};
  }
  const id=++sequence;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,onProgress});engine.postMessage({id,kind,payload})});
 }
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
 const bootstrap=()=>bootstrapPromise??=(originalFetch(new URL('bootstrap.json',base)).then(response=>{if(!response.ok)throw Error('方案加载失败');return response.json()}));
 function job(kind,operation){
  const id=uuid(),state={kind,status:'running',current:0,total:0,product:'正在计算'};jobs.set(id,state);
  operation(progress=>Object.assign(state,progress)).then(result=>Object.assign(state,result,{status:'done'})).catch(error=>Object.assign(state,{status:'error',error:error.message}));
  return json({jobId:id},202);
 }
 const binaryBase64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text)};
 async function storeSnapshot(id,html){
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('game-economy-chain-snapshots',1);request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
  await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({html},id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
 }
 async function api(path,options={}){
  if(path==='/api/bootstrap')return json(await bootstrap());
  if(path==='/api/reference')return originalFetch(new URL('reference.json',base));
  if(path.startsWith('/api/jobs/')){const state=jobs.get(path.split('/').pop());if(!state)return json({error:'任务不存在'},404);const {bytes,...data}=state;return json(data)}
  if(path.startsWith('/api/download/')){const state=jobs.get(path.split('/').pop());return state?.bytes?new Response(state.bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}}):json({error:'文件尚未生成'},404)}
  if(path==='/api/import-excel')return json(await rpc('import',{base64:binaryBase64(new Uint8Array(options.body))}));
  const payload=typeof options.body==='string'?JSON.parse(options.body):options.body;
  if(path==='/api/validate')return json(await rpc('validate',payload));
  if(path==='/api/calculate')return job('calculate',async progress=>{const result=await rpc('calculate',payload,progress);return {analysis:result.analysis}});
  if(path==='/api/export')return job('export',async progress=>{
   const result=await rpc('calculate',payload,progress);progress({product:'正在生成Excel',current:result.design.products.length,total:result.design.products.length});
   const {buildWorkbookPlan}=await import(new URL('plan-builder.mjs',base));const plan=await buildWorkbookPlan(result.design,result.analysis);
   return rpc('export',plan,progress);
  });
  if(path==='/api/generate-chain')return job('chain',async progress=>{
   const result=await rpc('calculate',payload,progress),{renderSnapshot}=await import(new URL('snapshot-builder.mjs',base)),id=uuid();
   await storeSnapshot(id,renderSnapshot(result.design,result.analysis));
   return {snapshot:{url:'snapshot-viewer.html?id='+id,generatedAt:new Date().toISOString(),products:result.design.products.length}};
  });
  return json({error:'操作不存在'},404);
 }
 globalThis.fetch=async function(input,options){
  const raw=typeof input==='string'?input:input?.url;
  const path=raw&&new URL(raw,base).pathname;
  if(raw?.startsWith('/api/')||path?.startsWith(base.pathname+'api/')){
   const apiPath=raw.startsWith('/api/')?raw:'/api/'+path.slice((base.pathname+'api/').length);
   try{return await api(apiPath,options)}catch(error){return json({error:error.message},400)}
  }
  return originalFetch(input,options);
 };
})();
