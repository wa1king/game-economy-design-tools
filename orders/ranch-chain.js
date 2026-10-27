import {groupMetrics} from './ranch-engine.js';
import {layoutRanchChain} from './ranch-chain-layout.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
// Production-chain template palette, assigned from the full building roster.
const palette=['#efd0ce','#fff6ad','#b5dce5','#e5e5e5','#b8e7b0','#dcaef0','#f4c2d2','#f5dba6','#ced7f4','#ccded6','#eed5c4','#d2e9bd','#e7c5df','#bce3d3','#dfd7b1','#d8dce0'];

export function ranchChainData(model,group,level){
  const metrics=groupMetrics(model,group,level),delivered=new Map(),membership=new Map();
  const buildings=[...model.base.sources].sort((a,b)=>(a.level??Infinity)-(b.level??Infinity)||a.id-b.id).map((b,i)=>({...b,name:b.name??model.base.products.find(p=>p.buildingId===b.id)?.buildingName??String(b.id),color:palette[i%palette.length]})),byBuilding=new Map(buildings.map(b=>[b.id,b])),tiers=new Map();
  function tier(id){
    if(tiers.has(id))return tiers.get(id);
    const p=model.by.get(id),b=byBuilding.get(p.buildingId),inputs=p.inputs.map(v=>tier(v.id));
    const role=p.sourceRole??b.sourceRole??(!p.inputs.length?'natural':null);
    if(role&&!['natural','feed','animal'].includes(role))throw Error('未知源头分类：'+role);
    if(role==='natural'&&inputs.length)throw Error('自然产物不能隐藏配方投入');
    const value={role,d:role?0:Math.max(0,...inputs.map(v=>v.d+1))};tiers.set(id,value);return value;
  }
  model.base.products.forEach(p=>tier(p.id));
  group.slots.forEach((v,i)=>{delivered.set(v.id,(delivered.get(v.id)||0)+v.quantity);for(const id of model.chains.get(v.id)){if(!membership.has(id))membership.set(id,[]);membership.get(id).push(i);}});
  const nodes=Object.entries(metrics.counts).filter(([,n])=>n>0).map(([id,count])=>{
    const p=model.by.get(Number(id)),b=byBuilding.get(p.buildingId),t=tiers.get(p.id);
    return {id:p.id,name:p.name,building:p.buildingName,buildingId:p.buildingId,buildingLevel:b.level??null,color:b.color,level:p.level,depth:model.depths.get(p.id),tier:t.d,sourceRole:t.role,count,delivered:delivered.get(p.id)||0,consumed:count-(delivered.get(p.id)||0),stepMinutes:p.stepMinutes,slots:membership.get(p.id)||[],deliverySlots:group.slots.flatMap((v,i)=>v.id===p.id?[i]:[])};
  }),edges=[];
  for(const p of nodes)for(const input of model.by.get(p.id).inputs)edges.push({from:input.id,to:p.id,quantity:p.count*input.quantity,perUnit:input.quantity});
  return {nodes,edges,metrics,buildings:buildings.filter(b=>nodes.some(n=>n.buildingId===b.id))};
}

function drawWires(segments){
  const hs=segments.filter(s=>s.h),vs=segments.filter(s=>!s.h),dots=new Map();
  let html=vs.map(v=>`<path data-material="${v.id}" d="M${v.f} ${v.a}V${v.b}"/>`).join('');
  for(const h of hs){
    const xs=vs.filter(v=>v.id!==h.id&&v.f>h.a+6&&v.f<h.b-6&&h.f>=v.a&&h.f<=v.b).map(v=>v.f);
    for(const v of vs)if(v.id===h.id&&v.f>=h.a&&v.f<=h.b&&h.f>=v.a&&h.f<=v.b&&((v.f>h.a&&v.f<h.b)||(h.f>v.a&&h.f<v.b)))dots.set(`${v.f},${h.f}`,{x:v.f,y:h.f});
    let path=`M${h.a} ${h.f}`;for(const x of [...new Set(xs)].sort((a,b)=>a-b))path+=`H${x-5}a5 5 0 0 1 10 0`;path+=`H${h.b}`;
    html+=`<path d="${path}" stroke="white" stroke-width="5"/><path data-material="${h.id}" d="${path}"/>`;
  }
  return `<g class="chain-wires" fill="none" stroke="#26313b" stroke-width="1.4">${html}${[...dots.values()].map(d=>`<circle class="chain-junction" cx="${d.x}" cy="${d.y}" r="2.7" fill="#26313b" stroke="none"/>`).join('')}</g>`;
}

