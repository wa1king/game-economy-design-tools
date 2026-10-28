import {createProjectStore} from './project-storage.js';
import {prepareRanch,groupMetrics} from './ranch-engine.js';
import {ranchSettingsKey} from './ranch-import.js';
import {buildRanchDistributionPlans,reuseRanchDistributionResult} from './ranch-distribution.js';
import {loadRanchCache,mergeRanchCache,mergeRanchCacheValue} from './ranch-cache.js';
import {quantityGroup,quantityOptions} from './ranch-quantity.js';

export const RANCH_TARGET_DEFAULTS={targetHours:'6',targetTolerance:'30',targetWork:'',fitCropMax:'42',fitProductMax:'12',quantityBudget:'2500'};
const targetKeys=Object.keys(RANCH_TARGET_DEFAULTS);
const proven=r=>r?.proven&&Number.isFinite(r.optimalMinutes)&&r.optimalMinutes>=0;
const readJSON=(storage,key)=>JSON.parse(storage.getItem(key)||'null');

export function readRanchTarget(settings={},level){
  const saved=settings.quantityTargetsByLevel?.[level]??(Number(settings.level)===Number(level)?settings.quantityTargets:null);
  return Object.fromEntries(targetKeys.map(key=>[key,String(saved?.[key]??RANCH_TARGET_DEFAULTS[key])]));
}
export function validateRanchTarget(target){
  if(String(target.targetHours).trim()===''||String(target.targetTolerance).trim()==='')throw Error('请填写优化时间目标和允许偏差。');
  quantityOptions({targetMinutes:Number(target.targetHours)*60,toleranceMinutes:Number(target.targetTolerance),targetWorkMinutes:String(target.targetWork).trim()===''?1:Number(target.targetWork),cropMax:Number(target.fitCropMax),productMax:Number(target.fitProductMax),timeLimitMs:Number(target.quantityBudget)});
  return target;
}
export function notifyRanchChange(storageKey,reason='results',storage=globalThis.localStorage){
  try{storage.setItem('ranch-workspace-revision-v1',JSON.stringify({storageKey,reason,id:Date.now()+':'+Math.random()}));}catch{}
}
export function ranchSource(storage=globalThis.localStorage){
  const source=readJSON(storage,'ranch-source-v1');
  return source?.kind==='import'?source:createProjectStore(storage).load();
}
export async function loadRanchWorkspace(deps={}){
  const storage=deps.storage??globalThis.localStorage,source=ranchSource(storage);
  if(!source?.base)return null;
  const base=structuredClone(source.base),storageKey=ranchSettingsKey(base),settings=readJSON(storage,storageKey)??{},model=prepareRanch(base),plans=buildRanchDistributionPlans(base,settings);
  const services={storage,loadCache:deps.loadCache??loadRanchCache,mergeCache:deps.mergeCache??mergeRanchCache,workerFactory:deps.workerFactory??(()=>new Worker('./ranch-worker.js',{type:'module'}))};
  for(const plan of plans){
    plan.metrics??=new Map(plan.groups.map(g=>[g.key,groupMetrics(model,g,plan.level)]));
    plan.quantityFits=new Map();plan.quantityErrors=new Map();
    const cache=await services.loadCache(plan.cacheKey);
    if(cache?.version===1||cache?.version===2){plan.results=new Map(cache.results??[]);plan.failures=new Map(cache.failures??[]);plan.quantityFits=new Map(cache.quantityFits??[]);for(const [id,fit] of plan.quantityFits)if(fit.error)plan.quantityErrors.set(id,fit.error);}
  }
  return {base,filename:source.filename??base.filename??'加工链路',storageKey,settings,model,plans,services};
}
export function saveRanchTargets(ws,cells){
  const next=readJSON(ws.services.storage,ws.storageKey)??structuredClone(ws.settings),drafts=new Map();
  for(const {level,key,value} of cells){
    if(!Number.isInteger(level)||level<1||level>ws.base.maxLevel||!targetKeys.includes(key))throw Error('目标配置包含无效等级或列。');
    if(!drafts.has(level))drafts.set(level,readRanchTarget(next,level));
    drafts.get(level)[key]=String(value);
  }
  for(const [level,target] of drafts){try{validateRanchTarget(target);}catch(error){throw Error(`Lv ${level}：${error.message}`);}}
  next.quantityTargetsByLevel??={};for(const [level,target] of drafts)next.quantityTargetsByLevel[level]=target;
  if(drafts.has(Number(next.level)))next.quantityTargets={...drafts.get(Number(next.level))};
  ws.services.storage.setItem(ws.storageKey,JSON.stringify(next));ws.settings=next;
  notifyRanchChange(ws.storageKey,'targets',ws.services.storage);
}
// Only local edits override the latest stored settings. An idle detail tab must
// not restore an old copy of another view's targets or quantities on navigation.
export function mergeRanchSettings(previous,edited,latest){
  const next=structuredClone(latest??{}),keys=new Set([...Object.keys(previous??{}),...Object.keys(edited??{})]);
  for(const key of keys){
    const before=previous?.[key],after=edited?.[key];
    if(JSON.stringify(before)===JSON.stringify(after))continue;
    if(!Object.hasOwn(edited??{},key)){delete next[key];continue;}
    const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
    next[key]=isObject(after)&&isObject(before)?mergeRanchSettings(before,after,next[key]):structuredClone(after);
  }
  return next;
}
export function watchRanchWorkspace(callback){
  let timer;
  const queue=()=>{clearTimeout(timer);timer=setTimeout(callback,120);};
  const changed=e=>{if(!e.key||e.key==='ranch-workspace-revision-v1'||e.key==='ranch-source-v1'||e.key.startsWith('ranch-settings-v1:'))queue();};
  const visible=()=>{if(document.visibilityState==='visible')queue();};
  window.addEventListener('storage',changed);window.addEventListener('focus',queue);window.addEventListener('pageshow',queue);document.addEventListener('visibilitychange',visible);
  return ()=>{clearTimeout(timer);window.removeEventListener('storage',changed);window.removeEventListener('focus',queue);window.removeEventListener('pageshow',queue);document.removeEventListener('visibilitychange',visible);};
}
const median=values=>{values.sort((a,b)=>a-b);return (values[(values.length-1)>>1]+values[values.length>>1])/2;};
export function ranchAutoWorkTarget(ws,plan,target=readRanchTarget(ws.settings,plan.level)){
  if(String(target.targetWork).trim()!=='')return Number(target.targetWork);
  let ratio=ws.settings.workRatios?.[JSON.stringify([plan.level,plan.capacities])];
  if(!(ratio>0)){const values=plan.groups.map(g=>plan.results.get(g.key)).filter(r=>proven(r)&&r.optimalMinutes>0&&r.totalMinutes>0).map(r=>r.totalMinutes/r.optimalMinutes);if(!values.length)return null;ratio=median(values);}
  return ratio*Number(target.targetHours)*60;
}
export function ranchFitIsCurrent(fit,group,options){
  const best=fit?.recommendations?.[0];
  return Boolean(best&&best.group.key===group.key&&['targetMinutes','toleranceMinutes','targetWorkMinutes','cropMax','productMax','timeLimitMs'].every(k=>fit.options?.[k]===options[k]));
}

