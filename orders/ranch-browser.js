// Navigation is a view over the exhaustive catalogue, never a second generator.
export function ranchBrowserScope(model,families,groups,{type='building',buildingId=null,familyId=null}={}){
  const used=new Set(groups.flatMap(g=>g.familyIds)),available=families.filter(f=>f.type===type&&used.has(f.id));
  const owner=f=>model.by.get(f.anchorId??f.productIds[0])?.buildingId;
  const owners=new Set(available.map(owner));
  const buildings=model.base.sources.filter(s=>owners.has(s.id)).sort((a,b)=>(a.level??Infinity)-(b.level??Infinity)||a.id-b.id);
  const building=buildings.find(b=>String(b.id)===String(buildingId))??buildings[0]??null;
  const products=available.filter(f=>owner(f)===building?.id).sort((a,b)=>{
    const x=model.by.get(a.anchorId??a.productIds[0]),y=model.by.get(b.anchorId??b.productIds[0]);return x.level-y.level||x.id-y.id;
  });
  const family=products.find(f=>f.id===familyId)??products[0]??null;
  return {buildings,building,families:products,family,groups:family?groups.filter(g=>g.familyIds.includes(family.id)):[]};
}

export function ranchSchemeStep(rows,currentId,delta){
  if(!rows.length)return null;
  const index=rows.findIndex(g=>g.id===currentId);
  return rows[Math.max(0,Math.min(rows.length-1,(index<0?0:index)+delta))];
}
