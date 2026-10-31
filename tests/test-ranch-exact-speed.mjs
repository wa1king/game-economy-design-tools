import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRanch,solveProductionDemand} from '../orders/ranch-engine.js';

const product=(id,resource,time,inputs=[])=>({id,name:'P'+id,buildingId:resource,buildingName:'B'+resource,level:1,isCrop:resource===0,stepMinutes:time,analysisBatchYield:1,inputs:inputs.map(([id,quantity])=>({id,quantity}))});
const model=products=>prepareRanch({maxLevel:1,products,sources:[...new Set(products.map(p=>p.buildingId))].map(id=>({id,name:'B'+id,level:1}))});

// Independent, exhaustive time-indexed oracle. Enumerate every legal subset
// that can start at each integer tick, including idle choices. No bounds,
// dispatch priorities or production-engine expansion are used for expectations.
function exhaustiveMinutes(products,items,caps,scale=1){
  const tasks=[],by=new Map(products.map(p=>[p.id,p]));
  function expand(id){const p=by.get(id),parents=[];for(const input of p.inputs)for(let n=0;n<input.quantity;n++)parents.push(expand(input.id));
    const index=tasks.length;tasks.push({resource:p.buildingId,duration:Math.round(p.stepMinutes*scale),parents});return index;
  }
  for(const item of items)for(let n=0;n<item.quantity;n++)expand(item.id);
  assert(tasks.length<=10,'keep the exhaustive oracle small');
  const initial=tasks.map(()=>-1),seen=new Set([initial.join(',')]);let frontier=[initial];
  for(let time=0;frontier.length;time++){
    const next=[];
    for(const state of frontier){if(state.every(v=>v===0))return time/scale;
      const used={},ready=[];for(let i=0;i<tasks.length;i++){
        if(state[i]>0)used[tasks[i].resource]=(used[tasks[i].resource]||0)+1;
        else if(state[i]===-1&&tasks[i].parents.every(p=>state[p]===0))ready.push(i);
      }
      const choice=[...state];
      function subsets(at){
        if(at===ready.length){const step=choice.map(v=>v>0?v-1:v),key=step.join(',');if(!seen.has(key)){seen.add(key);next.push(step);}return;}
        const i=ready[at],r=tasks[i].resource;subsets(at+1);
        if((used[r]||0)<caps[r]){used[r]=(used[r]||0)+1;choice[i]=tasks[i].duration;subsets(at+1);choice[i]=-1;used[r]--;}
      }
      subsets(0);
    }
    frontier=next;
  }
  throw Error('oracle found no schedule');
}

// Independently check returned intervals, every required input edge and the
// delivery counts. The engine returns parents before/after IDs according to its
// own expansion order, so reconstruct only the required tree IDs here.
function checkCertificate(products,items,caps,result){
  const by=new Map(products.map(p=>[p.id,p])),rows=new Map(result.schedule.map(t=>[t.id,t])),parents=[];let nextId=0;
  function expand(id){const index=nextId++,p=by.get(id),row=rows.get(index);assert.equal(row.productId,id);assert.equal(row.duration,p.stepMinutes);assert(row.start>=0);assert.equal(row.end-row.start,p.stepMinutes);
    for(const input of p.inputs)for(let n=0;n<input.quantity;n++){const child=expand(input.id);parents.push([child,index]);}return index;
  }
  for(const item of items)for(let n=0;n<item.quantity;n++)expand(item.id);
  assert.equal(nextId,rows.size);for(const [a,b] of parents)assert(rows.get(a).end<=rows.get(b).start);
  for(const r of Object.keys(caps)){const tasks=result.schedule.filter(t=>String(t.resource)===r),times=[...new Set(tasks.flatMap(t=>[t.start,t.end]))];
    for(const time of times)assert(tasks.filter(t=>t.start<=time&&time<t.end).length<=caps[r]);
  }
  assert.equal(Math.max(...result.schedule.map(t=>t.end)),result.feasibleMinutes);
}

test('indivisible equal-length work certifies the full last batch without search',()=>{
  const products=[product(1,0,2)],items=[{id:1,quantity:4}],m=model(products),result=solveProductionDemand(m,items,1,{0:3},{timeLimitMs:0,nodeLimit:0});
  assert.equal(exhaustiveMinutes(products,items,{0:3}),4);
  assert.equal(result.optimalMinutes,4);assert.equal(result.lowerMinutes,4);assert.equal(result.nodes,0);
  checkCertificate(products,items,{0:3},result);
});

test('precedence-only feasible schedules need no dispatch or branching search',()=>{
  const products=[product(1,0,.5),product(2,1,1.5,[[1,1]])],items=[{id:2,quantity:4}],caps={0:4,1:4},result=solveProductionDemand(model(products),items,1,caps,{timeLimitMs:0,nodeLimit:0});
  assert.equal(exhaustiveMinutes(products,items,caps,2),2);assert.equal(result.optimalMinutes,2);assert.equal(result.nodes,0);
  checkCertificate(products,items,caps,result);
});

test('stronger resource bounds and returned schedules agree with an independent exhaustive oracle',()=>{
  const fixtures=[
    {products:[product(1,0,1),product(2,0,3),product(3,0,4)],items:[{id:1,quantity:2},{id:2,quantity:1},{id:3,quantity:1}],caps:{0:2}},
    {products:[product(1,0,2),product(2,1,3,[[1,1]])],items:[{id:2,quantity:4}],caps:{0:2,1:2}},
    {products:[product(1,0,1),product(2,1,2),product(3,2,2,[[1,1],[2,1]])],items:[{id:3,quantity:2},{id:1,quantity:1}],caps:{0:2,1:1,2:1}},
    {products:[product(1,0,.5),product(2,1,1.5,[[1,1]])],items:[{id:2,quantity:3},{id:1,quantity:1}],caps:{0:2,1:2},scale:2},
    {products:[product(1,0,1),product(2,0,2,[[1,1]]),product(3,1,3,[[2,1]])],items:[{id:3,quantity:2},{id:1,quantity:1}],caps:{0:2,1:1}},
    {products:[product(1,0,2),product(2,2,4,[[1,1]]),product(3,2,2,[[2,1]]),product(4,1,2,[[2,1]]),product(5,0,3,[[3,1]])],items:[{id:1,quantity:1},{id:2,quantity:2},{id:5,quantity:1}],caps:{0:1,1:2,2:2}},
  ];
  let seed=337;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let i=0;i<24;i++){
    const products=[product(1,0,1+random(3)),product(2,1,1+random(3),[[1,1]]),product(3,random(2),1+random(3))];
    fixtures.push({products,items:[{id:2,quantity:1+random(2)},{id:1,quantity:1},{id:3,quantity:1+random(2)}],caps:{0:1+random(3),1:1+random(2)}});
  }
  for(const [index,f] of fixtures.entries()){
    const expected=exhaustiveMinutes(f.products,f.items,f.caps,f.scale||1),m=model(f.products);
    for(const timeLimitMs of [0,5000]){
      const result=solveProductionDemand(m,f.items,1,f.caps,{timeLimitMs,nodeLimit:50000});
      assert(result.lowerMinutes<=expected,`fixture ${index}: invalid lower bound ${result.lowerMinutes}>${expected}`);
      assert(result.feasibleMinutes>=expected,`fixture ${index}: invalid schedule upper bound`);
      if(result.proven||timeLimitMs)assert.equal(result.optimalMinutes,expected,`fixture ${index}: incorrect optimum`);
      else assert.equal(result.optimalMinutes,null);
      checkCertificate(f.products,f.items,f.caps,result);
    }
  }
});
