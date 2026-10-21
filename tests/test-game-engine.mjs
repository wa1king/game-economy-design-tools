import assert from 'node:assert/strict';
import {buildCatalog} from '../orders/order-engine.js';
import {createGame,advanceGame,skipGameTime,enqueueProduction,cancelProduction,deliverGameOrder,refreshGameOrder,updateGameSettings,gameView,validateGameSave,gameSignature,upgradeWarehouse,upgradeBuilding,discardInventory,plantPlot,harvestPlot,harvestAll,harvestProduction,claimBuildingProducts,orderReward} from '../orders/game-engine.js';

const minute=60000;
const catalog=buildCatalog({maxLevel:3,landsByLevel:{1:6,2:6,3:30},sources:[{id:0,name:'农田'},{id:10,name:'石磨'},{id:20,name:'饼坊'}],products:[
  {id:1,name:'小麦',level:1,buildingId:0,category:'田地作物',isCrop:true,stepMinutes:2,analysisBatchYield:1,inputs:[]},
  {id:2,name:'大豆',level:1,buildingId:0,category:'特殊作物',stepMinutes:5,analysisBatchYield:1,inputs:[]},
  {id:3,name:'面粉',level:1,buildingId:10,category:'加工品',stepMinutes:3,analysisBatchYield:1,inputs:[{id:1,quantity:2}]},
  {id:4,name:'豆粉',level:2,buildingId:10,category:'加工品',stepMinutes:4,analysisBatchYield:2,inputs:[{id:2,quantity:1}],coproducts:[{id:3,quantity:1}]},
  {id:5,name:'麦饼',level:1,buildingId:20,category:'加工品',stepMinutes:5,analysisBatchYield:1,inputs:[{id:3,quantity:1}]},
]},{cropQuantity:1,productQuantity:1,maxKinds:3,singleWindow:10});
for(const p of catalog.products)p.coinValue=p.id*3;
const result={config:{level:3,mix:[100,0,0],sourceEnabled:false},probabilities:catalog.orders.map(o=>o.id==='S1-1'?.75:o.id==='S1-2'?.25:0)};
const start=(settings={},seed=123)=>createGame(catalog,result,{settings,seed},100000);
const tests=[];
function test(name,run){run();tests.push(name);}
const empty=(settings={},seed=123)=>{const s=start(settings,seed);s.inventory={};if(settings.warehouseCapacity)s.settings.warehouseCapacity=settings.warehouseCapacity;return s;};

