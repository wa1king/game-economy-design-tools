import {addOrderComplexity} from './order-complexity.js';
export const DEFAULT_RULES={cropQuantity:7,productQuantity:1,maxKinds:3,singleWindow:10};
export function validateProducts(base){
  const by=new Map(),names=new Set(),sources=new Map(base.sources.map(s=>[s.id,s]));
  for(const p of base.products){
    if(by.has(p.id)||names.has(p.name))throw Error(`商品重复：${p.name} / ${p.id}`);
    if(!Number.isInteger(p.level)||p.level<1||p.level>200||!Number.isFinite(p.stepMinutes)||p.stepMinutes<=0)throw Error(`${p.name} 的等级或时间无效。`);
    if(!sources.has(p.buildingId)||!Number.isInteger(p.analysisBatchYield)||p.analysisBatchYield<1)throw Error(`${p.name} 的建筑或产量无效。`);
    by.set(p.id,p);names.add(p.name);
  }
  const memo=new Map(),visiting=new Set();
  function depth(id){
    if(memo.has(id))return memo.get(id);if(visiting.has(id))throw Error(`配方循环：${by.get(id)?.name||id}`);
    const p=by.get(id);if(!p)throw Error(`配方中缺少商品 ${id}`);visiting.add(id);let d=0;const used=new Set();
    for(const input of p.inputs){const raw=by.get(input.id);if(!raw||input.id===id||used.has(input.id)||!Number.isInteger(input.quantity)||input.quantity<=0)throw Error(`${p.name} 的原料配置无效。`);if(raw.level>p.level)throw Error(`${p.name} 的原料 ${raw.name} 尚未解锁。`);used.add(input.id);d=Math.max(d,depth(input.id)+1);}
    visiting.delete(id);memo.set(id,d);return d;
  }
  for(const p of base.products)depth(p.id);return {by,depths:memo};
}
export function productionCalculator(base){
  const {by,depths}=validateProducts(base),sourceIndex=new Map(base.sources.map((s,i)=>[s.id,i]));
  const sequence=[...base.products].sort((a,b)=>depths.get(b.id)-depths.get(a.id)||(b.coproducts?.length||0)-(a.coproducts?.length||0)||a.id-b.id);
  return items=>{
    const demand=new Map(),spare=new Map(),work=base.sources.map(()=>0);
    for(const item of items)demand.set(item.id,(demand.get(item.id)||0)+item.quantity);
    for(const p of sequence){
      const requested=demand.get(p.id)||0,reused=Math.min(requested,spare.get(p.id)||0),needed=requested-reused;
      if(!needed)continue;
      const batches=Math.ceil(needed/p.analysisBatchYield);work[sourceIndex.get(p.buildingId)]+=batches*p.stepMinutes;
      for(const input of p.inputs)demand.set(input.id,(demand.get(input.id)||0)+batches*input.quantity);
      for(const output of p.coproducts||[])spare.set(output.id,(spare.get(output.id)||0)+batches*output.quantity);
    }
    return {cumulativeMinutes:work.reduce((s,v)=>s+v,0),sourceMinutes:work};
  };
}
export function buildCatalog(base,rules=DEFAULT_RULES){
  rules={...DEFAULT_RULES,...rules};
  for(const key of ['cropQuantity','productQuantity','singleWindow'])if(!Number.isInteger(rules[key])||rules[key]<1)throw Error('数量和单商品等级窗口必须为正整数。');
  if(![1,2,3].includes(rules.maxKinds))throw Error('订单最多支持 1～3 种商品。');
  if(base.products.length>80)throw Error('当前版本支持最多 80 种商品，请缩小导入范围。');
  const c={...base,products:base.products.map(p=>({...p,inputs:p.inputs.map(v=>({...v})),coproducts:(p.coproducts||[]).map(v=>({...v}))})),orders:[],rules};
  const calculate=productionCalculator(c),by=new Map(c.products.map(p=>[p.id,p]));
  for(const p of c.products){p.orderQuantity=(p.category==='田地作物'||p.category==='特殊作物'||p.isCrop)?rules.cropQuantity:rules.productQuantity;p.unitCumulativeMinutes=calculate([{id:p.id,quantity:1}]).cumulativeMinutes;p.soloOrderMinutes=calculate([{id:p.id,quantity:p.orderQuantity}]).cumulativeMinutes;}
  const compatible=(a,b)=>a.buildingId!==b.buildingId&&!a.inputs.some(v=>v.id===b.id)&&!b.inputs.some(v=>v.id===a.id);
  function add(products){
    const items=products.map(p=>({id:p.id,quantity:p.orderQuantity})),k=items.length;
    c.orders.push({id:`S${k}-${products.map(p=>p.id).join('-')}`,itemTypes:k,minimumLevel:Math.max(...products.map(p=>p.level)),maximumLevel:k===1?products[0].level+rules.singleWindow-1:null,items,description:products.map(p=>`${p.name}×${p.orderQuantity}`).join(' + '),...calculate(items)});
  }
  const ps=c.products;for(let i=0;i<ps.length;i++){add([ps[i]]);if(rules.maxKinds<2)continue;for(let j=i+1;j<ps.length;j++){if(!compatible(ps[i],ps[j]))continue;add([ps[i],ps[j]]);if(rules.maxKinds<3)continue;for(let k=j+1;k<ps.length;k++)if(compatible(ps[i],ps[k])&&compatible(ps[j],ps[k]))add([ps[i],ps[j],ps[k]]);}}
  c.maxLevel=base.maxLevel||Math.max(...ps.map(p=>p.level));
  c.assumptions=[...(base.assumptions||[]).filter(v=>!v.includes('未执行')&&!v.includes('尚未套用')),`多商品排除同直接生产建筑与直接上下游；间接上下游允许。单商品只保留最近 ${rules.singleWindow} 级。`];
  addOrderComplexity(c);return c;
}
export function availableAt(order,level){return order.minimumLevel<=level&&(order.maximumLevel==null||order.maximumLevel>=level);}
export function levelInfo(catalog,level){
  const orders=catalog.orders.filter(o=>availableAt(o,level)),counts=[0,0,0],active=catalog.sources.map(()=>false);
  for(const o of orders){counts[o.itemTypes-1]++;o.sourceMinutes.forEach((v,j)=>{if(v>0)active[j]=true;});}
  return {orders,counts,active,goods:catalog.products.filter(p=>p.level<=level).length};
}
export function normalizedSourceWeights(weights,active){
  const total=weights.reduce((s,v,j)=>s+(active[j]?v:0),0);
  return weights.map((v,j)=>active[j]&&total>0?v/total*100:0);
}
