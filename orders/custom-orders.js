import {availableAt} from './order-engine.js';
export function normalizeCustomOrders(value,maxLevel=200){
  if(value==null)return {version:1,levels:{}};
  if(value.version!==1||!value.levels||typeof value.levels!=='object'||Array.isArray(value.levels))throw Error('定制订单配置格式无效。');
  const levels={};
  for(const [key,ids] of Object.entries(value.levels)){
    const level=Number(key);
    if(!Number.isInteger(level)||String(level)!==key||level<1||level>maxLevel||!Array.isArray(ids)||ids.length>100000||ids.some(id=>typeof id!=='string'||!id.length||id.length>256))throw Error('定制订单等级或任务编号无效。');
    if(ids.length)levels[key]=[...new Set(ids)];
  }
  return {version:1,levels};
}
export function customOrdersAt(catalog,selection,level,byId){
  const ids=selection?.levels?.[level]??[];if(!ids.length)return [];
  byId??=new Map(catalog.orders.map(o=>[o.id,o]));
  return ids.map((id,index)=>{
    const order=byId.get(id);return {id,sequence:index+1,order:order&&availableAt(order,level)?order:null};
  });
}
export function editCustomOrders(selection,catalog,level,action,ids=[]){
  if(!Number.isInteger(level)||level<1||level>catalog.maxLevel)throw Error('请选择有效等级。');
  const next=normalizeCustomOrders(selection,catalog.maxLevel),current=next.levels[level]??[];
  if(action==='add'){
    const byId=new Map(catalog.orders.map(o=>[o.id,o]));
    if(ids.some(id=>!byId.has(id)||!availableAt(byId.get(id),level)))throw Error('部分订单不在当前等级的候选库中，请重新选择。');
    next.levels[level]=[...new Set([...current,...ids])];
  }else if(action==='remove')next.levels[level]=current.filter(id=>!ids.includes(id));
  else if(action==='clear')delete next.levels[level];
  else if(action==='up'||action==='down'){
    const index=current.indexOf(ids[0]),target=index+(action==='up'?-1:1);
    if(index>=0&&target>=0&&target<current.length)[current[index],current[target]]=[current[target],current[index]];
    next.levels[level]=current;
  }else throw Error('未知的定制订单操作。');
  return normalizeCustomOrders(next,catalog.maxLevel);
}
export function filterCustomLibrary(orders,products,query={},selected=new Set()){
  const text=String(query.search??'').trim().toLocaleLowerCase();
  const bounded=(n,min,max)=>(min==null||min===''||n>=Number(min))&&(max==null||max===''||n<=Number(max));
  const filtered=orders.filter(o=>(!text||(o.id+' '+o.description).toLocaleLowerCase().includes(text))&&
    (!query.kinds||o.itemTypes===Number(query.kinds))&&
    (query.source==null||query.source===''||o.items.some(i=>String(products.get(i.id)?.buildingId)===String(query.source)))&&
    (query.selected!=='yes'||selected.has(o.id))&&(query.selected!=='no'||!selected.has(o.id))&&
    bounded(o.cumulativeMinutes,query.minTime,query.maxTime)&&bounded(o.cumulativeComplexity,query.minComplexity,query.maxComplexity));
  const key=query.sort??'id',sign=query.direction==='desc'?-1:1;
  return filtered.sort((a,b)=>{
    if(key==='id')return sign*a.id.localeCompare(b.id,undefined,{numeric:true});
    const av=a[key],bv=b[key];
    if(av==null||bv==null)return av==null?(bv==null?a.id.localeCompare(b.id):1):-1;
    return sign*(av-bv)||a.id.localeCompare(b.id,undefined,{numeric:true});
  });
}
export function customOrderOverview(catalog,selection){
  const byId=new Map(catalog.orders.map(o=>[o.id,o]));
  return Array.from({length:catalog.maxLevel},(_,i)=>{
    const level=i+1,entries=customOrdersAt(catalog,selection,level,byId),orders=entries.flatMap(e=>e.order?[e.order]:[]);
    const mean=key=>orders.length?orders.reduce((sum,o)=>sum+o[key],0)/orders.length:null;
    return {level,count:entries.length,valid:orders.length,invalid:entries.length-orders.length,kinds:[1,2,3].map(n=>orders.filter(o=>o.itemTypes===n).length),meanMinutes:mean('cumulativeMinutes'),meanComplexity:mean('cumulativeComplexity')};
  });
}
