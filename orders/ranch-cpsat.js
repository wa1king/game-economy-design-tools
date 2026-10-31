import {expandRanchTasks,solveRanchGroup,validateRanchSchedule} from './ranch-engine.js';

// Bounds and returned schedules never depend on the quantity-search objective.
// OR-Tools is loaded once, on the worker, only for unresolved fixed demands.
let runtime;
async function loadRuntime(){
  return runtime??=(import('./vendor/ortools/browser/cp-sat.js').then(api=>{api.setCloudNoticeEnabled(false);return api;}));
}
export function createRanchCpSatSolver({load=loadRuntime}={}){
  return async function solve(model,group,level,capacities,options={}){
    const begin=performance.now(),budget=options.timeLimitMs??2000;
    const seed=solveRanchGroup(model,group,level,capacities,{timeLimitMs:0,nodeLimit:0});
    if(seed.proven||budget<=0)return {...seed,solver:'mathematical_bounds'};
    // A non-isolated browser cannot run the shared-memory WASM runtime.
    // Retain validated bounds and schedules rather than inventing a result.
    if(typeof window!=='undefined'||(typeof WorkerGlobalScope!=='undefined'&&typeof SharedArrayBuffer==='undefined')){
      return {...solveRanchGroup(model,group,level,capacities,options),solver:'bounded_search',solverNotice:'浏览器暂未启用本地优化引擎'};
    }
    try{
      const {CpModel,CpSolver}=await load();
      const {tasks,edges,roots,scale}=expandRanchTasks(model,group,level,capacities);
      const lower=Math.round(seed.lowerMinutes*scale),upper=Math.round(seed.feasibleMinutes*scale),cp=new CpModel();
      const starts=tasks.map(t=>cp.newIntVar(0,upper-t.duration,'s'+t.id));
      const ends=tasks.map(t=>cp.newIntVar(t.duration,upper,'e'+t.id));
      const intervals=tasks.map((t,i)=>cp.newIntervalVar(starts[i],t.duration,ends[i],'t'+i));
      for(const [a,b] of edges)cp.add(ends[a].le(starts[b]));
      const resources=new Map();tasks.forEach((t,i)=>{if(!resources.has(t.resource))resources.set(t.resource,[]);resources.get(t.resource).push(intervals[i]);});
      for(const [r,list] of resources){if(list.length<=capacities[r])continue;if(capacities[r]===1)cp.addNoOverlap(list);else cp.addCumulative(list,list.map(()=>1),capacities[r]);}
      const finish=cp.newIntVar(lower,upper,'finish');cp.addMaxEquality(finish,ends);cp.minimize(finish);
      for(const row of seed.schedule){cp.addHint(starts[row.id],Math.round(row.start*scale));cp.addHint(ends[row.id],Math.round(row.end*scale));}cp.addHint(finish,upper);
      const solver=new CpSolver();Object.assign(solver.parameters,{numWorkers:1,maxTimeInSeconds:Math.max(.001,budget/1000),randomSeed:1,absoluteGapLimit:0,relativeGapLimit:0});
      const status=solver.statusName(await solver.solve(cp,{executor:'direct'}));
      if(status==='MODEL_INVALID'||status==='INFEASIBLE')throw Error('优化模型与已验证可行排程矛盾：'+status);
      const hasSolution=status==='OPTIMAL'||status==='FEASIBLE';
      const bestBound=solver.bestObjectiveBound;
      // Round down: weakening an integer lower bound is safe; rounding up a
      // floating-point representation might claim an unjustified certificate.
      const certifiedLower=Number.isFinite(bestBound)?Math.max(lower,Math.floor(bestBound)):lower;
      let times=seed.schedule.reduce((a,t)=>(a[t.id]=Math.round(t.start*scale),a),[]);
      if(hasSolution){const candidate=starts.map(v=>Number(solver.value(v)));validateRanchSchedule(tasks,edges,candidate,capacities);if(Math.max(...tasks.map((t,i)=>candidate[i]+t.duration))<=upper)times=candidate;}
      validateRanchSchedule(tasks,edges,times,capacities);
      const span=Math.max(...tasks.map((t,i)=>times[i]+t.duration));
      if(certifiedLower>span)throw Error('优化器下界超过已验证排程。');
      if(status==='OPTIMAL'&&(Number(solver.objectiveValue)!==span||certifiedLower!==span))throw Error('优化器最优性证书不一致。');
      const proven=certifiedLower===span;
      return {...seed,solver:'or_tools_cp_sat',solverStatus:status,proven,optimalMinutes:proven?span/scale:null,lowerMinutes:certifiedLower/scale,feasibleMinutes:span/scale,
        nodes:solver.numBranches,elapsedMs:Math.round(performance.now()-begin),slotCompletionMinutes:roots.map(ids=>Math.max(...ids.map(i=>times[i]+tasks[i].duration))/scale),
        schedule:tasks.map((t,i)=>({...t,start:times[i]/scale,end:(times[i]+t.duration)/scale,duration:t.duration/scale})).sort((a,b)=>a.start-b.start||a.id-b.id)};
    }catch(error){
      return {...seed,solver:'validated_fallback',solverNotice:'本地优化器未完成：'+error.message,elapsedMs:Math.round(performance.now()-begin)};
    }
  };
}
export const solveRanchGroupCpSat=createRanchCpSatSolver();
