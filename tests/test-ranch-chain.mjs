import assert from 'node:assert/strict';
import {prepareRanch} from '../orders/ranch-engine.js';
import {ranchChainData,renderRanchChain,setupRanchChains} from '../orders/ranch-chain.js';
import {layoutRanchChain} from '../orders/ranch-chain-layout.js';
const p=(id,buildingId,level,inputs=[],extra={})=>({id,name:'商品'+id,buildingId,buildingName:'建筑'+buildingId,level,isCrop:buildingId===0,stepMinutes:id+1,analysisBatchYield:1,inputs:inputs.map(([id,quantity])=>({id,quantity})),...extra});
const sources=[{id:20,name:'建筑20',level:4},{id:0,name:'建筑0',level:1},{id:10,name:'建筑10',level:2}];
const base={sources,maxLevel:20,products:[p(1,0,1),p(2,10,3,[[1,2]]),p(3,10,4,[[1,1]]),p(4,20,5,[[1,3],[2,1],[3,2]])]};
const group=ids=>({slots:ids.map(id=>({id,quantity:1}))});
const model=prepareRanch(base),d=ranchChainData(model,group([1,2,3,4]),20),before=JSON.stringify(base);
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}

function connected(g,source,target){
  const n=g.by.get(source),pos=g.positions.get(source),end=g.edges.find(e=>e.from===source&&e.to===target),targetPos=g.positions.get(target),ss=g.segments.filter(s=>s.id===source),start=[pos.x+g.nodeWidth,pos.y+g.nodeHeight*.73],finish=[targetPos.x,end.ty];
  const points=[start,finish];for(const s of ss){points.push(s.h?[s.a,s.f]:[s.f,s.a],s.h?[s.b,s.f]:[s.f,s.b]);for(const v of ss)if(s.h&&!v.h&&v.f>=s.a&&v.f<=s.b&&s.f>=v.a&&s.f<=v.b)points.push([v.f,s.f]);}
  const key=p=>p.join(','),graph=new Map();
  for(const s of ss){const on=points.filter(([x,y])=>s.h?y===s.f&&x>=s.a&&x<=s.b:x===s.f&&y>=s.a&&y<=s.b);for(const a of on)for(const b of on){if(!graph.has(key(a)))graph.set(key(a),new Set());graph.get(key(a)).add(key(b));}}
  const seen=new Set([key(start)]),q=[key(start)];for(let i=0;i<q.length;i++)for(const v of graph.get(q[i])||[])if(!seen.has(v)){seen.add(v);q.push(v);}assert(seen.has(key(finish)),`${n.name} route to ${target} disconnected`);
}
test('workshop colors follow full building unlock order, independent of deliveries/subsets',()=>{
  assert.deepEqual(d.buildings.map(b=>b.id),[0,10,20]);assert.equal(d.nodes.find(n=>n.id===2).color,d.nodes.find(n=>n.id===3).color);
  const reverse=ranchChainData(model,group([4,3,2,1]),20),subset=ranchChainData(model,group([3,3,3,3]),20);
  for(const n of reverse.nodes)assert.equal(n.color,d.nodes.find(v=>v.id===n.id).color);
  assert.equal(subset.nodes.find(n=>n.id===3).color,d.nodes.find(n=>n.id===3).color);assert.notEqual(d.nodes[0].color,d.nodes.at(-1).color);
});
test('unlock rows, real building stars and per-unit recipe arrows retain BOM totals',()=>{
  for(const compact of [false,true]){const g=layoutRanchChain(d,{compact});assert.deepEqual(g.bands.map(b=>b.level),[1,2,3,4,5]);assert(g.positions.get(2).y<g.positions.get(3).y);assert.equal(g.positions.get(2).x,g.positions.get(3).x);assert.equal(g.bands.find(b=>b.level===2).buildings[0].id,10);
    for(const e of d.edges)connected(g,e.from,e.to);
    assert.equal(g.edges.length,d.edges.length);assert(g.segments.filter(s=>s.id===1&&!s.h&&s.f<g.columnX[1]).length===1,'shared source must have a single primary trunk');
    const html=renderRanchChain(d,{compact});assert(html.includes('每件需 2 个；本组共 4 个'));assert(!html.includes('data-quantity='));assert(html.includes('chain-junction'));assert(html.includes('a5 5 0 0 1 10 0'),'unrelated crossings need bridges');
    assert(html.indexOf('chain-frozen-header')<html.indexOf('class="chain-canvas"'));assert(!html.includes('● A 交付'));
  }assert.equal(JSON.stringify(base),before);
});
test('feed and animals keep original recipe depth while sharing source tier',()=>{
  const m=prepareRanch({sources:[{id:0,level:1},{id:10,level:1,sourceRole:'feed'},{id:20,level:1,sourceRole:'animal'},{id:30,level:1}],products:[p(1,0,1),p(2,10,1,[[1,2]]),p(3,20,1,[[2,1]]),p(4,30,1,[[3,1]])]});
  const data=ranchChainData(m,group([1,2,3,4]),20),animal=data.nodes.find(n=>n.id===3),food=data.nodes.find(n=>n.id===4);assert.equal(animal.depth,2);assert.equal(animal.tier,0);assert.equal(food.depth,3);assert.equal(food.tier,1);const g=layoutRanchChain(data);assert.equal(g.columns.length,4);for(const e of data.edges)connected(g,e.from,e.to);
});
test('single source and missing building unlock do not invent levels or NaN',()=>{
  const m=prepareRanch({sources:[{id:0}],products:[p(1,0,8)]}),data=ranchChainData(m,group([1,1,1,1]),20),g=layoutRanchChain(data);assert.equal(g.bands.length,1);assert.equal(g.bands[0].buildings.length,0);assert(!/NaN|undefined/.test(renderRanchChain(data)));
});
test('frozen headers follow scrolling and all zoom controls; repeated setup is safe',()=>{
  const handlers={},canvas={scrollLeft:50,scrollTop:60,clientWidth:500,addEventListener:(type,fn)=>{handlers[type]=fn;}},svg={style:{}},header={style:{}},output={},sheet={style:{},querySelector:()=>svg},zoom={addEventListener:(type,fn)=>{handlers.zoom=fn;}};
  const parts={'.chain-canvas':canvas,'.chain-sheet':sheet,'.chain-header-track':header,output,'.chain-zoom':zoom};
  const view={dataset:{width:'1000',height:'2000',scale:'.85'},querySelector:k=>parts[k]},root={querySelectorAll:()=>[view]};
  setupRanchChains(root);assert.equal(header.style.transform,'translateX(-50px) scale(.85)');const listener=handlers.zoom;setupRanchChains(root);assert.equal(listener,handlers.zoom);
  function click(action){handlers.zoom({target:{closest:()=>({dataset:{chainZoom:action}})}});}
  click('in');assert(Math.abs(Number(view.dataset.scale)-.95)<1e-10);click('out');click('fit');assert.equal(Number(view.dataset.scale),.498);assert.equal(sheet.style.width,'498px');assert.equal(output.value,'50%');canvas.scrollLeft=27;handlers.scroll();assert.equal(header.style.transform,'translateX(-27px) scale(0.498)');
});
console.log(count+' ranch graph contract checks passed');
