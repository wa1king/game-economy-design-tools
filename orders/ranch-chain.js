import {groupMetrics} from './ranch-engine.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const colors=['#39866a','#a67b39','#647fac','#a46a80'];

export function ranchChainData(model,group,level){
  const metrics=groupMetrics(model,group,level),delivered=new Map(),membership=new Map();
  group.slots.forEach((v,i)=>{delivered.set(v.id,(delivered.get(v.id)||0)+v.quantity);for(const id of model.chains.get(v.id)){if(!membership.has(id))membership.set(id,[]);membership.get(id).push(i);}});
  const nodes=Object.entries(metrics.counts).filter(([,n])=>n>0).map(([id,count])=>{
    const p=model.by.get(Number(id));return {id:p.id,name:p.name,building:p.buildingName,depth:model.depths.get(p.id),count,delivered:delivered.get(p.id)||0,consumed:count-(delivered.get(p.id)||0),stepMinutes:p.stepMinutes,slots:membership.get(p.id)||[],deliverySlots:group.slots.flatMap((v,i)=>v.id===p.id?[i]:[])};
  }),edges=[];
  for(const p of nodes)for(const input of model.by.get(p.id).inputs)edges.push({from:input.id,to:p.id,quantity:p.count*input.quantity,perUnit:input.quantity});
  return {nodes,edges,metrics};
}
export function renderRanchChain(data,{compact=false}={}){
  const columns=new Map();for(const node of data.nodes){if(!columns.has(node.depth))columns.set(node.depth,[]);columns.get(node.depth).push(node);}
  const depths=[...columns.keys()].sort((a,b)=>a-b),nodeWidth=compact?136:195,nodeHeight=compact?70:108,colGap=compact?48:85,rowGap=compact?14:20,padding=compact?12:20;
  const rows=Math.max(1,...[...columns.values()].map(v=>v.length)),height=rows*(nodeHeight+rowGap)-rowGap+padding*2,width=Math.max(nodeWidth+padding*2,depths.length*(nodeWidth+colGap)-colGap+padding*2),positions=new Map();
  depths.forEach((depth,x)=>{const values=columns.get(depth).sort((a,b)=>Number(b.delivered>0)-Number(a.delivered>0)||(a.delivered&&b.delivered?a.deliverySlots[0]-b.deliverySlots[0]:a.id-b.id)),offset=(height-(values.length*(nodeHeight+rowGap)-rowGap))/2;values.forEach((n,i)=>positions.set(n.id,{x:padding+x*(nodeWidth+colGap),y:offset+i*(nodeHeight+rowGap)}));});
  const edges=data.edges.map(e=>{const a=positions.get(e.from),b=positions.get(e.to),x1=a.x+nodeWidth,y1=a.y+nodeHeight/2,x2=b.x,y2=b.y+nodeHeight/2,mid=(x1+x2)/2;return `<g><title>${esc(data.nodes.find(n=>n.id===e.from).name)} → ${esc(data.nodes.find(n=>n.id===e.to).name)}：共 ${number(e.quantity)} 个，每件需 ${number(e.perUnit)} 个</title><path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2-5},${y2}" fill="none" stroke="#b2c6b9" stroke-width="${compact?1.2:1.5}"/><path d="M${x2-7},${y2-3} L${x2-2},${y2} L${x2-7},${y2+3}" fill="none" stroke="#91ac9d"/>${compact?'':`<text x="${mid}" y="${(y1+y2)/2-5}" text-anchor="middle" fill="#718579" font-size="10" paint-order="stroke" stroke="#fff" stroke-width="4">×${number(e.quantity)}</text>`}</g>`;}).join('');
  const nodes=data.nodes.map(n=>{const {x,y}=positions.get(n.id),border=n.delivered?colors[n.deliverySlots[0]]:'#b6cbbb';
    return `<g><title>${esc(n.name)}：生产 ${number(n.count)}，交付 ${number(n.delivered)}，加工消耗 ${number(n.consumed)}</title><rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="7" fill="${n.delivered?'#edf5ef':'#fff'}" stroke="${border}" stroke-width="${n.delivered?2:1}"/><foreignObject x="${x+9}" y="${y+7}" width="${nodeWidth-18}" height="${nodeHeight-14}"><div xmlns="http://www.w3.org/1999/xhtml" class="chain-node ${compact?'compact':''}"><button type="button" class="order-item" data-product-id="${n.id}" aria-label="${esc(n.name)}，查看商品信息">${esc(n.name)}</button>${compact?`<span>共生产 ${number(n.count)} 个</span><span>交付 ${number(n.delivered)} · 加工 ${number(n.consumed)}</span>`:`<span>${esc(n.building)} · 单步 ${number(n.stepMinutes)}分</span><b>共生产 ${number(n.count)} 个</b><span class="chain-node-flow">交付 ${number(n.delivered)} · 加工消耗 ${number(n.consumed)}</span>`}</div></foreignObject>${n.delivered?`<rect x="${x+nodeWidth-7}" y="${y+8}" width="4" height="${nodeHeight-16}" rx="2" fill="${border}"/>`:''}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="width:${width}px;min-width:${compact?Math.min(width,450):width}px" role="img" aria-label="四单共同加工链，${data.nodes.length} 种商品"><g>${edges}${nodes}</g></svg>`;
}
