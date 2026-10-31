import {solveRanchGroupCached as solveRanchGroup} from './ranch-schedule-cache.js';
import {ranchDemandKey} from './ranch-catalog.js';
import {groupMetrics} from './ranch-engine.js';
export const QUANTITY_SEARCH_VERSION=4;
const clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
const unitProfiles=new WeakMap();
const fitSignatures=new WeakMap();
const compare=(a,b)=>{for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]-b[i];}return 0;};
export function quantityGroup(group,quantities){
  if(quantities.length!==4||quantities.some(v=>!Number.isSafeInteger(v)||v<1))throw Error('四个交付数量都必须是正整数。');
  const result={...group,slots:group.slots.map((v,i)=>({...v,quantity:quantities[i]}))};result.key=ranchDemandKey(result);return result;
}
export function hasEqualProductQuantities(group){
  if(!Array.isArray(group?.slots)||group.slots.length!==4)return false;
  const quantities=new Map();for(const slot of group.slots){if(!Number.isSafeInteger(slot.quantity)||slot.quantity<1)return false;if(quantities.has(slot.id)&&quantities.get(slot.id)!==slot.quantity)return false;quantities.set(slot.id,slot.quantity);}return true;
}
export function linkedProductQuantities(group,index,value){
  if(!Number.isInteger(index)||index<0||index>=group.slots.length)throw Error('请选择有效的订单位置。');
  if(!Number.isSafeInteger(value)||value<1)throw Error('交付数量必须是正整数。');
  const id=group.slots[index].id;return group.slots.map(slot=>slot.id===id?value:slot.quantity);
}
export function quantityOptions(options={}){
  const value={targetMinutes:360,toleranceMinutes:30,targetWorkMinutes:1080,cropMax:42,productMax:12,timeLimitMs:2500,maxEvaluations:42,...options};
  for(const key of ['targetMinutes','targetWorkMinutes','timeLimitMs'])if(!Number.isFinite(value[key])||value[key]<=0)throw Error('目标时间和搜索预算必须大于0。');
  if(!Number.isFinite(value.toleranceMinutes)||value.toleranceMinutes<0||value.toleranceMinutes>=value.targetMinutes)throw Error('允许偏差应不小于0且小于目标优化时间。');
  for(const key of ['cropMax','productMax'])if(!Number.isSafeInteger(value[key])||value[key]<1||value[key]>100)throw Error('自动配量的数量上限需为1至100的整数。');
  if(!Number.isSafeInteger(value.maxEvaluations)||value.maxEvaluations<1||value.maxEvaluations>200)throw Error('候选复核数量超出范围。');
  return value;
}
export function ranchQuantityProfile(model,group,capacities){
  let memo=unitProfiles.get(model);if(!memo){memo=new Map();unitProfiles.set(model,memo);}
  function unit(id){if(memo.has(id))return memo.get(id);const p=model.by.get(id),work={[p.buildingId]:p.stepMinutes};let tasks=1,critical=0;
    for(const input of p.inputs){const u=unit(input.id);tasks+=input.quantity*u.tasks;critical=Math.max(critical,u.critical);for(const [b,w] of Object.entries(u.work))work[b]=(work[b]||0)+input.quantity*w;}
    const result={work,tasks,critical:critical+p.stepMinutes,total:Object.values(work).reduce((s,v)=>s+v,0)};memo.set(id,result);return result;
  }
  const units=group.slots.map(v=>unit(v.id)),resources=[...new Set(units.flatMap(u=>Object.keys(u.work)))];
  for(const b of resources)if(!Number.isSafeInteger(Number(capacities[b]))||Number(capacities[b])<1)throw Error('请先填写全部生产来源的实际并行容量。');
  return {units,resources,estimate(q){const sourceMinutes=Object.fromEntries(resources.map(b=>[b,units.reduce((s,u,i)=>s+(u.work[b]||0)*q[i],0)]));return {totalMinutes:units.reduce((s,u,i)=>s+u.total*q[i],0),taskCount:units.reduce((s,u,i)=>s+u.tasks*q[i],0),lowerMinutes:Math.max(...units.map(u=>u.critical),...resources.map(b=>sourceMinutes[b]/capacities[b])),sourceMinutes};}};
}
export function quantityRank(candidate,options,mode='work'){
  const {result,group}=candidate,T=options.targetMinutes,tol=options.toleranceMinutes,lo=T-tol,hi=T+tol;
  const lower=result.lowerMinutes,upper=result.feasibleMinutes,certified=lower>=lo-1e-7&&upper<=hi+1e-7;
  const actual=result.proven?result.optimalMinutes:upper,timeError=Math.abs(actual-T),workError=Math.abs(result.totalMinutes-options.targetWorkMinutes),quantity=group.slots.reduce((s,v)=>s+v.quantity,0);
  const category=result.proven&&certified?0:certified?1:result.proven?2:3;
  if(category<2)return [category,...(mode==='time'?[timeError,workError,quantity]:mode==='quantity'?[quantity,workError,timeError]:[workError,timeError,quantity])];
  return [category,timeError,workError,quantity];
}
class Bank{
  values=[];
  constructor(size){this.size=size;}
  offer(q,score){
    if(this.values.length===this.size&&compare(score,this.values.at(-1).score)>=0)return;
    const key=q.join(',');if(this.values.some(v=>v.key===key))return;
    // Insert after equal scores, matching stable sort without sorting the bank again.
    let at=this.values.length;while(at>0&&compare(score,this.values[at-1].score)<0)at--;
    this.values.splice(at,0,{key,q:[...q],score});if(this.values.length>this.size)this.values.pop();
  }
}
function values(max,initial){const set=new Set([1,max,clamp(initial,1,max)]);if(max<=24)for(let i=1;i<=max;i++)set.add(i);else for(let i=0;i<24;i++)set.add(1+Math.round((max-1)*i/23));return [...set].sort((a,b)=>a-b);}
// Continuous relaxation: every schedule completing by H must fit all resource
// work in capacity*H. Its maximum resource work is a necessary upper bound,
// not a promise that a schedule with that work is achievable.
export function workUpperAtTime(profile,capacities,max,H){
  const constraints=[];
  for(let i=0;i<4;i++){const row=[0,0,0,0];row[i]=1;constraints.push({row,b:max[i]});constraints.push({row:row.map(x=>-x),b:-1});}
  for(const r of profile.resources){const row=profile.units.map(u=>u.work[r]||0),scale=Math.max(...row);if(scale)constraints.push({row:row.map(x=>x/scale),b:capacities[r]*H/scale});}
  function intersect(rows){const a=rows.map(c=>[...c.row,c.b]);for(let i=0;i<4;i++){let pivot=i;for(let j=i+1;j<4;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;if(Math.abs(a[pivot][i])<1e-10)return null;[a[i],a[pivot]]=[a[pivot],a[i]];const divisor=a[i][i];for(let k=i;k<=4;k++)a[i][k]/=divisor;for(let j=0;j<4;j++)if(j!==i){const f=a[j][i];for(let k=i;k<=4;k++)a[j][k]-=f*a[i][k];}}return a.map(v=>v[4]);}
  let best=null;const n=constraints.length;
  for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)for(let c=b+1;c<n;c++)for(let d=c+1;d<n;d++){
    const q=intersect([constraints[a],constraints[b],constraints[c],constraints[d]]);if(!q||q.some(x=>!Number.isFinite(x))||constraints.some(v=>v.row.reduce((s,x,i)=>s+x*q[i],0)>v.b+1e-7))continue;
    const value=profile.units.reduce((s,u,i)=>s+u.total*q[i],0);best=Math.max(best??0,value);
  }
  return best==null?null:Math.ceil(best+Math.max(1e-6,Math.abs(best)*1e-8));
}
export function quantityCandidates(model,group,capacities,options,baseline){
  const profile=ranchQuantityProfile(model,group,capacities),max=group.slots.map(v=>model.by.get(v.id).isCrop?options.cropMax:options.productMax),initial=group.slots.map((v,i)=>clamp(v.quantity,1,max[i])),banks=[new Bank(16),new Bank(16),new Bank(16)],seeds=new Map(),seen=new Set();let considered=0,taskLimited=0;
  const linkedAxes=[];for(let i=0;i<4;i++){let axis=linkedAxes.find(indices=>group.slots[indices[0]].id===group.slots[i].id);if(!axis){axis=[];linkedAxes.push(axis);}axis.push(i);}
  // Old unequal inputs remain untouched. Only the search seed is projected onto
  // one integer quantity per product, with all occurrences sharing that value.
  for(const indices of linkedAxes)if(indices.length>1){const value=clamp(Math.round(indices.reduce((sum,i)=>sum+group.slots[i].quantity,0)/indices.length),1,max[indices[0]]);for(const i of indices)initial[i]=value;}
  const usableBaseline=hasEqualProductQuantities(group)?baseline:null;
  const minimum=profile.estimate([1,1,1,1]),maximum=profile.estimate(max);
  if(minimum.lowerMinutes>options.targetMinutes+options.toleranceMinutes)return {quantities:[[1,1,1,1]],considered:1,taskLimited:0,minWork:minimum.totalMinutes,maxWork:maximum.totalMinutes};
  const offset=usableBaseline?.proven?Math.max(0,usableBaseline.optimalMinutes-profile.estimate(group.slots.map(v=>v.quantity)).lowerMinutes):0;
  // Reuse numeric buffers in the enumeration hot loop. Keep the original
  // left-to-right sum order: fractional times must produce the same ranks.
  const normalized=[0,0,0,0],sourceTimes=profile.resources.map(()=>0);
  const workRows=profile.resources.map(r=>profile.units.map(u=>u.work[r]||0)),caps=profile.resources.map(r=>capacities[r]);
  const critical=Math.max(...profile.units.map(u=>u.critical));let totalMinutes,taskCount,lowerMinutes;
  function estimate(q){
    totalMinutes=0;taskCount=0;for(let i=0;i<4;i++){totalMinutes+=profile.units[i].total*q[i];taskCount+=profile.units[i].tasks*q[i];}
    lowerMinutes=critical;for(let r=0;r<workRows.length;r++){let work=0;for(let i=0;i<4;i++)work+=workRows[r][i]*q[i];sourceTimes[r]=work;lowerMinutes=Math.max(lowerMinutes,work/caps[r]);}
  }
  function offer(q,seed=false){
    for(let i=0;i<4;i++)normalized[i]=clamp(Math.round(q[i]),1,max[i]);
    considered++;const key=((normalized[0]*101+normalized[1])*101+normalized[2])*101+normalized[3];
    if(seen.has(key))return;seen.add(key);estimate(normalized);if(taskCount>1200){taskLimited++;return;}
    const predicted=lowerMinutes+offset,excess=Math.max(0,lowerMinutes-options.targetMinutes-options.toleranceMinutes),te=Math.abs(predicted-options.targetMinutes)/options.targetMinutes,we=Math.abs(totalMinutes-options.targetWorkMinutes)/options.targetWorkMinutes;
    banks[0].offer(normalized,[excess,te,we]);banks[1].offer(normalized,[excess,Math.max(0,te-options.toleranceMinutes/options.targetMinutes),we,te]);banks[2].offer(normalized,[excess,te+we,we]);if(seed)seeds.set(normalized.join(','),[...normalized]);
  }
  offer(initial,true);offer([1,1,1,1],true);
  const baseTime=usableBaseline?.proven?usableBaseline.optimalMinutes:profile.estimate(initial).lowerMinutes;
  for(const scale of [.5,.75,1,1.25,1.5])offer(initial.map(q=>q*options.targetMinutes/Math.max(1,baseTime)*scale),true);
  offer(max,true);
  if(linkedAxes.length<4){
    // Repeated products reduce the search to one, two or three variables.
    // Enumerate every integer vector in that reduced space before bank ranking.
    const q=[...initial];
    function visit(axis){if(axis===linkedAxes.length){offer(q);return;}const indices=linkedAxes[axis];for(let value=1;value<=max[indices[0]];value++){for(const i of indices)q[i]=value;visit(axis+1);}}
    visit(0);
  }else{
  const pivot=profile.units.reduce((best,u,i)=>u.total>profile.units[best].total?i:best,0),axes=[0,1,2,3].filter(i=>i!==pivot),ranges=axes.map(i=>values(max[i],initial[i]));
  const q=[...initial],times=[options.targetMinutes-options.toleranceMinutes,options.targetMinutes,options.targetMinutes+options.toleranceMinutes];
  for(const a of ranges[0])for(const b of ranges[1])for(const c of ranges[2]){
    q[axes[0]]=a;q[axes[1]]=b;q[axes[2]]=c;q[pivot]=0;estimate(q);
    const candidates=new Set([1,max[pivot],initial[pivot],(options.targetWorkMinutes-totalMinutes)/profile.units[pivot].total]);
    for(let r=0;r<profile.resources.length;r++){const w=workRows[r][pivot];if(w)for(const t of times)candidates.add(((t-offset)*caps[r]-sourceTimes[r])/w);}
    for(const v of candidates){q[pivot]=Math.floor(v);offer(q);q[pivot]=Math.ceil(v);offer(q);}
  }
  }
  const selected=new Map();for(const q of seeds.values())selected.set(q.join(','),q);
  for(let i=0;i<16;i++)for(const bank of banks){const v=bank.values[i];if(v)selected.set(v.key,v.q);}
  const lists=[...selected.values()].slice(0,options.maxEvaluations);
  return {quantities:lists,considered,taskLimited,minWork:profile.estimate([1,1,1,1]).totalMinutes,maxWork:profile.estimate(max).totalMinutes};
}
// Only discard candidates that cannot improve ANY of the three recommendations.
// Work comes from the same metrics routine as the actual solver, not a proxy.
export function quantityCandidateDominated(group,metrics,lowerMinutes,options,evaluated){
  const winners=evaluated.filter(v=>v.result.proven&&quantityRank(v,options)[0]===0);
  if(!winners.length)return false;
  if(lowerMinutes>options.targetMinutes+options.toleranceMinutes+1e-7)return true;
  const workError=Math.abs(metrics.totalMinutes-options.targetWorkMinutes),quantity=group.slots.reduce((s,v)=>s+v.quantity,0);
  const error=v=>Math.abs(v.result.totalMinutes-options.targetWorkMinutes),count=v=>v.group.slots.reduce((s,v)=>s+v.quantity,0);
  return winners.some(v=>error(v)<workError)
    &&winners.some(v=>v.result.optimalMinutes===options.targetMinutes&&error(v)<workError)
    &&winners.some(v=>count(v)<quantity||(count(v)===quantity&&error(v)<workError));
}
// Endpoints remain scheduled for diagnostics, but proving their exact optimum
// is unnecessary once a verified result beats every time they can attain.
export function quantityEndpointDominated(lowerMinutes,options,evaluated){
  if(!(lowerMinutes>options.targetMinutes+options.toleranceMinutes+1e-7))return false;
  const minimumError=lowerMinutes-options.targetMinutes;
  return evaluated.some(v=>v.result.proven&&(quantityRank(v,options)[0]===0||Math.abs(v.result.optimalMinutes-options.targetMinutes)<minimumError));
}
function* quantitySearch(model,group,level,capacities,rawOptions={},baseline=null,onProgress=()=>{}){
  const options=quantityOptions(rawOptions),start=performance.now(),pool=quantityCandidates(model,group,capacities,options,baseline),evaluated=[],failures=[];let tried=0,prunedCount=0,endpointProofSkips=0;
  const pruningProfile=ranchQuantityProfile(model,group,capacities),pruningMax=group.slots.map(v=>model.by.get(v.id).isCrop?options.cropMax:options.productMax);
  // Integer-minute inputs give an exact resource-work lower bound. Fractional
  // inputs use zero here rather than risk pruning on floating-point roundoff.
  const integerTimes=group.slots.every(v=>[...model.chains.get(v.id)].every(id=>Number.isSafeInteger(model.by.get(id).stepMinutes)))&&pruningProfile.units.every(u=>Number.isSafeInteger(u.critical));
  function safeLower(q){const estimate=pruningProfile.estimate(q);return integerTimes&&Object.values(estimate.sourceMinutes).every(Number.isSafeInteger)?Math.ceil(estimate.lowerMinutes):0;}
  function endpoint(q){return q.every(v=>v===1)||q.every((v,i)=>v===pruningMax[i]);}
  function dominated(candidate,q){
    if(endpoint(q)||!evaluated.some(v=>v.result.proven&&quantityRank(v,options)[0]===0))return false;
    return quantityCandidateDominated(candidate,groupMetrics(model,candidate,level),safeLower(q),options,evaluated);
  }
  // A current, already verified schedule is reusable only for exactly the same quantities.
  if(baseline&&hasEqualProductQuantities(group)&&group.slots.every(v=>v.quantity<=(model.by.get(v.id).isCrop?options.cropMax:options.productMax)))evaluated.push({group:structuredClone(group),result:baseline});
  for(const q of pool.quantities){
    if(tried&&performance.now()-start>=options.timeLimitMs)break;
    const candidate=quantityGroup(group,q);if(evaluated.some(v=>ranchDemandKey(v.group)===candidate.key))continue;
    if(dominated(candidate,q)){prunedCount++;continue;}
    const skipEndpointProof=endpoint(q)&&quantityEndpointDominated(safeLower(q),options,evaluated);if(skipEndpointProof)endpointProofSkips++;
    try{const result=yield {model,group:candidate,level,capacities,options:{timeLimitMs:skipEndpointProof?0:Math.min(120,Math.max(0,options.timeLimitMs-(performance.now()-start))),nodeLimit:1500}};evaluated.push({group:candidate,result});}catch(error){failures.push(error.message);}
    tried++;onProgress({tried,candidates:pool.quantities.length});
  }
  if(!evaluated.length)throw Error(failures[0]||'搜索范围内未找到可计算的数量配置。');
  // Correct the resource-bound predictor with real joint schedules. A nearby
  // integer quantity may hit the band even when all top proxy candidates miss it.
  const profileForRefine=ranchQuantityProfile(model,group,capacities),max=group.slots.map(v=>model.by.get(v.id).isCrop?options.cropMax:options.productMax);
  const certified=v=>v.result.lowerMinutes>=options.targetMinutes-options.toleranceMinutes-1e-7&&v.result.feasibleMinutes<=options.targetMinutes+options.toleranceMinutes+1e-7;
  const minImpossible=profileForRefine.estimate([1,1,1,1]).lowerMinutes>options.targetMinutes+options.toleranceMinutes;
  const upper=evaluated.find(v=>v.group.slots.every((slot,i)=>slot.quantity===max[i]));
  const maxTooFast=upper?.result.feasibleMinutes<options.targetMinutes-options.toleranceMinutes;
  for(let pass=0;pass<2&&!minImpossible&&!maxTooFast&&!evaluated.some(certified);pass++){
    const best=[...evaluated].sort((a,b)=>compare(quantityRank(a,options,'time'),quantityRank(b,options,'time')))[0];let added=0;
    const representatives=best.group.slots.map((slot,i)=>best.group.slots.findIndex(v=>v.id===slot.id)===i?i:-1).filter(i=>i>=0);
    for(const i of representatives)for(const delta of [-1,1]){
      if(evaluated.length>=options.maxEvaluations||performance.now()-start>=options.timeLimitMs)break;
      const value=best.group.slots[i].quantity+delta;if(value<1||value>max[i])continue;const q=linkedProductQuantities(best.group,i,value);
      const candidate=quantityGroup(group,q);if(evaluated.some(v=>v.group.key===candidate.key))continue;
      try{const result=yield {model,group:candidate,level,capacities,options:{timeLimitMs:Math.min(120,Math.max(0,options.timeLimitMs-(performance.now()-start))),nodeLimit:1500}};evaluated.push({group:candidate,result});added++;}catch(error){failures.push(error.message);}tried++;onProgress({tried,candidates:Math.max(pool.quantities.length,evaluated.length)});
    }
    if(!added)break;
  }
  const recommendations=[],labels={work:'累计工时更接近',time:'优化时间更接近',quantity:'交付件数较少'};
  for(const mode of ['work','time','quantity']){const ranked=[...evaluated].sort((a,b)=>compare(quantityRank(a,options,mode),quantityRank(b,options,mode))),best=ranked[0];if(!recommendations.some(v=>ranchDemandKey(v.group)===ranchDemandKey(best.group)))recommendations.push({...best,label:labels[mode]});}
  const best=recommendations[0],within=best.result.lowerMinutes>=options.targetMinutes-options.toleranceMinutes-1e-7&&best.result.feasibleMinutes<=options.targetMinutes+options.toleranceMinutes+1e-7,profile=ranchQuantityProfile(model,group,capacities),workUpper=workUpperAtTime(profile,capacities,group.slots.map(v=>model.by.get(v.id).isCrop?options.cropMax:options.productMax),options.targetMinutes+options.toleranceMinutes);
  const minimum=evaluated.find(v=>v.group.slots.every(s=>s.quantity===1));let reason=within?'已找到目标范围内的数量配置。':'本轮搜索未找到已确认落入目标时间范围的配置，可调整数量上限或增加搜索时限。';
  if(maxTooFast)reason=`数量全部达到上限时，已有排程也仅需 ${Math.round(upper.result.feasibleMinutes)} 分钟，低于目标下限；当前数量上限无法达到目标。`;
  if(minimum?.result.lowerMinutes>options.targetMinutes+options.toleranceMinutes)reason='四种商品各1个的最优时间下界已超过目标范围；增加数量不能缩短整组最优时间。';
  if(options.targetWorkMinutes<pool.minWork||options.targetWorkMinutes>pool.maxWork)reason+=` 累计工时目标超出数量范围可达到的 ${Math.round(pool.minWork)}～${Math.round(pool.maxWork)} 分钟。`;
  else if(workUpper!=null&&options.targetWorkMinutes>workUpper)reason+=` 在优化时间不超过 ${Math.round(options.targetMinutes+options.toleranceMinutes)} 分钟时，本组累计工时的理论上限为 ${workUpper} 分钟，低于共同目标。`;
  return {searchVersion:QUANTITY_SEARCH_VERSION,options,recommendations,within,reason,tried,prunedCount,endpointProofSkips,evaluatedCount:evaluated.length,considered:pool.considered,taskLimited:pool.taskLimited,workUpperAtTime:workUpper,provenCount:evaluated.filter(v=>v.result.proven).length,elapsedMs:Math.round(performance.now()-start),quantitySearchProven:false,method:'bounded_candidate_search_with_joint_schedule_verification'};
}

