import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRanch} from '../orders/ranch-engine.js';
import {quantityCandidates,quantityOptions,ranchQuantityProfile} from '../orders/ranch-quantity.js';
// Frozen enumeration reference from before the allocation-only optimization.
// Differential tests protect the candidate set, tie order, and fractional ranks.
const clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
const compare=(a,b)=>{for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]-b[i];}return 0;};
class ReferenceBank{
  values=[];
  constructor(size){this.size=size;}
  offer(q,score){const key=q.join(',');if(this.values.some(v=>v.key===key))return;const entry={key,q:[...q],score};if(this.values.length===this.size&&compare(score,this.values.at(-1).score)>=0)return;this.values.push(entry);this.values.sort((a,b)=>compare(a.score,b.score));if(this.values.length>this.size)this.values.pop();}
}
function values(max,initial){const set=new Set([1,max,clamp(initial,1,max)]);if(max<=24)for(let i=1;i<=max;i++)set.add(i);else for(let i=0;i<24;i++)set.add(1+Math.round((max-1)*i/23));return [...set].sort((a,b)=>a-b);}
function referenceCandidates(model,group,capacities,options,baseline){
  const profile=ranchQuantityProfile(model,group,capacities),max=group.slots.map(v=>model.by.get(v.id).isCrop?options.cropMax:options.productMax),initial=group.slots.map((v,i)=>clamp(v.quantity,1,max[i])),banks=[new ReferenceBank(16),new ReferenceBank(16),new ReferenceBank(16)],seeds=new Map(),seen=new Set();let considered=0,taskLimited=0;
  const minimum=profile.estimate([1,1,1,1]),maximum=profile.estimate(max);
  if(minimum.lowerMinutes>options.targetMinutes+options.toleranceMinutes)return {quantities:[[1,1,1,1]],considered:1,taskLimited:0,minWork:minimum.totalMinutes,maxWork:maximum.totalMinutes};
  const offset=baseline?.proven?Math.max(0,baseline.optimalMinutes-profile.estimate(group.slots.map(v=>v.quantity)).lowerMinutes):0;
  function offer(q,seed=false){q=q.map((v,i)=>clamp(Math.round(v),1,max[i]));considered++;const key=q.join(',');if(seen.has(key))return;seen.add(key);const e=profile.estimate(q);if(e.taskCount>1200){taskLimited++;return;}
    const predicted=e.lowerMinutes+offset,excess=Math.max(0,e.lowerMinutes-options.targetMinutes-options.toleranceMinutes),te=Math.abs(predicted-options.targetMinutes)/options.targetMinutes,we=Math.abs(e.totalMinutes-options.targetWorkMinutes)/options.targetWorkMinutes;
    banks[0].offer(q,[excess,te,we]);banks[1].offer(q,[excess,Math.max(0,te-options.toleranceMinutes/options.targetMinutes),we,te]);banks[2].offer(q,[excess,te+we,we]);if(seed)seeds.set(q.join(','),q);
  }
  offer(initial,true);offer([1,1,1,1],true);
  const baseTime=baseline?.proven?baseline.optimalMinutes:profile.estimate(initial).lowerMinutes;
  for(const scale of [.5,.75,1,1.25,1.5])offer(initial.map(q=>q*options.targetMinutes/Math.max(1,baseTime)*scale),true);
  offer(max,true);
  const pivot=profile.units.reduce((best,u,i)=>u.total>profile.units[best].total?i:best,0),axes=[0,1,2,3].filter(i=>i!==pivot),ranges=axes.map(i=>values(max[i],initial[i]));
  for(const a of ranges[0])for(const b of ranges[1])for(const c of ranges[2]){
    const q=[...initial];[a,b,c].forEach((v,i)=>q[axes[i]]=v);q[pivot]=0;const e=profile.estimate(q),candidates=new Set([1,max[pivot],initial[pivot],(options.targetWorkMinutes-e.totalMinutes)/profile.units[pivot].total]);
    for(const r of profile.resources){const w=profile.units[pivot].work[r]||0;if(w)for(const t of [options.targetMinutes-options.toleranceMinutes,options.targetMinutes,options.targetMinutes+options.toleranceMinutes])candidates.add(((t-offset)*capacities[r]-e.sourceMinutes[r])/w);}
    for(const v of candidates)for(const n of [Math.floor(v),Math.ceil(v)]){q[pivot]=n;offer(q);}
  }
  const selected=new Map();for(const q of seeds.values())selected.set(q.join(','),q);
  for(let i=0;i<16;i++)for(const bank of banks){const v=bank.values[i];if(v)selected.set(v.key,v.q);}
  const lists=[...selected.values()].slice(0,options.maxEvaluations);
  return {quantities:lists,considered,taskLimited,minWork:profile.estimate([1,1,1,1]).totalMinutes,maxWork:profile.estimate(max).totalMinutes};
}

const product=(id,buildingId,time,inputs=[])=>({id,name:'P'+id,buildingId,buildingName:'B'+buildingId,level:1,isCrop:buildingId===0,stepMinutes:time,analysisBatchYield:1,inputs:inputs.map(([id,quantity])=>({id,quantity}))});
const base={maxLevel:1,sources:[{id:0,name:'农田'},{id:1,name:'工坊'},{id:2,name:'窑炉'}],products:[product(1,0,0.1),product(2,0,1.25),product(3,1,2.3,[[1,3],[2,1]]),product(4,2,5.75,[[3,2],[2,2]]),product(5,1,7.125,[[1,1],[3,2]])]};
const model=prepareRanch(base),caps={0:7,1:2,2:1};
const cases=[
 {ids:[1,1,1,1],qs:[1,2,3,4],max:12},
 {ids:[3,3,3,3],qs:[4,1,2,1],max:12},
 {ids:[1,2,3,4],qs:[6,6,1,1],max:12},
 {ids:[4,3,2,1],qs:[1,2,3,4],max:24},
 {ids:[1,2,2,4],qs:[6,6,6,1],max:42},
 {ids:[3,4,4,5],qs:[1,3,1,2],max:25},
 {ids:[1,1,1,4],qs:[105,99,55,7],max:100},
 {ids:[5,4,3,1],qs:[1,2,3,4],max:12,target:10},
];
for(const [index,c] of cases.entries())if(new Set(c.ids).size===4)for(const useBaseline of [false,true])test(`candidate enumeration equals frozen reference: case ${index}, baseline ${useBaseline}`,()=>{
 const group={id:'sample',slots:c.ids.map((id,i)=>({id,quantity:c.qs[i]}))};
 const options=quantityOptions({targetMinutes:c.target??360,toleranceMinutes:c.target?1:30,targetWorkMinutes:1080,cropMax:c.max,productMax:c.max,maxEvaluations:index%3===0?1:index%3===1?42:200});
 const baseline=useBaseline?{proven:true,optimalMinutes:ranchQuantityProfile(model,group,caps).estimate(c.qs).lowerMinutes+7.3}:null;
 assert.deepEqual(quantityCandidates(model,group,caps,options,baseline),referenceCandidates(model,group,caps,options,baseline));
});
