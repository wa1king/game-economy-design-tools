import assert from 'node:assert/strict';
import {prepareRanch,solveRanchGroup,validateRanchSchedule,expandRanchTasks} from '../orders/ranch-engine.js';
import {generateRanchLevelGroups,ranchPermutations,ranchDemandKey,remapRanchResult} from '../orders/ranch-catalog.js';
const product=(id,buildingId,inputs=[],level=1)=>({id,name:'P'+id,buildingId,buildingName:'B'+buildingId,level,isCrop:buildingId===0,stepMinutes:id,analysisBatchYield:1,coproducts:[],inputs:inputs.map(id=>({id,quantity:1})),coinValue:id});
const base={maxLevel:4,products:[product(1,0),product(2,1,[1]),product(3,1,[2]),product(4,1,[3]),product(5,1,[1],4)],sources:[{id:0,name:'农田',level:1,category:'田地'},{id:1,name:'工坊',level:1}],landsByLevel:{1:6,2:6,3:6,4:12}};
const model=prepareRanch(base);
let checks=0;
for(const level of [1,3,4])for(const allowRepeated of [false,true]){
  const catalog=generateRanchLevelGroups(model,level,{allowRepeated}),actual=catalog.groups.flatMap(g=>ranchPermutations(g).map(p=>p.slots.map(v=>v.id).join(','))),expected=[];
  const ids=base.products.filter(p=>p.level<=level).map(p=>p.id);
  for(const a of ids)for(const b of ids)for(const c of ids)for(const d of ids){const selected=[a,b,c,d],distinct=new Set(selected).size;

    if(catalog.families.some(f=>selected.every(id=>f.productIds.includes(id))&&(f.type==='building'||distinct>=2&&(allowRepeated||distinct===4)&&selected.includes(f.anchorId))))expected.push(selected.join(','));
  }
  assert.deepEqual(actual.sort(),expected.sort());assert.equal(new Set(actual).size,actual.length);assert.equal(catalog.permutationCount,expected.length);checks++;
}
const catalog=generateRanchLevelGroups(model,4,{allowRepeated:false});
assert(catalog.groups.some(g=>g.types.includes('building'))&&catalog.groups.some(g=>g.types.includes('chain')));
assert(catalog.groups.every(g=>g.slots.every(v=>model.by.get(v.id).level<=4)));checks++;
for(const g of catalog.groups){const source=solveRanchGroup(model,g,4,{0:12,1:1});
  for(const target of ranchPermutations(g)){
    assert.equal(ranchDemandKey(target),g.key);const remapped=remapRanchResult(source,g,target),expanded=expandRanchTasks(model,g,4,{0:12,1:1});
    const starts=Array(expanded.tasks.length);for(const t of remapped.schedule){starts[t.id]=Math.round(t.start*expanded.scale);assert.equal(target.slots[t.slot].id,g.slots[source.schedule.find(s=>s.id===t.id).slot].id);}
    assert(validateRanchSchedule(expanded.tasks,expanded.edges,starts,{0:12,1:1}));
    assert.equal(remapped.optimalMinutes,solveRanchGroup(model,target,4,{0:12,1:1}).optimalMinutes);
    for(let i=0;i<4;i++)assert.equal(remapped.slotCompletionMinutes[i],Math.max(...remapped.schedule.filter(t=>t.slot===i).map(t=>t.end)));
  }
}checks++;
const repeated=generateRanchLevelGroups(model,4,{allowRepeated:true});
assert(repeated.groups.some(g=>g.familyIds.length>1),'overlapping families must merge without losing membership');
for(const g of repeated.groups)assert.equal(ranchPermutations(g).length,new Set(ranchPermutations(g).map(v=>v.id)).size);checks++;
assert.throws(()=>generateRanchLevelGroups(model,4,{allowRepeated:true,limit:1}),/未截断/);assert.throws(()=>generateRanchLevelGroups(model,5),/等级/);checks++;
assert.equal(ranchPermutations({slots:[{id:1,quantity:1},{id:1,quantity:1},{id:2,quantity:1},{id:2,quantity:1}]}).length,6);checks++;
// Independent multiset counts include one-product workshops and AAAA.
for(let n=1;n<=5;n++){
  const one=prepareRanch({maxLevel:1,products:Array.from({length:n},(_,i)=>product(i+1,1)),sources:[{id:1,name:'B1',level:1}]});
  const rows=generateRanchLevelGroups(one,1,{allowRepeated:false}).groups;
  assert.equal(rows.length,n*(n+1)*(n+2)*(n+3)/24);
  assert.equal(rows.filter(g=>new Set(g.slots.map(v=>v.id)).size===1).length,n);
}checks++;
for(const [ids,count] of [[[1,1,1,1],1],[[1,1,1,2],4],[[1,1,2,2],6],[[1,1,2,3],12],[[1,2,3,4],24]]){
  assert.equal(ranchPermutations({slots:ids.map(id=>({id,quantity:1}))}).length,count);
}checks++;
// Identical products with different quantities must retain distinct animal slots.
{
  const g={slots:[{id:2,quantity:1},{id:2,quantity:2},{id:2,quantity:1},{id:2,quantity:3}]},caps={0:12,1:1},source=solveRanchGroup(model,g,4,caps);
  for(const target of ranchPermutations(g)){
    const r=remapRanchResult(source,g,target);
    for(let i=0;i<4;i++)assert.equal(r.schedule.filter(t=>t.slot===i&&t.productId===2).length,target.slots[i].quantity);
    assert.equal(r.optimalMinutes,source.optimalMinutes);
  }
}checks++;
console.log(checks+' exhaustive catalogue and joint-schedule reuse checks passed');