test('initial stock is live order quantity times 1/2/3 and only includes unlocked products',()=>{
  for(const multiplier of [1,2,3]){const s=start({initialStockMultiplier:multiplier});for(const p of catalog.products)assert.equal(s.inventory[p.id],p.orderQuantity*multiplier);assert.equal(s.settings.queueLimit,3);validateGameSave(s,catalog,result);}
  const changed=buildCatalog(catalog,{...catalog.rules,cropQuantity:6,productQuantity:2});
  const fit={...result,probabilities:changed.orders.map(o=>o.id==='S1-1'?.75:o.id==='S1-2'?.25:0)};
  const s=createGame(changed,fit,{seed:1},100000);assert.equal(s.inventory[1],12);assert.equal(s.inventory[3],4);
  const low={config:{...fit.config,level:1},probabilities:changed.orders.map(o=>o.id==='S1-1'?1:0)};
  assert.ok(!Object.hasOwn(createGame(changed,low,{seed:1},100000).inventory,'4'));
  assert.throws(()=>updateGameSettings(s,changed,{initialStockMultiplier:3}),/重新开始/);
  const roomy=start({initialStockMultiplier:3,warehouseCapacity:1});assert.equal(roomy.settings.warehouseCapacity,15);validateGameSave(roomy,catalog,result);
});
test('35-product warehouse totals, initial overflow and saved limits remain consistent',()=>{
  const products=Array.from({length:35},(_,i)=>({id:i+1,name:`商品${i+1}`,level:1,buildingId:i<9?0:10,isCrop:i<9,category:i<9?'田地作物':'加工品',stepMinutes:2,analysisBatchYield:1,coinValue:1,inputs:i<9?[]:[{id:1,quantity:2}]}));
  const c=buildCatalog({maxLevel:1,sources:[{id:0,name:'农田'},{id:10,name:'作坊'}],products},{cropQuantity:7,productQuantity:1,maxKinds:1,singleWindow:10});
  const r={config:{level:1,mix:[100,0,0]},probabilities:c.orders.map(o=>o.id==='S1-1'?1:0)};
  const two=createGame(c,r,{seed:1},100000);assert.equal(gameView(two,c).inventoryUsed,178);assert.equal(two.settings.warehouseCapacity,200);
  updateGameSettings(two,c,{warehouseCapacity:267});const saved=JSON.parse(JSON.stringify(two));validateGameSave(saved,c,r);assert.equal(gameView(saved,c).inventoryUsed,178);assert.equal(saved.settings.warehouseCapacity,267);
  const three=createGame(c,r,{settings:{initialStockMultiplier:3},seed:1},100000);assert.equal(gameView(three,c).inventoryUsed,267);assert.equal(three.settings.warehouseCapacity,267);
  plantPlot(three,c,1,0);skipGameTime(three,c,r,2,100000);assert.equal(gameView(three,c).inventoryUsed,267);assert.equal(three.settings.warehouseCapacity,267);
  const before=JSON.stringify(three);assert.throws(()=>harvestPlot(three,c,0),/仓库已满/);assert.equal(JSON.stringify(three),before);
  deliverGameOrder(three,c,r,0);assert.equal(gameView(three,c).inventoryUsed,260);harvestPlot(three,c,0);assert.equal(gameView(three,c).inventoryUsed,261);assert.equal(three.settings.warehouseCapacity,267);validateGameSave(three,c,r);
});