// The same worker and verified schedules power all three views. Quantity search
// keeps stable combination IDs; actual-demand keys own scheduling results.
export async function calculateRanchWorkspace(ws,{mode='schedule',signal,onProgress=()=>{},onChange=()=>{}}={}){
  if(!['schedule','quantity'].includes(mode))throw Error('未知计算方式。');
  if(ws.running)throw Error('当前项目正在计算。');
  ws.running=true;let owned=null,active=null,saveQueue=Promise.resolve(),lastSave=0,saveError=null;
  const changedFits=new Map(),reuse=new Map(),report={stopped:false,scheduled:0,fitted:0,failed:0,skipped:0};
  const persistPlan=async plan=>{
    await ws.services.mergeCache(plan.cacheKey,{version:2,results:[...plan.results],failures:[...plan.failures],quantityFits:[...(changedFits.get(plan.level)??new Map())]});
    notifyRanchChange(ws.storageKey,'results',ws.services.storage);
  };
  const queueSave=plan=>{saveQueue=saveQueue.then(()=>persistPlan(plan)).catch(error=>{saveError=error;});return saveQueue;};
  const changed=plan=>{onChange();if(Date.now()-lastSave>1500){lastSave=Date.now();queueSave(plan);}};
  const progress=(plan,phase,index,total,message)=>onProgress({level:plan.level,index,total,phase,message,totalLevels:ws.plans.length});
  const persistQuantity=(plan,group,fit,options)=>{
    const settings=readJSON(ws.services.storage,ws.storageKey)??structuredClone(ws.settings);
    (settings.quantityEdits??={})[plan.level]??={};settings.quantityEdits[plan.level][group.id]=group.slots.map(v=>v.quantity);
    const target=readRanchTarget(settings,plan.level);
    if(target.targetWork.trim()==='')(settings.workRatios??={})[JSON.stringify([plan.level,plan.capacities])]=options.targetWorkMinutes/options.targetMinutes;
    ws.services.storage.setItem(ws.storageKey,JSON.stringify(settings));ws.settings=settings;
    if(!changedFits.has(plan.level))changedFits.set(plan.level,new Map());changedFits.get(plan.level).set(group.id,fit);
  };
  const run=(plan,items,phase,options=null)=>new Promise((resolve,reject)=>{
    if(!items.length||signal?.aborted){resolve();return;}
    const worker=ws.services.workerFactory();owned=worker;let ended=false;
    const finish=error=>{if(ended)return;ended=true;worker.terminate();if(owned===worker)owned=null;signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>finish();signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>{
      if(ended||signal?.aborted||owned!==worker)return;
      try{
        if(data.type==='result'){
          const g=plan.groups.find(g=>g.key===data.id);if(!g)throw Error('排产结果不属于当前组合。');
          const merged=mergeRanchCacheValue({results:[...plan.results]},{results:[[g.key,data.result]]});plan.results=new Map(merged.results);plan.failures.delete(g.key);report.scheduled++;
          if(proven(plan.results.get(g.key)))reuse.set(JSON.stringify([plan.capacities,g.key]),{group:g,result:plan.results.get(g.key)});
          changed(plan);
        }else if(data.type==='quantityResult'){
          const i=plan.groups.findIndex(g=>g.id===data.id),best=data.fit?.recommendations?.[0];
          if(i<0||!best)throw Error('配量结果缺少对应组合或数量建议。');
          const previous=plan.groups[i],updated=quantityGroup(previous,best.group.slots.map(v=>v.quantity));
          if(updated.slots.some((v,j)=>v.id!==best.group.slots[j].id)||updated.key!==best.group.key)throw Error('配量结果的商品与当前组合不一致。');
          plan.groups[i]=updated;plan.results=new Map(mergeRanchCacheValue({results:[...plan.results]},{results:[[updated.key,best.result]]}).results);best.result=plan.results.get(updated.key);plan.failures.delete(updated.key);plan.quantityErrors.delete(updated.id);plan.quantityFits.set(updated.id,data.fit);
          const metrics=groupMetrics(ws.model,updated,plan.level);plan.metrics.set(updated.key,metrics);plan.work.set(updated.key,metrics.totalMinutes);
          persistQuantity(plan,updated,data.fit,options);report.fitted++;changed(plan);
        }else if(data.type==='groupError'){
          report.failed++;
          if(phase==='quantity'){plan.quantityErrors.set(data.id,data.message);const fit={error:data.message};plan.quantityFits.set(data.id,fit);if(!changedFits.has(plan.level))changedFits.set(plan.level,new Map());changedFits.get(plan.level).set(data.id,fit);}
          else plan.failures.set(data.id,data.message);
          changed(plan);
        }else if(data.type==='error'){finish(Error(`Lv ${plan.level}：${data.message}`));return;}
        if(['result','quantityResult','groupError'].includes(data.type))progress(plan,phase,data.index,data.total,`Lv ${plan.level} · ${phase==='quantity'?'配量':'排产'} ${data.index} / ${data.total}${data.type==='groupError'?' · '+data.message:''}`);
        if(data.type==='done')finish();
      }catch(error){finish(error);}
    };
    worker.onerror=e=>finish(Error(e.message||'计算中断，已完成结果已保留。'));
    worker.postMessage(phase==='quantity'?{mode:'quantity',base:ws.base,groups:items,level:plan.level,capacities:plan.capacities,options,baselines:Object.fromEntries(items.map(g=>[g.id,plan.results.get(g.key)]))}:{base:ws.base,groups:items.map(g=>({...g,id:g.key})),level:plan.level,capacities:plan.capacities,timeLimitMs:Number(ws.settings.searchLimit)||2000});
  });
  try{
    if(mode==='quantity')for(const p of ws.plans)if(p.groups.length)validateRanchTarget(readRanchTarget(ws.settings,p.level));
    for(const p of ws.plans)for(const g of p.groups){const r=p.results.get(g.key);if(proven(r))reuse.set(JSON.stringify([p.capacities,g.key]),{group:g,result:r});}
    for(const plan of ws.plans){
      if(signal?.aborted)break;active=plan;plan.targetError=null;
      if(!plan.groups.length)continue;
      if(plan.capacityError){report.failed++;progress(plan,'error',0,plan.groups.length,`Lv ${plan.level}：${plan.capacityError}`);continue;}
      for(const g of plan.groups){const donor=reuse.get(JSON.stringify([plan.capacities,g.key]));if(donor)plan.results.set(g.key,reuseRanchDistributionResult(donor,g));}
      const target=readRanchTarget(ws.settings,plan.level);
      if(mode==='schedule'||(target.targetWork.trim()===''&&ranchAutoWorkTarget(ws,plan,target)==null)){
        const pending=plan.groups.filter(g=>!proven(plan.results.get(g.key)));
        progress(plan,'schedule',0,pending.length,`Lv ${plan.level} · ${mode==='quantity'?'先计算配量基线':'排产'} · ${pending.length} 组`);
        await run(plan,pending,'schedule');
      }
      if(mode==='quantity'&&!signal?.aborted){
        const work=ranchAutoWorkTarget(ws,plan,target);
        if(!(work>0)){report.failed++;plan.targetError='尚无可用于估算累计工时的最优排程；请填写累计工时目标，或增加排产搜索时限。';progress(plan,'error',0,plan.groups.length,`Lv ${plan.level}：${plan.targetError}`);}
        else{
          const options=quantityOptions({targetMinutes:Number(target.targetHours)*60,toleranceMinutes:Number(target.targetTolerance),targetWorkMinutes:work,cropMax:Number(target.fitCropMax),productMax:Number(target.fitProductMax),timeLimitMs:Number(target.quantityBudget)});
          const pending=plan.groups.filter(g=>!ranchFitIsCurrent(plan.quantityFits.get(g.id),g,options));report.skipped+=plan.groups.length-pending.length;
          progress(plan,'quantity',0,pending.length,`Lv ${plan.level} · 配量 ${pending.length} 组`);await run(plan,pending,'quantity',options);
        }
      }
      await queueSave(plan);onChange();active=null;
    }
    report.stopped=Boolean(signal?.aborted);return report;
  }finally{
    try{owned?.terminate();if(active)await queueSave(active);await saveQueue;}
    finally{ws.running=false;notifyRanchChange(ws.storageKey,'results',ws.services.storage);onChange();}
    if(saveError)throw saveError;
  }
}