export function renderRanchChain(data,{compact=false,overview=false}={}){
  const g=layoutRanchChain(data,{compact,overview}),scale=overview?1:compact?.75:.85;
  const bands=g.bands.map(b=>`<path d="M0 ${b.y}H${g.width}" stroke="#e0e5e9"/><text x="18" y="${b.y+30}" class="chain-level">Lv ${b.level}</text>${b.buildings.map((s,i)=>`<g><title>${esc(s.name)} · 建筑${b.level}级解锁</title><rect x="67" y="${b.y+14+i*29}" width="${g.left-82}" height="22" rx="2" fill="${s.color}" stroke="#a0a7ae"/><text x="75" y="${b.y+30+i*29}" class="chain-building"><tspan fill="#aa6c00">★ </tspan>${esc(s.name.length>10?s.name.slice(0,9)+"…":s.name)}</text></g>`).join('')}`).join('');
  const arrows=g.edges.map(e=>{const t=g.positions.get(e.to);return `<g><title>${esc(g.by.get(e.from).name)} → ${esc(g.by.get(e.to).name)}：每件需 ${number(e.perUnit)} 个；本组共 ${number(e.quantity)} 个</title><path d="M${t.x-7} ${e.ty-3}L${t.x-1} ${e.ty}L${t.x-7} ${e.ty+3}" fill="none" stroke="#26313b" stroke-width="1.4"/><text x="${t.x-11}" y="${e.ty-5}" class="chain-quantity" text-anchor="end">${number(e.perUnit)}</text></g>`;}).join('');
  const nodes=data.nodes.map(n=>{const {x,y}=g.positions.get(n.id),delivery=n.deliverySlots.map(i=>'ABCD'[i]).join(' / '),late=n.buildingLevel>n.level?` · 建筑 Lv ${n.buildingLevel}`:'';
    return `<g data-chain-product="${n.id}" data-building-id="${n.buildingId}"><title>${esc(n.name)} · ${esc(n.building)}：生产 ${number(n.count)}，交付 ${number(n.delivered)}，加工消耗 ${number(n.consumed)}</title><rect class="chain-node-box" x="${x}" y="${y}" width="${g.nodeWidth}" height="${g.nodeHeight}" rx="2" fill="${n.color}" stroke="#54616b" stroke-width="1.3"/><foreignObject x="${x+9}" y="${y+6}" width="${g.nodeWidth-18}" height="${g.nodeHeight-10}"><div xmlns="http://www.w3.org/1999/xhtml" class="chain-node ${compact||overview?'compact':''}"><button type="button" class="order-item" data-product-id="${n.id}" aria-label="${esc(n.name)}，查看商品配方">${esc(n.name)}</button><span title="${esc(n.building+late)}">${esc(n.building+(overview?` · Lv ${n.level}`:late))}</span><b>生产 ${number(n.count)}${delivery?` <small>交付 ${delivery}</small>`:''}</b></div></foreignObject><rect x="${x+g.nodeWidth-61}" y="${y+g.nodeHeight-8}" width="66" height="18" fill="#26313b"/><text x="${x+g.nodeWidth}" y="${y+g.nodeHeight+5}" text-anchor="end" class="chain-time">${number(n.stepMinutes)}分</text><text x="${x}" y="${y+g.nodeHeight+24}" class="chain-flow">交付 ${number(n.delivered)} · 加工消耗 ${number(n.consumed)}</text></g>`;
  }).join('');
  const columns=g.columns.map((label,i)=>`<span style="left:${g.columnX[i]}px;width:${g.nodeWidth}px">${esc(label)}</span>`).join('');
  return `<div class="ranch-chain-view" data-width="${g.width}" data-height="${g.height}" data-auto-fit="${overview}" data-scale="${scale}"><div class="chain-tools"><div class="chain-building-legend">${data.buildings.map(b=>`<span><i style="background:${b.color}"></i>${esc(b.name)}</span>`).join('')}</div><div class="chain-zoom"><button type="button" data-chain-zoom="out" aria-label="缩小加工链图">−</button><output>${Math.round(scale*100)}%</output><button type="button" data-chain-zoom="in" aria-label="放大加工链图">＋</button><button type="button" data-chain-zoom="fit">${overview?'适应图区':'适应宽度'}</button></div></div><div class="chain-frozen-header"><div class="chain-header-track" style="width:${g.width}px;transform:scale(${scale})">${overview?'':`<span style="left:0;width:${g.left-15}px">解锁等级 · 新建筑</span>`}${columns}</div></div><div class="chain-canvas" tabindex="0" aria-label="加工链图，可滚动查看"><div class="chain-sheet" style="width:${g.width*scale}px;height:${g.height*scale}px"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.width} ${g.height}" width="${g.width}" height="${g.height}" style="width:${g.width*scale}px;height:${g.height*scale}px" role="img" aria-label="四单共同加工链，按工坊配色，${data.nodes.length}种商品"><rect width="100%" height="100%" fill="white"/>${bands}<path d="M${g.divider} 0V${g.height}" stroke="#829e8a" stroke-dasharray="8 6"/>${drawWires(g.segments)}${arrows}${nodes}</svg></div></div></div>`;
}