test('real elapsed time, GM time and backwards clocks never double count',()=>{
  const s=start();advanceGame(s,catalog,result,130000);assert.equal(s.elapsedMs,30000);
  skipGameTime(s,catalog,result,60,130000);assert.equal(s.elapsedMs,3630000);assert.equal(s.lastWallTime,130000);
  advanceGame(s,catalog,result,140000);assert.equal(s.elapsedMs,3640000);
  advanceGame(s,catalog,result,120000);advanceGame(s,catalog,result,140000);assert.equal(s.elapsedMs,3640000);
});
test('30 individual plots plant for free, stay occupied until clicked harvest, and replant',()=>{
  const s=empty();s.money=0;plantPlot(s,catalog,1,29);assert.equal(s.jobs[0].plotIndex,29);assert.equal(s.jobs[0].status,'running');assert.equal(s.money,0);
  assert.throws(()=>plantPlot(s,catalog,2,29),/已有/);assert.throws(()=>harvestPlot(s,catalog,29),/没有成熟/);
  enqueueProduction(s,catalog,2,29);assert.equal(s.jobs.length,30);assert.equal(new Set(s.jobs.map(j=>j.plotIndex)).size,30);assert.throws(()=>enqueueProduction(s,catalog,1),/空地/);
  skipGameTime(s,catalog,result,2,100000);assert.equal(s.jobs.find(j=>j.plotIndex===29).status,'ready');assert.equal(s.inventory[1]||0,0);
  harvestPlot(s,catalog,29);assert.equal(s.inventory[1],1);plantPlot(s,catalog,1,29);
  skipGameTime(s,catalog,result,60,100000);const got=harvestAll(s,catalog);assert.deepEqual(got,{harvested:30,remaining:0});assert.equal(s.jobs.length,0);assert.equal(s.inventory[1],2);assert.equal(s.inventory[2],29);
});
test('warehouse never loses crops: partial harvest leaves remaining mature plots',()=>{
  const s=empty({warehouseCapacity:1});enqueueProduction(s,catalog,1,3);skipGameTime(s,catalog,result,2,100000);
  assert.deepEqual(harvestAll(s,catalog),{harvested:1,remaining:2});assert.equal(s.jobs.length,2);assert.equal(s.inventory[1],1);
  assert.throws(()=>harvestPlot(s,catalog,1),/仓库已满/);assert.throws(()=>harvestAll(s,catalog),/仓库已满/);
  discardInventory(s,catalog,1);harvestPlot(s,catalog,1);assert.equal(s.inventory[1],1);assert.equal(s.jobs.length,1);
});
test('workshop dependencies only use items actually collected from fields and other workshops',()=>{
  const s=empty();enqueueProduction(s,catalog,5);enqueueProduction(s,catalog,3);enqueueProduction(s,catalog,1,2);
  skipGameTime(s,catalog,result,10,100000);assert.equal(s.inventory[5]||0,0);assert.equal(s.jobs.filter(j=>j.status==='ready').length,2);
  harvestAll(s,catalog);assert.equal(s.jobs.find(j=>j.productId===3).status,'running');
  skipGameTime(s,catalog,result,3,100000);assert.equal(s.jobs.find(j=>j.productId===3).status,'ready');assert.equal(s.jobs.find(j=>j.productId===5).status,'queued');assert.equal(s.inventory[3]||0,0);
  harvestProduction(s,catalog,s.jobs.find(j=>j.productId===3).id);assert.equal(s.jobs.find(j=>j.productId===5).status,'running');
  skipGameTime(s,catalog,result,5,100000);assert.equal(s.inventory[5]||0,0);assert.equal(s.jobs[0].status,'ready');
  assert.deepEqual(claimBuildingProducts(s,catalog,20),{harvested:1,remaining:0});assert.equal(s.inventory[5],1);assert.equal(s.jobs.length,0);
});
test('same building has one shared four-slot queue, including tasks waiting for ingredients',()=>{
  const s=empty();enqueueProduction(s,catalog,3,4);const before=JSON.stringify(s);assert.throws(()=>enqueueProduction(s,catalog,3),/最多容纳 4/);assert.equal(JSON.stringify(s),before);validateGameSave(s,catalog,result);
  s.inventory[2]=1;while(s.jobs.length)cancelProduction(s,s.jobs[0].id);
  enqueueProduction(s,catalog,3);enqueueProduction(s,catalog,4);assert.equal(s.jobs.filter(j=>j.status==='running').length,0);
  cancelProduction(s,s.jobs[0].id);advanceGame(s,catalog,result,100000);assert.equal(s.jobs[0].productId,4);assert.equal(s.jobs[0].status,'running');assert.throws(()=>cancelProduction(s,s.jobs[0].id),/已经开始/);
  const full=start();enqueueProduction(full,catalog,3,4);assert.equal(full.jobs.filter(j=>j.status==='queued').length,3);assert.equal(full.jobs.filter(j=>j.status==='running').length,1);assert.throws(()=>enqueueProduction(full,catalog,3),/最多容纳 4/);
});
test('parallel recipes consume shared ingredients atomically',()=>{
  const s=empty({channels:{10:2}});s.inventory[1]=2;enqueueProduction(s,catalog,3,2);
  assert.equal(s.jobs.filter(j=>j.status==='running').length,1);assert.equal(s.inventory[1],0);
  enqueueProduction(s,catalog,1,2);skipGameTime(s,catalog,result,2,100000);harvestAll(s,catalog);assert.equal(s.jobs.filter(j=>j.status==='running').length,2);
  skipGameTime(s,catalog,result,3,100000);assert.equal(s.inventory[3]||0,0);assert.deepEqual(claimBuildingProducts(s,catalog,10),{harvested:2,remaining:0});assert.equal(s.inventory[3],2);
});
test('workshop bundles wait for click, stay atomic at full warehouse, and still need collection after upgrade',()=>{
  const s=empty({warehouseCapacity:2});s.inventory[2]=1;enqueueProduction(s,catalog,4);skipGameTime(s,catalog,result,4,100000);
  assert.equal(s.jobs[0].status,'ready');assert.equal(s.inventory[4]||0,0);assert.equal(s.inventory[3]||0,0);
  const before=JSON.stringify(s);assert.throws(()=>harvestProduction(s,catalog,s.jobs[0].id),/仓库已满/);assert.throws(()=>claimBuildingProducts(s,catalog,10),/仓库已满/);assert.equal(JSON.stringify(s),before);
  upgradeWarehouse(s,catalog);assert.equal(s.inventory[4]||0,0);harvestProduction(s,catalog,s.jobs[0].id);assert.equal(s.inventory[4],2);assert.equal(s.inventory[3],1);assert.equal(s.jobs.length,0);
});
test('finished products occupy shared slots while the next queued task starts without collection',()=>{
  const s=empty();s.inventory[1]=8;enqueueProduction(s,catalog,3,4);assert.equal(s.jobs.filter(j=>j.status==='running').length,1);
  skipGameTime(s,catalog,result,3,100000);assert.equal(s.jobs.filter(j=>j.status==='ready').length,1);assert.equal(s.jobs.filter(j=>j.status==='running').length,1);assert.equal(s.jobs.filter(j=>j.status==='queued').length,2);assert.equal(s.inventory[3]||0,0);
  skipGameTime(s,catalog,result,20,100000);assert.equal(s.jobs.length,4);assert.ok(s.jobs.every(j=>j.status==='ready'));assert.equal(s.counters.produced,0);assert.throws(()=>enqueueProduction(s,catalog,3),/最多容纳 4/);
  const view=gameView(s,catalog),source=view.sources.find(v=>v.id==='10');assert.equal(source.totalSlots,4);assert.equal(source.capacity,1);assert.equal(source.collectable,4);assert.equal(source.ready,4);assert.equal(source.running,0);
  assert.deepEqual(claimBuildingProducts(s,catalog,10),{harvested:4,remaining:0});assert.equal(s.inventory[3],4);assert.equal(s.counters.produced,4);assert.equal(s.jobs.length,0);assert.throws(()=>claimBuildingProducts(s,catalog,10),/暂无完成/);
});
test('building collection fits complete bundles individually and leaves the rest in their slots',()=>{
  const s=empty({warehouseCapacity:2});s.inventory[2]=1;s.inventory[1]=2;enqueueProduction(s,catalog,4);enqueueProduction(s,catalog,3);skipGameTime(s,catalog,result,7,100000);
  assert.equal(s.jobs.length,2);assert.ok(s.jobs.every(j=>j.status==='ready'));assert.deepEqual(claimBuildingProducts(s,catalog,10),{harvested:1,remaining:1});assert.equal(s.inventory[3],1);assert.equal(s.inventory[4]||0,0);assert.equal(s.jobs[0].productId,4);
  upgradeWarehouse(s,catalog);assert.deepEqual(claimBuildingProducts(s,catalog,10),{harvested:1,remaining:0});assert.equal(s.inventory[3],2);assert.equal(s.inventory[4],2);
});
test('saved v2 blocked workshop output becomes unclaimed output without changing signature, money or inventory',()=>{
  const s=empty({warehouseCapacity:2});s.inventory[2]=1;enqueueProduction(s,catalog,4);skipGameTime(s,catalog,result,4,100000);s.jobs[0].status='blocked';
  const saved=JSON.parse(JSON.stringify(s)),signature=saved.signature,inventory=structuredClone(saved.inventory),money=saved.money,jobId=saved.jobs[0].id;validateGameSave(saved,catalog,result);
  advanceGame(saved,catalog,result,100000);assert.equal(saved.version,2);assert.equal(saved.signature,signature);assert.equal(saved.jobs[0].id,jobId);assert.equal(saved.jobs[0].status,'ready');assert.deepEqual(saved.inventory,inventory);assert.equal(saved.money,money);validateGameSave(saved,catalog,result);
  const roundTrip=JSON.parse(JSON.stringify(saved));validateGameSave(roundTrip,catalog,result);skipGameTime(roundTrip,catalog,result,60,100000);assert.equal(roundTrip.jobs.length,1);assert.deepEqual(roundTrip.inventory,inventory);
});
test('shared-slot and parallel-capacity reductions cannot erase running or finished tasks',()=>{
  const s=empty({channels:{10:2}});s.inventory[1]=10;enqueueProduction(s,catalog,3,5);assert.throws(()=>updateGameSettings(s,catalog,{channels:{10:1}}),/并行数/);
  skipGameTime(s,catalog,result,9,100000);assert.equal(s.jobs.length,5);assert.ok(s.jobs.every(j=>j.status==='ready'));assert.throws(()=>updateGameSettings(s,catalog,{channels:{10:1}}),/总槽位/);assert.throws(()=>updateGameSettings(s,catalog,{queueLimit:2}),/总槽位/);
  harvestProduction(s,catalog,s.jobs[0].id);updateGameSettings(s,catalog,{channels:{10:1}});validateGameSave(s,catalog,result);
  const forged=structuredClone(s);forged.jobs.push({...forged.jobs[0],id:forged.nextJobId++});assert.throws(()=>validateGameSave(forged,catalog,result),/超出容量/);
  assert.throws(()=>harvestProduction(s,catalog,-1),/还没有完成/);assert.throws(()=>claimBuildingProducts(s,catalog,'__farm__'),/建筑/);
});
test('delivery earns exactly 5 times sum of quantity times imported coin price, not work time',()=>{
  const s=start(),slot=gameView(s,catalog).board[0],p=catalog.products.find(p=>p.id===slot.items[0].id);
  assert.equal(slot.reward,p.coinValue*slot.items[0].quantity*5);const money=s.money;deliverGameOrder(s,catalog,result,0);assert.equal(s.money,money+slot.reward);assert.equal(s.counters.earned,slot.reward);assert.equal(s.counters.draws,7);
  const multiple=catalog.orders.find(o=>o.itemTypes===3);assert.equal(orderReward(s,multiple,catalog),multiple.items.reduce((a,i)=>a+i.quantity*catalog.products.find(p=>p.id===i.id).coinValue,0)*5);
  s.inventory={};assert.throws(()=>deliverGameOrder(s,catalog,result,0),/不足/);
});
test('missing prices prevent payout without fallback; zero and fractional prices are honored',()=>{
  const missing=structuredClone(catalog);for(const p of missing.products)p.coinValue=null;const s=createGame(missing,result,{seed:123},100000);
  assert.equal(gameView(s,missing).board[0].reward,null);assert.equal(gameView(s,missing).board[0].canDeliver,false);const before=JSON.stringify(s);assert.throws(()=>deliverGameOrder(s,missing,result,0),/金币单价/);assert.equal(JSON.stringify(s),before);
  const priced=structuredClone(catalog);for(const p of priced.products)p.coinValue=0;const zero=createGame(priced,result,{seed:123},100000);deliverGameOrder(zero,priced,result,0);assert.equal(zero.money,1000);
  for(const p of priced.products)p.coinValue=.33;const fractional=createGame(priced,result,{seed:123},100000);deliverGameOrder(fractional,priced,result,0);assert.equal(fractional.money,1001.65);validateGameSave(fractional,priced,result);
  assert.notEqual(gameSignature(catalog,result),gameSignature(priced,result));
});
test('free refresh works at zero money, waits once and draws at exact deadline',()=>{
  const s=start();s.money=0;refreshGameOrder(s,catalog,result,0);assert.equal(s.money,0);assert.equal(s.counters.draws,6);assert.throws(()=>refreshGameOrder(s,catalog,result,0),/正在刷新/);
  skipGameTime(s,catalog,result,4.999,100000);assert.equal(s.board[0].status,'refreshing');skipGameTime(s,catalog,result,.001,100000);assert.equal(s.board[0].status,'ready');assert.equal(s.counters.draws,7);
  updateGameSettings(s,catalog,{refreshMinutes:0});refreshGameOrder(s,catalog,result,1);assert.equal(s.board[1].status,'ready');assert.equal(s.counters.draws,8);
  assert.ok(!['seedCost','coinPerMinute','refreshCost'].some(k=>k in s.settings));
});
test('seeded fitted draws never inspect warehouse and retain probability distribution',()=>{
  const a=start({refreshMinutes:0},9988),b=start({refreshMinutes:0},9988);b.inventory[2]=100;
  let count=0;for(let i=0;i<20000;i++){refreshGameOrder(a,catalog,result,0);refreshGameOrder(b,catalog,result,0);assert.equal(a.board[0].orderId,b.board[0].orderId);if(a.board[0].orderId==='S1-1')count++;}
  assert.ok(Math.abs(count/20000-.75)<.015);assert.equal(a.rngState,b.rngState);
});
test('JSON round trip retains plot identity, maturity, offline production and refresh',()=>{
  const s=start();plantPlot(s,catalog,1,17);enqueueProduction(s,catalog,3);refreshGameOrder(s,catalog,result,1);
  const saved=JSON.parse(JSON.stringify(s));validateGameSave(saved,catalog,result);advanceGame(s,catalog,result,1300000);advanceGame(saved,catalog,result,1300000);assert.deepEqual(saved,s);assert.equal(saved.jobs[0].plotIndex,17);assert.equal(saved.jobs[0].status,'ready');validateGameSave(saved,catalog,result);
  const changed=structuredClone(result);changed.probabilities=changed.probabilities.map((p,i)=>catalog.orders[i].id==='S1-1'?.5:catalog.orders[i].id==='S1-2'?.5:0);assert.throws(()=>validateGameSave(saved,catalog,changed),/已变化/);
});
test('land resizing cannot erase an occupied high-index plot; missing imported land still configurable',()=>{
  const c={...catalog,landsByLevel:undefined},s=createGame(c,result,{seed:123},100000);assert.equal(gameView(s,c).sources[0].capacity,6);
  updateGameSettings(s,c,{landCapacity:30});plantPlot(s,c,1,29);assert.throws(()=>updateGameSettings(s,c,{landCapacity:29}),/地块/);
  skipGameTime(s,c,result,2,100000);assert.throws(()=>updateGameSettings(s,c,{landCapacity:29}),/地块/);harvestPlot(s,c,29);updateGameSettings(s,c,{landCapacity:6});assert.equal(c.landsByLevel,undefined);
});
test('invalid saves cannot duplicate plots, forge harvest readiness or exceed constraints',()=>{
  const s=start();plantPlot(s,catalog,1,0);plantPlot(s,catalog,1,1);const bad=structuredClone(s);bad.jobs[1].plotIndex=0;assert.throws(()=>validateGameSave(bad,catalog,result),/田地/);
  const forged=structuredClone(s);forged.jobs[0].status='ready';assert.throws(()=>validateGameSave(forged,catalog,result),/计时/);
  assert.throws(()=>plantPlot(s,catalog,1,30),/地块编号/);assert.throws(()=>plantPlot(s,catalog,3,2),/作物/);
  assert.throws(()=>updateGameSettings(s,catalog,{landCapacity:0}),/农田数量/);assert.throws(()=>updateGameSettings(s,catalog,{seedCost:1}),/参数无效/);
  assert.throws(()=>createGame(catalog,result,{level:2}),/不一致/);assert.throws(()=>enqueueProduction(s,catalog,99),/不存在/);
  upgradeBuilding(s,catalog,10);assert.equal(s.settings.channels[10],2);assert.equal(s.money,800);upgradeWarehouse(s,catalog);assert.equal(s.money,600);
});
console.log(JSON.stringify({passed:tests.length,tests},null,2));
