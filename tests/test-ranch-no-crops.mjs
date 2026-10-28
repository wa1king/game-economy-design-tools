import assert from 'node:assert/strict';
import {prepareRanch,ranchFamilies,generateRanchGroups,groupMetrics} from '../orders/ranch-engine.js';
import {generateRanchLevelGroups} from '../orders/ranch-catalog.js';
import {ranchChainData} from '../orders/ranch-chain.js';
import {buildRanchDistributionPlans,ranchDistributionRows} from '../orders/ranch-distribution.js';
const p=(id,b,inputs=[],level=1,extra={})=>({id,name:'P'+id,buildingId:b,buildingName:'B'+b,level,isCrop:b===0,stepMinutes:1,analysisBatchYield:1,coproducts:[],inputs:inputs.map(id=>({id,quantity:1})),coinValue:1,...extra});
const base={maxLevel:3,sources:[{id:0,name:'农田',level:1},{id:10,name:'磨坊',level:2},{id:20,name:'厨房',level:3}],landsByLevel:{1:6,2:12,3:18},products:[p(1,0),p(2,0),p(3,10,[1],2),p(4,20,[2,3],3)]},model=prepareRanch(base),before=JSON.stringify(base);
assert.equal(ranchFamilies(model,1,'building').length,0);
for(const allowRepeated of [false,true])for(let level=1;level<=3;level++){
  const catalog=generateRanchLevelGroups(model,level,{allowRepeated});
  assert(catalog.families.filter(f=>f.type==='building').every(f=>f.productIds.every(id=>id>2)));
  assert(catalog.groups.filter(g=>g.types.includes('building')).every(g=>g.slots.every(v=>v.id>2)));
}
const family=ranchFamilies(model,3,'building').find(f=>f.id==='b10'),groups=generateRanchGroups(model,family,{allowRepeated:false});
assert.equal(groups.length,1);assert(groups[0].slots.every(v=>v.id===3));
assert.equal(groupMetrics(model,groups[0],3).counts[1],4,'crop ingredients must still be produced');
assert(ranchChainData(model,groups[0],3).nodes.some(n=>n.id===1),'ingredient crops must remain visible in the chain graph');
assert.equal(generateRanchGroups(model,{anchorId:null,productIds:[1,2]}).length,0,'legacy/manual crop-only families cannot bypass the rule');
assert(generateRanchGroups(model,{anchorId:null,productIds:[1,2,3]}).every(g=>g.slots.every(v=>v.id===3)));
const chain=ranchFamilies(model,3,'chain').find(f=>f.anchorId===4),chains=generateRanchGroups(model,chain,{allowRepeated:false});
assert.equal(chains.length,1);assert(chains[0].slots.some(v=>v.id===1)&&chains[0].slots.some(v=>v.id===2),'advanced chains retain their original crop delivery policy');
for(const source of [{id:11,name:'农田'},{id:12,name:'田地'},{id:13,name:'种植区',category:'田地'}]){
  const m=prepareRanch({maxLevel:1,sources:[source],products:[p(1,source.id),p(2,source.id)]});assert.equal(ranchFamilies(m,1,'building').length,0);
}
const mixed=prepareRanch({maxLevel:1,sources:[{id:10,name:'工坊',level:1}],products:[p(1,10,[],1,{isCrop:true}),p(2,10,[],1,{category:'特殊作物'}),p(3,10,[],1,{category:'田地作物'}),p(4,10,[],1,{sourceCategory:'田地'}),p(5,10)]});
assert.deepEqual(ranchFamilies(mixed,1,'building')[0].productIds,[5],'every crop marking is excluded even within a mixed source');
const plans=buildRanchDistributionPlans(base);
for(const plan of plans)plan.results.set('removed-crop-only-key',{proven:true,optimalMinutes:9999});
const rows=ranchDistributionRows(plans,'building');assert.deepEqual(rows.map(r=>r.total),[0,1,2]);assert(rows.every(r=>r.optimized.n===0),'orphaned crop cache entries cannot enter distribution statistics');
assert.equal(JSON.stringify(base),before);
console.log('Ranch building groups: all crop classifications excluded, repeated non-crops retained, early empty levels, chain ingredients/deliveries and cached statistics verified.');
