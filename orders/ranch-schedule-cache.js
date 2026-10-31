import {expandRanchTasks,groupMetrics,solveRanchGroup,validateRanchSchedule} from './ranch-engine.js';

// The objective is completion of the entire demand, with no slot deadlines.
// Redistributing copies of the same delivered product between slots therefore
// only relabels independent production trees. A delivered ingredient is kept
// separate from copies of that ingredient consumed by another delivered item.
const compareId=(a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b));
const clock=()=>globalThis.performance?.now?.()??Date.now();
const CACHE_VERSION=1;

function signature(model,group,expanded,capacities){
  const totals=new Map();for(const item of group.slots)totals.set(item.id,(totals.get(item.id)??0)+item.quantity);
  const demand=[...totals].sort((a,b)=>compareId(a[0],b[0]));
  const productIds=[...new Set(expanded.tasks.map(t=>t.productId))].sort(compareId);
  const recipes=productIds.map(id=>{const p=model.by.get(id);return [id,p.buildingId,p.stepMinutes,p.analysisBatchYield,p.inputs.map(v=>[v.id,v.quantity]),p.coproducts??[]];});
  const resources=[...new Set(expanded.tasks.map(t=>t.resource))].sort().map(id=>[id,Number(capacities[id])]);
  return JSON.stringify([CACHE_VERSION,expanded.scale,demand,recipes,resources]);
}

function rootRanges(expanded){
  // expandRanchTasks emits each root and all its descendants contiguously.
  const roots=expanded.roots.flat();
  return roots.map((start,i)=>({start,end:roots[i+1]??expanded.tasks.length,productId:expanded.tasks[start].productId}));
}

function capture(expanded,result){
  if(!result?.proven||!Number.isFinite(result.optimalMinutes)||result.optimalMinutes!==result.lowerMinutes||result.optimalMinutes!==result.feasibleMinutes)return null;
  const {tasks,scale}=expanded,byId=new Map(result.schedule?.map(row=>[row.id,row])??[]),starts=[];
  if(byId.size!==tasks.length)return null;
  for(const task of tasks){
    const row=byId.get(task.id),scaled=row?.start*scale,start=Math.round(scaled);
    // The engine exposes minutes. Recover integer ticks only while rounding is
    // unambiguous; extremely large schedules simply bypass this optimization.
    if(!Number.isSafeInteger(start)||start<0||scaled>2**48||row.start!==start/scale||row.end!==(start+task.duration)/scale||row.duration!==task.duration/scale)return null;
    starts.push(start);
  }
  const makespan=Math.max(...tasks.map((task,i)=>starts[i]+task.duration));
  if(result.optimalMinutes!==makespan/scale)return null;
  const trees=new Map();
  for(const {start,end,productId} of rootRanges(expanded)){
    if(!trees.has(productId))trees.set(productId,[]);
    trees.get(productId).push(tasks.slice(start,end).map((task,i)=>[task.productId,task.resource,task.duration,starts[start+i]]));
  }
  return {trees,makespan,taskCount:tasks.length};
}

function restore(model,group,level,capacities,expanded,entry,begin){
  const {tasks,edges,roots,scale}=expanded,used=new Map(),starts=Array(tasks.length);
  if(tasks.length!==entry.taskCount)throw Error('缓存任务数量不一致。');
  for(const {start,end,productId} of rootRanges(expanded)){
    const index=used.get(productId)??0,tree=entry.trees.get(productId)?.[index];used.set(productId,index+1);
    if(!tree||tree.length!==end-start)throw Error('缓存交付生产树不一致。');
    for(let i=0;i<tree.length;i++){
      const task=tasks[start+i],[id,resource,duration,time]=tree[i];
      if(id!==task.productId||resource!==task.resource||duration!==task.duration)throw Error('缓存配方任务不一致。');
      starts[start+i]=time;
    }
  }
  // Recheck the certificate on the new task IDs, edges and resource capacities.
  validateRanchSchedule(tasks,edges,starts,capacities);
  const makespan=Math.max(...tasks.map((task,i)=>starts[i]+task.duration));
  if(makespan!==entry.makespan)throw Error('缓存排产完成时间不一致。');
  return {...groupMetrics(model,group,level),optimalMinutes:makespan/scale,feasibleMinutes:makespan/scale,lowerMinutes:makespan/scale,proven:true,nodes:0,elapsedMs:Math.round(clock()-begin),taskCount:tasks.length,scheduleReused:true,
    slotCompletionMinutes:roots.map(ids=>Math.max(...ids.map(i=>starts[i]+tasks[i].duration))/scale),
    schedule:tasks.map((task,i)=>({...task,start:starts[i]/scale,end:(starts[i]+task.duration)/scale,duration:task.duration/scale})).sort((a,b)=>a.start-b.start||a.id-b.id),
    assumptions:{inventory:'empty',facilitiesAvailableAt:0,actionsMinutes:0,capacities:{...capacities},objective:'all_four_slots_ready',yield:1}};
}

export function createRanchScheduleCache({maxTasks=24000,maxEntries=512}={}){
  if(!Number.isSafeInteger(maxTasks)||maxTasks<0||!Number.isSafeInteger(maxEntries)||maxEntries<0)throw Error('排产缓存容量必须是非负整数。');
  const models=new WeakMap();
  const state=model=>{if(!models.has(model))models.set(model,{entries:new Map(),tasks:0,hits:0,misses:0,evictions:0});return models.get(model);};
  const remove=(cache,key)=>{const old=cache.entries.get(key);if(old){cache.tasks-=old.taskCount;cache.entries.delete(key);}};
  return {
    solve(model,group,level,capacities,options={}){
      const begin=clock(),expanded=expandRanchTasks(model,group,level,capacities),key=signature(model,group,expanded,capacities),cache=state(model),entry=cache.entries.get(key);
      if(entry){
        try{const result=restore(model,group,level,capacities,expanded,entry,begin);cache.entries.delete(key);cache.entries.set(key,entry);cache.hits++;return result;}
        catch{remove(cache,key);}// Fail closed: re-solve if any remapping check fails.
      }
      cache.misses++;
      const result=solveRanchGroup(model,group,level,capacities,options);
      if(expanded.tasks.length<=maxTasks&&maxEntries>0){
        const saved=capture(expanded,result);
        if(saved){
          while(cache.entries.size&&(cache.tasks+saved.taskCount>maxTasks||cache.entries.size>=maxEntries)){remove(cache,cache.entries.keys().next().value);cache.evictions++;}
          cache.entries.set(key,saved);cache.tasks+=saved.taskCount;
        }
      }
      return result;
    },
    stats(model){const cache=models.get(model);return cache?{entries:cache.entries.size,tasks:cache.tasks,hits:cache.hits,misses:cache.misses,evictions:cache.evictions}:{entries:0,tasks:0,hits:0,misses:0,evictions:0};}
  };
}

const shared=createRanchScheduleCache();
export const solveRanchGroupCached=shared.solve;
export const ranchScheduleCacheStats=shared.stats;
