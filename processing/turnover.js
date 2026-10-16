(function(root){
 'use strict';
 const LEVELS=20,DEFAULT_WAIT=2;
 function settings(design,source=design.turnover){
  if(source!==undefined&&(!source||typeof source!=='object'||Array.isArray(source)))throw Error('队列设置格式不正确');
  const includeActive=source?.includeActive??true;
  if(typeof includeActive!=='boolean')throw Error('是否计入在产位须为布尔值');
  const supplied=source?.queues??{};
  if(!supplied||typeof supplied!=='object'||Array.isArray(supplied))throw Error('各建筑队列设置格式不正确');
  const queues={};
  for(const b of design.buildings){
   const values=supplied[b.id]??Array(LEVELS).fill(DEFAULT_WAIT);
   if(!Array.isArray(values)||values.length!==LEVELS||values.some(n=>!Number.isSafeInteger(n)||n<0))throw Error(b.name+'：队列等待长度须为20级的非负整数');
   queues[b.id]=values.slice();
  }
  return{version:1,includeActive,queues};
 }
 function setQueue(design,bid,level,value){
  const b=design.buildings.find(b=>b.id===Number(bid));
  if(!b||!Number.isInteger(level)||level<b.level||level>LEVELS||!Number.isSafeInteger(value)||value<0)throw Error('请填写已解锁等级的非负整数队列长度');
  const next=settings(design);for(let lv=level;lv<=LEVELS;lv++)next.queues[b.id][lv-1]=value;
  design.turnover=next;return next;
 }
 function rows(design){
  const config=settings(design),byId=new Map(design.products.map(p=>[p.id,p])),byBuilding=new Map(design.buildings.map(b=>[b.id,b]));
  const safe=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('周转容量超过可精确计算的整数范围');return n};
  return Array.from({length:LEVELS},(_,i)=>{
   const level=i+1,memo=new Map(),visiting=new Set();
   function usable(p){
    if(!p||p.level>level)return false;
    if(memo.has(p.id))return memo.get(p.id);
    if(visiting.has(p.id))return false;
    visiting.add(p.id);
    const b=byBuilding.get(p.building);
    const valid=p.building?!!b&&b.level<=p.level&&p.inputs.length>0&&p.inputs.every(([id,q])=>id!==p.id&&Number.isSafeInteger(q)&&q>0&&byId.get(id)?.level<=p.level&&usable(byId.get(id))):p.inputs.length===0;
    visiting.delete(p.id);memo.set(p.id,valid);return valid;
   }
   const capacities=new Map(),details=new Map(),queues=new Map(),invalid=[];let total=0;
   for(const p of design.products)capacities.set(p.id,p.level<=level?0:null);
   for(const b of design.buildings){
    const wait=config.queues[b.id][i];queues.set(b.id,b.level<=level?wait:null);
    if(b.level>level)continue;
    const slots=safe(wait+(config.includeActive?1:0));
    const recipes=design.products.filter(p=>p.building===b.id&&p.level<=level),maxima=new Map();let maximumAll=0;
    for(const p of recipes){
     if(!usable(p)){invalid.push(p.id);continue}
     maximumAll=Math.max(maximumAll,safe(p.inputs.reduce((n,[id,q])=>safe(n+q),0)));
     for(const [id,q]of p.inputs){const old=maxima.get(id);if(!old||q>old.quantity)maxima.set(id,{quantity:q,products:[p.id]});else if(q===old.quantity)old.products.push(p.id)}
    }
    total=safe(total+safe(slots*maximumAll));
    for(const [id,value]of maxima){
     const amount=safe(slots*value.quantity);capacities.set(id,safe(capacities.get(id)+amount));
     if(!details.has(id))details.set(id,[]);
     details.get(id).push({building:b.id,wait,slots,quantity:value.quantity,amount,products:value.products});
    }
   }
   // Each SKU maximum may require a different recipe; total is computed separately.
   return{level,capacities,details,queues,total,invalid,complete:invalid.length===0};
  });
 }
 const api={settings,setQueue,rows,DEFAULT_WAIT};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.ChainTurnover=api;
})(typeof globalThis!=='undefined'?globalThis:this);