export function setupRanchChains(root){
  for(const view of root.querySelectorAll('.ranch-chain-view')){
    if(view.dataset.bound)continue;view.dataset.bound='1';
    const canvas=view.querySelector('.chain-canvas'),sheet=view.querySelector('.chain-sheet'),svg=sheet.querySelector('svg'),header=view.querySelector('.chain-header-track'),out=view.querySelector('output');
    const sync=()=>{header.style.transform=`translateX(${(sheet.offsetLeft||0)-canvas.scrollLeft}px) scale(${view.dataset.scale})`;};
    canvas.addEventListener('scroll',sync,{passive:true});
    const fitScale=()=>Math.min((canvas.clientWidth-2)/Number(view.dataset.width),view.dataset.autoFit==='true'?(canvas.clientHeight-2)/Number(view.dataset.height):1.5,1.5);
    const applyScale=value=>{const old=Number(view.dataset.scale),scale=Math.max(.2,Math.min(1.5,value)),ratio=scale/old;view.dataset.scale=String(scale);sheet.style.width=Number(view.dataset.width)*scale+'px';sheet.style.height=Number(view.dataset.height)*scale+'px';svg.style.width=Number(view.dataset.width)*scale+'px';svg.style.height=Number(view.dataset.height)*scale+'px';out.value=Math.round(scale*100)+'%';canvas.scrollLeft*=ratio;canvas.scrollTop*=ratio;sync();};
    view.querySelector('.chain-zoom').addEventListener('click',event=>{const button=event.target.closest('[data-chain-zoom]');if(!button)return;
      const action=button.dataset.chainZoom;view.dataset.manualZoom=action==='fit'?'false':'true';applyScale(action==='fit'?fitScale():Number(view.dataset.scale)+(action==='in'?.1:-.1));
    });
    if(view.dataset.autoFit==='true'&&canvas.clientWidth>0&&canvas.clientHeight>0)applyScale(Math.min(1,fitScale()));else sync();
    if(view.dataset.autoFit==='true'&&typeof ResizeObserver!=='undefined'){
      const observer=new ResizeObserver(()=>{if(view.isConnected===false){observer.disconnect();return;}if(view.dataset.manualZoom!=='true'&&canvas.clientWidth>0&&canvas.clientHeight>0)applyScale(Math.min(1,fitScale()));});observer.observe(canvas);
    }

  }
}
