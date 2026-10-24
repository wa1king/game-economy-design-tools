// Adapted from artifact-template-excel-production-chain/scripts/build_viewer.mjs.
// Layout only: BOM, quantities and scheduling remain in ranch-engine.js.
export function layoutRanchChain(data,{compact=false}={}){
  const nodeWidth=compact?156:186,nodeHeight=compact?60:68,left=compact?196:224,by=new Map(data.nodes.map(n=>[n.id,n]));
  const sourceColumns=data.nodes.some(n=>n.sourceRole==='feed'||n.sourceRole==='animal')?3:1;
  const column=n=>n.tier?n.tier+sourceColumns-1:n.sourceRole==='feed'?1:n.sourceRole==='animal'?2:0;
  const maxColumn=Math.max(sourceColumns-1,...data.nodes.map(column)),columns=[...(sourceColumns===3?['种植 / 采集','饲料配套','动物产出']:['种植 / 采集']),...Array.from({length:maxColumn-sourceColumns+1},(_,i)=>`第${i+1}级加工`)];
  const edges=data.edges.map(e=>({...e,s:by.get(e.from),t:by.get(e.to)}));
  if(edges.some(e=>column(e.s)>=column(e.t)))throw Error('源头分类含反向配方，需补充回折布局；原配方未删除。');
  const gapLists=Array.from({length:maxColumn},(_,g)=>[...new Set(edges.filter(e=>column(e.s)===g||column(e.t)-1===g).map(e=>e.from))].sort((a,b)=>a-b));
  const spacing=gapLists.map((_,g)=>g<sourceColumns?12:16),columnX=[left];
  for(let i=0;i<gapLists.length;i++)columnX.push(columnX.at(-1)+Math.max(nodeWidth+(compact?95:120),nodeWidth+70+gapLists[i].length*spacing[i]));
  const width=columnX[maxColumn]+nodeWidth+30,positions=new Map(),bands=[];
  const levels=[...new Set([...data.nodes.map(n=>n.level),...data.buildings.map(b=>b.level).filter(Number.isFinite)])].sort((a,b)=>a-b);
  let cursor=0;
  for(const level of levels){
    const nodes=data.nodes.filter(n=>n.level===level),buildings=data.buildings.filter(b=>b.level===level),skips=edges.filter(e=>e.t.level===level&&column(e.t)-column(e.s)>1),corridor=Math.max(22,skips.length*12+15),slots=Math.max(1,...columns.map((_,d)=>nodes.filter(n=>column(n)===d).length));
    const height=Math.max(corridor+slots*(nodeHeight+48)+16,buildings.length*29+28);
    bands.push({level,y:cursor,height,buildings,skips});
    for(let d=0;d<columns.length;d++)nodes.filter(n=>column(n)===d).sort((a,b)=>a.id-b.id).forEach((n,i)=>positions.set(n.id,{x:columnX[d],y:cursor+corridor+14+i*(nodeHeight+48)}));
    cursor+=height;
  }
  const lane=(id,g)=>columnX[g]+nodeWidth+32+gapLists[g].indexOf(id)*spacing[g],raw=[];
  function segment(id,x1,y1,x2,y2){if(x1===x2&&y1===y2)return;raw.push({id,h:y1===y2,f:y1===y2?y1:x1,a:y1===y2?Math.min(x1,x2):Math.min(y1,y2),b:y1===y2?Math.max(x1,x2):Math.max(y1,y2)});}
  for(const p of data.nodes){
    const out=edges.filter(e=>e.from===p.id);if(!out.length)continue;
    const pos=positions.get(p.id),sy=pos.y+nodeHeight*.73,px=lane(p.id,column(p)),primary=[sy];segment(p.id,pos.x+nodeWidth,sy,px,sy);
    for(const d of [...new Set(out.map(e=>column(e.t)))]){
      const group=out.filter(e=>column(e.t)===d),ys=group.map(e=>{const ins=edges.filter(v=>v.to===e.to).sort((a,b)=>a.from-b.from);return positions.get(e.to).y+nodeHeight*(ins.findIndex(v=>v.from===e.from)+1)/(ins.length+1);}),bx=lane(p.id,d-1);
      if(d===column(p)+1)primary.push(...ys);
      else{const first=[...group].sort((a,b)=>a.t.level-b.t.level||a.to-b.to)[0],band=bands.find(b=>b.level===first.t.level),ry=band.y+10+band.skips.indexOf(first)*12;primary.push(ry);segment(p.id,px,ry,bx,ry);segment(p.id,bx,Math.min(ry,...ys),bx,Math.max(ry,...ys));}
      group.forEach((e,i)=>{e.ty=ys[i];segment(p.id,bx,ys[i],positions.get(e.to).x,ys[i]);});
    }
    segment(p.id,px,Math.min(...primary),px,Math.max(...primary));
  }
  const groups=new Map(),segments=[];
  for(const s of raw){const key=`${s.id}:${s.h}:${s.f}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
  for(const values of groups.values()){values.sort((a,b)=>a.a-b.a);let last;for(const s of values){if(last&&s.a<=last.b)last.b=Math.max(last.b,s.b);else{last={...s};segments.push(last);}}}
  for(const s of segments)for(const p of positions.values())if(s.h?s.f>p.y&&s.f<p.y+nodeHeight&&s.b>p.x&&s.a<p.x+nodeWidth:s.f>p.x&&s.f<p.x+nodeWidth&&s.b>p.y&&s.a<p.y+nodeHeight)throw Error('加工链线穿过商品框，请调整线道间距');
  for(let i=0;i<segments.length;i++)for(const b of segments.slice(i+1)){const a=segments[i];if(a.id!==b.id&&a.h===b.h&&a.f===b.f&&Math.min(a.b,b.b)>Math.max(a.a,b.a))throw Error('无关配方线重合，请调整线道间距');}
  return {positions,segments,bands,edges,columns,columnX,nodeWidth,nodeHeight,left,width,height:Math.max(100,cursor),divider:columnX[sourceColumns-1]+nodeWidth+16,by};
}
