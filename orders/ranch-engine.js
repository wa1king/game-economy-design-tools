import {DEFAULT_CROP_QUANTITY} from './order-quantity-rules.js';
// Ranch demand groups have four fixed slots. They do not use normal-order exclusions.
import {validateProducts} from './order-engine.js';
import {orderCoinValue} from './coin-values.js';

const gcd=(a,b)=>b?gcd(b,a%b):a;
const compare=(a,b)=>{for(let i=0;i<a.length;i++){if(a[i]<b[i])return -1;if(a[i]>b[i])return 1;}return 0;};
const positive=(v,label)=>{if(!Number.isSafeInteger(v)||v<1)throw Error(`${label}必须是正整数。`);return v;};
export function prepareRanch(base){
  const {by,depths}=validateProducts(base),chains=new Map();
  for(const p of base.products){
    if(p.analysisBatchYield!==1||(p.coproducts||[]).length)throw Error('牧场精确排产当前支持单次产出1件、无副产的配方；不能将多产出配方当成单件计算。');
    if((p.inputs||[]).some(v=>!Number.isSafeInteger(v.quantity)))throw Error('原料数量超出可计算范围。');
  }
  function chain(id){if(chains.has(id))return chains.get(id);const result=new Set([id]);for(const v of by.get(id).inputs)for(const x of chain(v.id))result.add(x);chains.set(id,result);return result;}
  base.products.forEach(p=>chain(p.id));
  const fields=new Set(base.sources.filter(s=>s.id===0||s.category==='田地'||s.name==='农田'||s.name==='田地').map(s=>s.id));
  const cropIds=new Set(base.products.filter(p=>fields.has(p.buildingId)||p.isCrop||p.category==='田地作物'||p.category==='特殊作物'||p.sourceCategory==='田地').map(p=>p.id));
  return {base,by,depths,chains,cropIds};
}
export function ranchCapacities(model,level){
  return Object.fromEntries(model.base.sources.map(s=>[s.id,(s.category==='田地'||s.id===0||s.name==='农田')?(model.base.landsByLevel?.[level]??null):1]));
}
export function ranchFamilies(model,level,type){
  const ps=model.base.products.filter(p=>p.level<=level),families=[];
  if(type==='building')for(const s of model.base.sources){const products=ps.filter(p=>p.buildingId===s.id&&!model.cropIds.has(p.id));if(products.length>=1)families.push({id:'b'+s.id,name:s.name,productIds:products.map(p=>p.id),anchorId:null});}
  if(type==='chain')for(const p of ps)if(model.depths.get(p.id)>=2){const ids=ps.filter(v=>model.chains.get(p.id).has(v.id)).map(v=>v.id);if(ids.length>=2)families.push({id:'p'+p.id,name:p.name+' · 上游链',productIds:ids,anchorId:p.id});}
  return families;
}
export function generateRanchGroups(model,family,{cropQuantity=DEFAULT_CROP_QUANTITY,productQuantity=1,allowRepeated=true,limit=30000}={}){
  positive(cropQuantity,'作物数量');positive(productQuantity,'加工品数量');
  if(!family)return [];
  // Same-building slots always allow repetition, including four identical items.
  // The optional repeat setting applies only to anchored advanced chains.
  const sameBuilding=family.anchorId==null,repeat=sameBuilding||allowRepeated;
  const groups=[],ids=family.productIds.filter(id=>!sameBuilding||!model.cropIds.has(id)),current=[];
  function visit(start){
    if(current.length===4){
      if(!sameBuilding&&(new Set(current).size<2||!current.includes(family.anchorId)))return;
      if(groups.length>=limit)throw Error(`本组候选超过${limit.toLocaleString()}组，请缩小建筑/主链范围或关闭高级加工链重复商品。未截断生成结果。`);
      const slots=current.map(id=>({id,quantity:model.by.get(id).isCrop?cropQuantity:productQuantity}));
      groups.push({id:'R-'+current.join('-'),slots,weight:1});return;
    }
    for(let i=start;i<ids.length;i++){current.push(ids[i]);visit(repeat?i:i+1);current.pop();}
  }
  visit(0);return groups;
}
function validateGroup(model,group,level){
  if(group.slots?.length!==4)throw Error('需求组必须有四个固定动物位。');
  validateDemand(model,group.slots,level);
}
function validateDemand(model,items,level){
  if(!Array.isArray(items)||!items.length)throw Error('订单缺少交付商品。');
  for(const item of items){const p=model.by.get(item.id);if(!p)throw Error('订单含未知商品。');if(p.level>level)throw Error(`${p.name}尚未解锁。`);positive(item.quantity,p.name+'需求量');}
}
export function groupMetrics(model,group,level){
  validateGroup(model,group,level);
  return productionDemandMetrics(model,group.slots,level);
}
export function productionDemandMetrics(model,items,level){
  validateDemand(model,items,level);
  const counts=new Map(),work=new Map(model.base.sources.map(s=>[s.id,0]));
  for(const v of items)counts.set(v.id,(counts.get(v.id)||0)+v.quantity);
  for(const p of [...model.base.products].sort((a,b)=>model.depths.get(b.id)-model.depths.get(a.id))){
    const n=counts.get(p.id)||0;if(!n)continue;
    work.set(p.buildingId,work.get(p.buildingId)+n*p.stepMinutes);
    for(const v of p.inputs)counts.set(v.id,(counts.get(v.id)||0)+n*v.quantity);
  }
  const slots=items.map(v=>({name:model.by.get(v.id).name,complexity:model.chains.get(v.id).size,...v}));
  const totalMinutes=[...work.values()].reduce((a,b)=>a+b,0);
  if(!Number.isFinite(totalMinutes))throw Error('需求展开工时超出可计算范围。');
  return {totalMinutes,complexity:slots.reduce((a,b)=>a+b.complexity,0),coinValue:orderCoinValue({items},model.by),slots,sourceMinutes:Object.fromEntries(work),counts:Object.fromEntries(counts)};
}
function timeScale(products){
  let scale=1;
  for(const p of products){let d=1;while(Math.abs(p.stepMinutes*d-Math.round(p.stepMinutes*d))>1e-7&&d<1e6)d*=10;
    if(Math.abs(p.stepMinutes*d-Math.round(p.stepMinutes*d))>1e-7)throw Error('单步时间需要不超过6位小数。');scale=scale/gcd(scale,d)*d;}
  return scale;
}
export function expandRanchTasks(model,group,level,capacities){
  validateGroup(model,group,level);return expandProductionTasks(model,group.slots,level,capacities);
}
export function expandProductionTasks(model,items,level,capacities){
  validateDemand(model,items,level);const tasks=[],edges=[],roots=[],scale=timeScale(model.base.products);
  function add(id,slot){
    if(tasks.length>=1200)throw Error('本组展开超过1200个生产任务，请降低需求数量后计算。');
    const p=model.by.get(id),resource=String(p.buildingId),duration=Math.round(p.stepMinutes*scale);
    if(!Number.isSafeInteger(duration)||duration<=0)throw Error('生产时间超出精确计算范围。');
    positive(Number(capacities[resource]),p.buildingName+'并行容量');
    const i=tasks.length;tasks.push({id:i,productId:id,name:p.name,resource,duration,slot});
    for(const input of p.inputs)for(let j=0;j<input.quantity;j++)edges.push([add(input.id,slot),i]);
    return i;
  }
  items.forEach((item,slot)=>{const terminals=[];for(let i=0;i<item.quantity;i++)terminals.push(add(item.id,slot));roots.push(terminals);});
  const total=tasks.reduce((s,t)=>s+t.duration,0);if(!Number.isSafeInteger(total))throw Error('总工时超出精确计算范围。');
  return {tasks,edges,roots,scale};
}
function bounds(tasks,edges,caps){
  const n=tasks.length,ins=Array.from({length:n},()=>[]),outs=Array.from({length:n},()=>[]);
  for(const [a,b] of edges){ins[b].push(a);outs[a].push(b);}
  const degree=ins.map(v=>v.length),ready=[],starts=Array(n).fill(0),tails=Array(n).fill(0),order=[];
  degree.forEach((v,i)=>{if(!v)ready.push(i);});
  for(let pos=0;pos<ready.length;pos++){const i=ready[pos];order.push(i);for(const j of outs[i]){starts[j]=Math.max(starts[j],starts[i]+tasks[i].duration);if(!--degree[j])ready.push(j);}}
  if(order.length!==n)return null;
  for(const i of order.reverse())for(const j of outs[i])tails[i]=Math.max(tails[i],tasks[j].duration+tails[j]);
  let lower=Math.max(...tasks.map((t,i)=>starts[i]+t.duration));const resources=new Map();
  tasks.forEach((t,i)=>{if(!resources.has(t.resource))resources.set(t.resource,[]);resources.get(t.resource).push(i);});
  for(const [r,members] of resources){const cap=caps[r];if(members.length<=cap)continue;
    for(const release of new Set(members.map(i=>starts[i]))){const relevant=members.filter(i=>starts[i]>=release);
      for(const tail of new Set(relevant.map(i=>tails[i]))){const work=relevant.reduce((s,i)=>s+(tails[i]>=tail?tasks[i].duration:0),0);lower=Math.max(lower,release+Math.ceil(work/cap)+tail);}}
  }
  return {lower,starts,tails,ins,outs,resources};
}
function earliestSlot(release,duration,intervals,cap){
  const candidates=[...new Set([release,...intervals.filter(v=>v[1]>=release).map(v=>v[1])])].sort((a,b)=>a-b);
  for(const start of candidates){const end=start+duration,events=new Map();let active=0;
    for(const [l,r] of intervals){if(r<=start||l>=end)continue;if(l<=start)active++;else events.set(l,(events.get(l)||0)+1);if(r<end)events.set(r,(events.get(r)||0)-1);}
    if(active>=cap)continue;let valid=true;for(const [,delta] of [...events].sort((a,b)=>a[0]-b[0])){active+=delta;if(active>=cap){valid=false;break;}}
    if(valid)return start;
  }
  throw Error('无法安排生产任务。');
}
function feasible(tasks,b,caps){
  let best=null;
  for(let variant=0;variant<5;variant++){
    const degree=b.ins.map(v=>v.length),ready=new Set(),starts=Array(tasks.length).fill(0),ends=Array(tasks.length).fill(0),bookings={};degree.forEach((v,i)=>{if(!v)ready.add(i);});
    while(ready.size){let chosen,chosenStart,chosenPriority;
      for(const i of ready){const t=tasks[i],release=Math.max(0,...b.ins[i].map(j=>ends[j])),start=earliestSlot(release,t.duration,bookings[t.resource]||[],caps[t.resource]);
        const priorities=[[-b.tails[i]-t.duration,-t.duration,start,i],[start,-b.tails[i]-t.duration,-t.duration,i],[-t.duration,-b.tails[i],start,i],[t.duration,-b.tails[i],start,i],[start+t.duration,-b.tails[i],-t.duration,i]];
        if(chosen===undefined||compare(priorities[variant],chosenPriority)<0){chosen=i;chosenStart=start;chosenPriority=priorities[variant];}}
      ready.delete(chosen);const t=tasks[chosen];starts[chosen]=chosenStart;ends[chosen]=chosenStart+t.duration;(bookings[t.resource]??=[]).push([chosenStart,ends[chosen]]);
      for(const j of b.outs[chosen])if(!--degree[j])ready.add(j);
    }
    const span=Math.max(...ends);if(!best||span<best.span)best={span,starts};
  }
  return best;
}
function conflict(tasks,b,caps){
  let best=null;
  for(const [r,members] of b.resources){const cap=caps[r];if(members.length<=cap)continue;
    for(const time of [...new Set(members.map(i=>b.starts[i]))].sort((a,b)=>a-b)){
      const active=members.filter(i=>b.starts[i]<=time&&time<b.starts[i]+tasks[i].duration);
      if(active.length<=cap)continue;active.sort((i,j)=>b.tails[j]-b.tails[i]||tasks[j].duration-tasks[i].duration||i-j);
      const clique=active.slice(0,cap+1),priority=[cap,-Math.max(...clique.map(i=>b.tails[i])),time];
      if(!best||compare(priority,best.priority)<0)best={clique,priority};break;
    }
  }
  return best?.clique;
}
class Heap{
  a=[];
  push(v){const a=this.a;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].b.lower<=v.b.lower)break;a[i]=a[p];i=p;}a[i]=v;}
  pop(){const a=this.a,first=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].b.lower<a[j].b.lower)j++;if(a[j].b.lower>=v.b.lower)break;a[i]=a[j];i=j;}a[i]=v;}return first;}
}
export function validateRanchSchedule(tasks,edges,starts,capacities){
  if(starts.length!==tasks.length||starts.some(v=>!Number.isSafeInteger(v)||v<0))throw Error('排程开始时间不合法。');
  for(const [a,b] of edges)if(starts[a]+tasks[a].duration>starts[b])throw Error('排程违反原料先后关系。');
  const events={};tasks.forEach((t,i)=>{(events[t.resource]??=[]).push([starts[i],1],[starts[i]+t.duration,-1]);});
  for(const [r,list] of Object.entries(events)){let n=0;for(const [,delta] of list.sort((a,b)=>a[0]-b[0]||a[1]-b[1])){n+=delta;if(n>capacities[r])throw Error('排程超过建筑容量。');}}
  return true;
}
export function solveRanchGroup(model,group,level,capacities,{timeLimitMs=2000,nodeLimit=10000}={}){
  validateGroup(model,group,level);
  const result=solveProductionDemand(model,group.slots,level,capacities,{timeLimitMs,nodeLimit});result.assumptions.objective='all_four_slots_ready';return result;
}
export function solveProductionDemand(model,items,level,capacities,{timeLimitMs=2000,nodeLimit=10000}={}){
  const metrics=productionDemandMetrics(model,items,level),{tasks,edges,roots,scale}=expandProductionTasks(model,items,level,capacities),b=bounds(tasks,edges,capacities),heap=new Heap(),seen=new Set();
  const begin=performance.now();let best=feasible(tasks,b,capacities),nodes=0,truncatedLower=null;
  heap.push({edges,b});seen.add(edges.map(v=>v.join(':')).sort().join('|'));
  search:while(heap.a.length&&heap.a[0].b.lower<best.span){
    if(performance.now()-begin>=timeLimitMs||nodes>=nodeLimit)break;
    const current=heap.pop();nodes++;
    if(current.b.lower>=best.span)continue;
    const clique=conflict(tasks,current.b,capacities);
    if(!clique){const span=Math.max(...tasks.map((t,i)=>current.b.starts[i]+t.duration));if(span<best.span)best={span,starts:current.b.starts};continue;}
    for(let i=0;i<clique.length;i++)for(let j=i+1;j<clique.length;j++)for(const [a,c] of [[clique[i],clique[j]],[clique[j],clique[i]]]){
      // Never drop an incompletely expanded node's lower bound on timeout.
      if(performance.now()-begin>=timeLimitMs||seen.size>=50000){truncatedLower=current.b.lower;break search;}
      const next=[...current.edges,[a,c]],key=next.map(v=>v.join(':')).sort().join('|');if(seen.has(key))continue;seen.add(key);
      const child=bounds(tasks,next,capacities);if(child&&child.lower<best.span)heap.push({edges:next,b:child});
    }
  }
  const lower=Math.min(best.span,heap.a[0]?.b.lower??best.span,truncatedLower??best.span),proven=lower===best.span;
  validateRanchSchedule(tasks,edges,best.starts,capacities);
  return {...metrics,optimalMinutes:proven?best.span/scale:null,feasibleMinutes:best.span/scale,lowerMinutes:lower/scale,proven,nodes,elapsedMs:Math.round(performance.now()-begin),taskCount:tasks.length,
    slotCompletionMinutes:roots.map(ids=>Math.max(...ids.map(i=>best.starts[i]+tasks[i].duration))/scale),
    schedule:tasks.map((t,i)=>({...t,start:best.starts[i]/scale,end:(best.starts[i]+t.duration)/scale,duration:t.duration/scale})).sort((a,b)=>a.start-b.start||a.id-b.id),
    assumptions:{inventory:'empty',facilitiesAvailableAt:0,actionsMinutes:0,capacities:{...capacities},objective:'all_requested_items_ready',yield:1}};
}