// This ratio is an inexpensive planning estimate. It is never a claimed schedule.
export function estimateRanchWorkRatio(model,groups,capacities){
  const ratios=groups.map(group=>{const profile=ranchQuantityProfile(model,group,capacities),largest=Math.max(...profile.units.map(u=>u.total));const balanced=profile.units.map(u=>largest/u.total),value=profile.estimate(balanced);return value.totalMinutes/value.lowerMinutes;}).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>a-b);
  return ratios.length?(ratios[(ratios.length-1)>>1]+ratios[ratios.length>>1])/2:null;
}
export function ranchQuantityFitKey(model,group,capacities,options){
  const profile=ranchQuantityProfile(model,group,capacities);
  let signatures=fitSignatures.get(model);if(!signatures){signatures=new Map();fitSignatures.set(model,signatures);}
  const recipes=group.slots.map(v=>{if(!signatures.has(v.id))signatures.set(v.id,[...model.chains.get(v.id)].sort((a,b)=>a-b).map(id=>{const p=model.by.get(id);return [id,p.buildingId,p.stepMinutes,p.inputs];}));return signatures.get(v.id);});
  return JSON.stringify([QUANTITY_SEARCH_VERSION,group.slots.map(v=>v.id),recipes,profile.resources.sort().map(id=>[id,Number(capacities[id])]),quantityOptions(options)]);
}
export function reuseRanchQuantityFit(fit,group,capacities){
  if(!fit?.recommendations?.length)throw Error('缺少可复用的配量结果。');
  return {...fit,reused:true,elapsedMs:0,recommendations:fit.recommendations.map(candidate=>{
    if(candidate.group.slots.some((v,i)=>v.id!==group.slots[i].id))throw Error('不能复用商品不同的配量结果。');
    if(!hasEqualProductQuantities(candidate.group))throw Error('旧配量中相同商品的数量不一致，需要重新配量。');
    const updated=quantityGroup(group,candidate.group.slots.map(v=>v.quantity));
    return {...candidate,group:updated,result:{...candidate.result,assumptions:{...candidate.result.assumptions,capacities:{...capacities}}}};
  })};
}

// One search implementation: synchronous callers retain their existing API;
// browser workers await the mature solver for exactly the same fixed demands.
export function fitRanchQuantities(...args){
  const search=quantitySearch(...args);let state=search.next();
  while(!state.done){try{const v=state.value;state=search.next(solveRanchGroup(v.model,v.group,v.level,v.capacities,v.options));}catch(error){state=search.throw(error);}}
  return state.value;
}
export async function fitRanchQuantitiesAsync(solver,...args){
  const search=quantitySearch(...args);let state=search.next();
  while(!state.done){try{const v=state.value;state=search.next(await solver(v.model,v.group,v.level,v.capacities,v.options));}catch(error){state=search.throw(error);}}
  return state.value;
}
