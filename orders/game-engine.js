import {eligibleOrder} from './probability-floor.js';

// Game time is stored separately from wall time so GM jumps never create future wall clocks.
export const GAME_VERSION=1;
const MINUTE=60000,FARM='__farm__',MAX_JOBS=1000;
const samplerCache=new WeakMap();
const crop=p=>Boolean(p.isCrop||p.category==='田地作物'||p.category==='特殊作物');
const resource=p=>crop(p)?FARM:String(p.buildingId);
const integer=(v,min,max,label)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw Error(`${label}必须为 ${min}～${max} 的整数。`);return v;};
const finite=(v,min,max,label)=>{if(!Number.isFinite(v)||v<min||v>max)throw Error(`${label}必须在 ${min}～${max} 之间。`);return v;};
const getProduct=(catalog,id)=>catalog.products.find(p=>String(p.id)===String(id));
const stock=(state,id)=>state.inventory[String(id)]||0;
const inventoryUsed=state=>Object.values(state.inventory).reduce((a,b)=>a+b,0);
const note=(state,text)=>{state.log.push({at:state.elapsedMs,text});if(state.log.length>60)state.log.splice(0,state.log.length-60);};

function fitData(catalog,result){
  if(!catalog||!Array.isArray(catalog.products)||!Array.isArray(catalog.orders)||!Array.isArray(catalog.sources))throw Error('没有可用的商品与配方。');
  if(!result||result.blocked||!Array.isArray(result.probabilities)&&!ArrayBuffer.isView(result.probabilities)||result.probabilities.length!==catalog.orders.length)throw Error('当前等级没有有效拟合结果。');
  const entries=[];let total=0;
  catalog.orders.forEach((order,index)=>{
    const probability=result.probabilities[index];
    if(!Number.isFinite(probability)||probability<0)throw Error('拟合概率无效。');
    if(!probability)return;
    if(!result.config||!eligibleOrder(order,result.config))throw Error('拟合结果含有当前等级不可生成的订单。');
    total+=probability;entries.push({order,probability,upper:total});
  });
  if(!entries.length||Math.abs(total-1)>1e-7)throw Error('拟合概率合计不为 100%，请重新拟合。');
  return {entries,total};
}

function sampler(catalog,result){
  let byResult=samplerCache.get(catalog);if(!byResult){byResult=new WeakMap();samplerCache.set(catalog,byResult);}
  if(!byResult.has(result))byResult.set(result,fitData(catalog,result));
  return byResult.get(result);
}

function nextRandom(state){let x=state.rngState>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;state.rngState=x>>>0;return state.rngState/4294967296;}
function draw(state,catalog,result){
  const {entries,total}=sampler(catalog,result),u=nextRandom(state)*total;let lo=0,hi=entries.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(u<entries[mid].upper)hi=mid;else lo=mid+1;}
  state.counters.draws++;return {orderId:entries[lo].order.id,status:'ready'};
}

function landCount(catalog,level){
  const value=catalog.landsByLevel?.[level];
  return Number.isInteger(value)&&value>0&&value<=10000?value:6;
}

export function gameSignature(catalog,result,level=result?.config?.level){
  integer(level,1,200,'等级');fitData(catalog,result);
  if(result.config.level!==level)throw Error('拟合等级与模拟等级不一致。');
  const value=JSON.stringify({version:GAME_VERSION,level,lands:landCount(catalog,level),
    products:catalog.products.map(p=>[p.id,p.name,p.level,p.buildingId,crop(p),p.stepMinutes,p.analysisBatchYield,p.inputs,p.coproducts||[]]),
    sources:catalog.sources.map(s=>[s.id,s.name,s.level]),
    orders:catalog.orders.map((o,i)=>[o.id,o.items,o.cumulativeMinutes,result.probabilities[i]])});
  let a=2166136261,b=0x9e3779b9;
  for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619)>>>0;b=Math.imul(b^value.charCodeAt(i),2246822519)>>>0;}
  return `game-v${GAME_VERSION}-${value.length}-${a.toString(16)}-${b.toString(16)}`;
}

function unlockedSources(catalog,level){return catalog.sources.filter(s=>catalog.products.some(p=>p.level<=level&&!crop(p)&&String(p.buildingId)===String(s.id)));}
function validateSettings(settings,catalog,level){
  if(settings.landCapacity!==undefined)integer(settings.landCapacity,1,10000,'农田数量');
  integer(settings.warehouseCapacity,1,1000000,'仓库容量');integer(settings.queueLimit,1,100,'等待队列上限');integer(settings.orderSlots,1,12,'订单栏数量');
  integer(settings.refreshCost,0,1000000000,'刷新费用');finite(settings.refreshMinutes,0,10080,'刷新等待时间');finite(settings.coinPerMinute,0.0001,1000000,'工时金币系数');integer(settings.seedCost,0,1000000000,'单次播种费用');
  if(!settings.channels||typeof settings.channels!=='object'||Array.isArray(settings.channels))throw Error('并行队列配置无效。');
  const ids=new Set(unlockedSources(catalog,level).map(s=>String(s.id)));
  for(const [id,count] of Object.entries(settings.channels)){if(!ids.has(id))throw Error('并行队列包含未解锁的建筑。');integer(count,1,20,'建筑并行队列数');}
  for(const id of ids)if(settings.channels[id]==null)throw Error('缺少建筑并行队列数。');
}

export function createGame(catalog,result,options={},now=Date.now()){
  finite(now,0,Number.MAX_SAFE_INTEGER,'当前时间');
  const level=options.level??result?.config?.level,signature=gameSignature(catalog,result,level);
  const defaults={warehouseCapacity:200,landCapacity:landCount(catalog,level),queueLimit:12,orderSlots:6,refreshCost:10,refreshMinutes:5,coinPerMinute:1,seedCost:0,channels:Object.fromEntries(unlockedSources(catalog,level).map(s=>[s.id,1]))};
  const settings={...defaults,...options.settings,channels:{...defaults.channels,...options.settings?.channels}};
  validateSettings(settings,catalog,level);
  const money=integer(options.money??1000,0,Number.MAX_SAFE_INTEGER,'初始金币'),seed=integer(options.seed??Math.floor(Math.random()*4294967296),0,4294967295,'随机种子');
  const state={version:GAME_VERSION,signature,level,lastWallTime:now,elapsedMs:0,money,inventory:{},settings,jobs:[],board:[],counters:{delivered:0,earned:0,refreshed:0,produced:0,draws:0},log:[],rngState:seed||0x6d2b79f5,nextJobId:1,warehouseUpgrades:0,buildingUpgrades:{}};
  for(let i=0;i<settings.orderSlots;i++)state.board.push(draw(state,catalog,result));
  note(state,`开始 Lv ${level} 经营，获得 ${money} 金币。`);return state;
}

function capacity(state,catalog,id){return id===FARM?(state.settings.landCapacity??landCount(catalog,state.level)):state.settings.channels[id]||1;}
function outputs(p){
  const output=new Map([[String(p.id),p.analysisBatchYield||1]]);
  for(const item of p.coproducts||[])output.set(String(item.id),(output.get(String(item.id))||0)+item.quantity);
  return [...output].map(([id,quantity])=>({id,quantity}));
}
function readyInputs(state,p){return (p.inputs||[]).every(input=>stock(state,input.id)>=input.quantity);}

// Finish first, then start FIFO work. Repeating also releases output blocked by full storage
// when a newly started recipe frees warehouse space at this same instant.
function settle(state,catalog){
  let again=true;
  while(again){
    again=false;
    for(const job of state.jobs){if(job.status==='running'&&job.endAt<=state.elapsedMs){job.status='blocked';again=true;}}
    for(const job of [...state.jobs]){
      if(job.status!=='blocked')continue;
      const p=getProduct(catalog,job.productId),out=outputs(p),amount=out.reduce((s,v)=>s+v.quantity,0);
      if(inventoryUsed(state)+amount>state.settings.warehouseCapacity)continue;
      for(const item of out)state.inventory[item.id]=stock(state,item.id)+item.quantity;
      state.jobs.splice(state.jobs.indexOf(job),1);state.counters.produced+=amount;
      note(state,`${p.name}生产完成，入库 ${amount} 件。`);again=true;
    }
    const ids=new Set(state.jobs.map(j=>j.sourceId));
    for(const id of ids){
      let free=capacity(state,catalog,id)-state.jobs.filter(j=>j.sourceId===id&&j.status!=='queued').length;
      for(const job of state.jobs.filter(j=>j.sourceId===id&&j.status==='queued')){
        if(free<=0)break;
        const p=getProduct(catalog,job.productId),cost=crop(p)?state.settings.seedCost:0;
        if(!readyInputs(state,p)||state.money<cost)break;
        for(const input of p.inputs||[])state.inventory[String(input.id)]=stock(state,input.id)-input.quantity;
        state.money-=cost;job.status='running';job.startedAt=state.elapsedMs;job.endAt=state.elapsedMs+p.stepMinutes*MINUTE;free--;again=true;
      }
    }
  }
}

function advanceTo(state,catalog,result,target){
  finite(target,state.elapsedMs,Number.MAX_SAFE_INTEGER,'游戏时间');settle(state,catalog);
  for(;;){
    let next=Infinity;
    for(const job of state.jobs)if(job.status==='running')next=Math.min(next,job.endAt);
    for(const slot of state.board)if(slot.status==='refreshing')next=Math.min(next,slot.readyAt);
    if(next>target)break;
    state.elapsedMs=Math.max(state.elapsedMs,next);
    for(let i=0;i<state.board.length;i++)if(state.board[i].status==='refreshing'&&state.board[i].readyAt<=state.elapsedMs){state.board[i]=draw(state,catalog,result);note(state,`订单 ${i+1} 刷新完成。`);}
    settle(state,catalog);
  }
  state.elapsedMs=target;settle(state,catalog);return state;
}

export function advanceGame(state,catalog,result,now=Date.now()){
  finite(now,0,Number.MAX_SAFE_INTEGER,'当前时间');
  const delta=Math.max(0,now-state.lastWallTime);advanceTo(state,catalog,result,state.elapsedMs+delta);
  // A backwards system clock cannot move simulation time backwards or count the same interval twice.
  state.lastWallTime=Math.max(now,state.lastWallTime);return state;
}

export function skipGameTime(state,catalog,result,minutes=60,now=Date.now()){
  finite(minutes,0,525600,'跳过分钟数');advanceGame(state,catalog,result,now);return advanceTo(state,catalog,result,state.elapsedMs+minutes*MINUTE);
}

export function enqueueProduction(state,catalog,productId,batches=1){
  const p=getProduct(catalog,productId);if(!p||p.level>state.level)throw Error('商品不存在或尚未解锁。');
  integer(batches,1,MAX_JOBS,'生产次数');if(state.jobs.length+batches>MAX_JOBS)throw Error('待处理生产任务最多 1,000 个。');
  const id=resource(p),count=state.jobs.filter(j=>j.sourceId===id).length,limit=capacity(state,catalog,id)+state.settings.queueLimit;
  if(count+batches>limit)throw Error(`该生产区域最多容纳 ${limit} 个生产任务，请减少数量。`);
  for(let i=0;i<batches;i++)state.jobs.push({id:state.nextJobId++,productId:p.id,sourceId:id,status:'queued',enqueuedAt:state.elapsedMs});
  note(state,`${p.name}加入生产，共 ${batches} 次。`);settle(state,catalog);return state;
}

export function cancelProduction(state,jobId){
  const index=state.jobs.findIndex(j=>j.id===Number(jobId));if(index<0)throw Error('生产任务不存在。');
  if(state.jobs[index].status!=='queued')throw Error('生产已经开始，只能取消尚未开始的任务。');
  state.jobs.splice(index,1);note(state,'已取消一个等待生产的任务。');return state;
}

function readySlot(state,catalog,slotIndex){
  integer(slotIndex,0,state.board.length-1,'订单位置');const slot=state.board[slotIndex];
  if(slot.status!=='ready')throw Error('该订单正在刷新，请等待。');
  const order=catalog.orders.find(o=>o.id===slot.orderId);if(!order)throw Error('订单已失效，请重新开始模拟。');return order;
}
export function orderReward(state,order){return Math.max(1,Math.round(order.cumulativeMinutes*state.settings.coinPerMinute));}
export function deliverGameOrder(state,catalog,result,slotIndex){
  const order=readySlot(state,catalog,slotIndex);
  for(const item of order.items)if(stock(state,item.id)<item.quantity)throw Error('仓库商品不足，无法交付。');
  const reward=orderReward(state,order);finite(state.money+reward,0,Number.MAX_SAFE_INTEGER,'金币余额');
  for(const item of order.items)state.inventory[String(item.id)]=stock(state,item.id)-item.quantity;
  state.money+=reward;state.counters.delivered++;state.counters.earned+=reward;state.board[slotIndex]=draw(state,catalog,result);
  note(state,`交付订单 ${slotIndex+1}，获得 ${reward} 金币。`);settle(state,catalog);return state;
}

export function refreshGameOrder(state,catalog,result,slotIndex){
  readySlot(state,catalog,slotIndex);if(state.money<state.settings.refreshCost)throw Error('金币不足，无法刷新订单。');
  state.money-=state.settings.refreshCost;state.counters.refreshed++;
  state.board[slotIndex]={orderId:null,status:'refreshing',readyAt:state.elapsedMs+state.settings.refreshMinutes*MINUTE};
  note(state,`刷新订单 ${slotIndex+1}，花费 ${state.settings.refreshCost} 金币。`);
  advanceTo(state,catalog,result,state.elapsedMs);return state;
}

export function updateGameSettings(state,catalog,patch){
  const allowed=new Set(['warehouseCapacity','landCapacity','queueLimit','orderSlots','refreshCost','refreshMinutes','coinPerMinute','seedCost','channels']);
  if(!patch||typeof patch!=='object'||Object.keys(patch).some(k=>!allowed.has(k)))throw Error('模拟参数无效。');
  const settings={...state.settings,...patch,channels:{...state.settings.channels,...patch.channels}};validateSettings(settings,catalog,state.level);
  if(settings.orderSlots!==state.settings.orderSlots)throw Error('订单栏数量请在新建游戏时设置。');
  if(settings.warehouseCapacity<inventoryUsed(state))throw Error('仓库容量不能小于现有库存。');
  for(const id of new Set(state.jobs.map(j=>j.sourceId))){
    const occupied=state.jobs.filter(j=>j.sourceId===id&&j.status!=='queued').length;
    const cap=id===FARM?(settings.landCapacity??landCount(catalog,state.level)):settings.channels[id];
    if(occupied>cap)throw Error('并行数不能低于正在生产或等待入库的任务数。');
    if(state.jobs.filter(j=>j.sourceId===id).length>cap+settings.queueLimit)throw Error('等待队列上限不能小于当前任务数。');
  }
  state.settings=settings;note(state,'已更新模拟参数。');settle(state,catalog);return state;
}

export function warehouseUpgradeCost(state){return 200*(state.warehouseUpgrades+1);}
export function upgradeWarehouse(state,catalog){
  const cost=warehouseUpgradeCost(state);if(state.money<cost)throw Error(`仓库扩容需要 ${cost} 金币。`);
  if(state.settings.warehouseCapacity+100>1000000)throw Error('仓库已达到容量上限。');
  state.money-=cost;state.warehouseUpgrades++;state.settings.warehouseCapacity+=100;note(state,`仓库扩容 100 格，花费 ${cost} 金币。`);settle(state,catalog);return state;
}
export function buildingUpgradeCost(state,sourceId){return 200*((state.buildingUpgrades[String(sourceId)]||0)+1);}
export function upgradeBuilding(state,catalog,sourceId){
  const id=String(sourceId);if(!unlockedSources(catalog,state.level).some(s=>String(s.id)===id))throw Error('加工建筑不存在或尚未解锁。');
  const cost=buildingUpgradeCost(state,id);if(state.settings.channels[id]>=20)throw Error('该建筑最多开放 20 条并行生产线。');
  if(state.money<cost)throw Error(`增加并行生产线需要 ${cost} 金币。`);
  state.money-=cost;state.buildingUpgrades[id]=(state.buildingUpgrades[id]||0)+1;state.settings.channels[id]++;
  note(state,`增加一条并行生产线，花费 ${cost} 金币。`);settle(state,catalog);return state;
}

export function discardInventory(state,catalog,productId,quantity=1){
  integer(quantity,1,1000000000,'移除数量');if(stock(state,productId)<quantity)throw Error('库存不足。');
  const p=getProduct(catalog,productId);if(!p)throw Error('商品不存在。');
  state.inventory[String(p.id)]-=quantity;note(state,`移除 ${p.name} × ${quantity}。`);settle(state,catalog);return state;
}

export function gameView(state,catalog){
  const products=catalog.products.filter(p=>p.level<=state.level).map(p=>({...p,quantity:stock(state,p.id),sourceId:resource(p),isCrop:crop(p),outputQuantity:p.analysisBatchYield||1,
    missing:(p.inputs||[]).map(i=>({...i,name:getProduct(catalog,i.id)?.name||String(i.id),stock:stock(state,i.id),missing:Math.max(0,i.quantity-stock(state,i.id))}))}));
  const sources=[...(products.some(crop)?[{id:FARM,name:'农田',isFarm:true}]:[]),...unlockedSources(catalog,state.level).map(s=>({...s,id:String(s.id),isFarm:false}))].map(s=>({...s,capacity:capacity(state,catalog,s.id),running:state.jobs.filter(j=>j.sourceId===s.id&&j.status==='running').length,blocked:state.jobs.filter(j=>j.sourceId===s.id&&j.status==='blocked').length,queued:state.jobs.filter(j=>j.sourceId===s.id&&j.status==='queued').length,queueLimit:state.settings.queueLimit,upgradeCost:s.isFarm?null:buildingUpgradeCost(state,s.id)}));
  const jobs=state.jobs.map(job=>{const p=getProduct(catalog,job.productId),missing=(p.inputs||[]).filter(i=>stock(state,i.id)<i.quantity).map(i=>({id:i.id,name:getProduct(catalog,i.id)?.name||String(i.id),quantity:i.quantity,stock:stock(state,i.id),missing:i.quantity-stock(state,i.id)}));return {...job,name:p.name,remainingMs:job.status==='running'?Math.max(0,job.endAt-state.elapsedMs):0,progress:job.status==='running'?Math.min(1,(state.elapsedMs-job.startedAt)/(job.endAt-job.startedAt)):job.status==='blocked'?1:0,missing,waitingReason:job.status==='blocked'?'仓库已满，等待入库':job.status==='queued'?(missing.length?'缺少原料':crop(p)&&state.money<state.settings.seedCost?'金币不足':'等待生产线'):''};});
  const board=state.board.map((slot,index)=>{
    if(slot.status==='refreshing')return {...slot,index,remainingMs:Math.max(0,slot.readyAt-state.elapsedMs)};
    const order=catalog.orders.find(o=>o.id===slot.orderId),items=order.items.map(i=>({...i,name:getProduct(catalog,i.id)?.name||String(i.id),stock:stock(state,i.id),missing:Math.max(0,i.quantity-stock(state,i.id))}));
    return {...slot,index,order,items,canDeliver:items.every(i=>i.missing===0),reward:orderReward(state,order),remainingMs:0};
  });
  return {level:state.level,money:state.money,elapsedMs:state.elapsedMs,elapsedMinutes:state.elapsedMs/MINUTE,inventoryUsed:inventoryUsed(state),warehouseCapacity:state.settings.warehouseCapacity,warehouseUpgradeCost:warehouseUpgradeCost(state),products,sources,jobs,board,counters:{...state.counters},settings:state.settings,log:state.log};
}

export function validateGameSave(state,catalog,result){
  if(!state||typeof state!=='object'||state.version!==GAME_VERSION)throw Error('游戏存档版本无效。');
  if(state.signature!==gameSignature(catalog,result,state.level))throw Error('商品配方、土地或拟合概率已变化，此存档不能用于当前配置，请重新开始模拟。');
  integer(state.level,1,200,'存档等级');finite(state.lastWallTime,0,Number.MAX_SAFE_INTEGER,'存档时间');finite(state.elapsedMs,0,Number.MAX_SAFE_INTEGER,'游戏时间');integer(state.money,0,Number.MAX_SAFE_INTEGER,'金币');integer(state.rngState,1,4294967295,'随机状态');integer(state.nextJobId,1,Number.MAX_SAFE_INTEGER,'任务编号');
  validateSettings(state.settings,catalog,state.level);integer(state.warehouseUpgrades,0,10000,'仓库扩容次数');
  if(!state.inventory||typeof state.inventory!=='object'||Array.isArray(state.inventory))throw Error('库存存档无效。');
  for(const [id,quantity] of Object.entries(state.inventory)){const p=getProduct(catalog,id);if(!p||p.level>state.level)throw Error('库存含有未解锁商品。');integer(quantity,0,1000000000,'库存数量');}
  if(inventoryUsed(state)>state.settings.warehouseCapacity)throw Error('库存超出仓库容量。');
  if(!Array.isArray(state.jobs)||state.jobs.length>MAX_JOBS)throw Error('生产队列存档无效。');
  const jobIds=new Set();
  for(const j of state.jobs){
    integer(j.id,1,state.nextJobId-1,'生产任务编号');if(jobIds.has(j.id))throw Error('生产任务编号重复。');jobIds.add(j.id);
    const p=getProduct(catalog,j.productId);if(!p||p.level>state.level||j.sourceId!==resource(p)||!['queued','running','blocked'].includes(j.status))throw Error('生产任务存档无效。');
    finite(j.enqueuedAt,0,state.elapsedMs,'排队时间');
    if(j.status!=='queued'){
      finite(j.startedAt,j.enqueuedAt,state.elapsedMs,'开工时间');finite(j.endAt,j.startedAt+0.000001,Number.MAX_SAFE_INTEGER,'完工时间');
      if(Math.abs(j.endAt-j.startedAt-p.stepMinutes*MINUTE)>0.01||j.status==='running'&&j.endAt<=state.elapsedMs||j.status==='blocked'&&j.endAt>state.elapsedMs)throw Error('生产计时存档无效。');
    }
  }
  for(const id of new Set(state.jobs.map(j=>j.sourceId))){const cap=capacity(state,catalog,id);if(state.jobs.filter(j=>j.sourceId===id&&j.status!=='queued').length>cap||state.jobs.filter(j=>j.sourceId===id).length>cap+state.settings.queueLimit)throw Error('生产队列超出容量。');}
  const allowed=new Set(sampler(catalog,result).entries.map(e=>e.order.id));
  if(!Array.isArray(state.board)||state.board.length!==state.settings.orderSlots)throw Error('订单栏存档无效。');
  for(const slot of state.board){if(slot.status==='ready'){if(!allowed.has(slot.orderId))throw Error('订单已不在当前生成范围。');}else if(slot.status==='refreshing'){if(slot.orderId!==null)throw Error('刷新订单存档无效。');finite(slot.readyAt,state.elapsedMs,Number.MAX_SAFE_INTEGER,'刷新时间');}else throw Error('订单状态无效。');}
  if(!state.counters||!['delivered','earned','refreshed','produced','draws'].every(k=>Number.isSafeInteger(state.counters[k])&&state.counters[k]>=0))throw Error('经营统计存档无效。');
  if(!Array.isArray(state.log)||state.log.length>60||state.log.some(v=>!Number.isFinite(v.at)||v.at<0||v.at>state.elapsedMs||typeof v.text!=='string'||v.text.length>1000))throw Error('经营记录存档无效。');
  if(!state.buildingUpgrades||typeof state.buildingUpgrades!=='object'||Array.isArray(state.buildingUpgrades))throw Error('建筑升级存档无效。');
  for(const [id,n] of Object.entries(state.buildingUpgrades)){if(!Object.hasOwn(state.settings.channels,id))throw Error('建筑升级存档无效。');integer(n,0,19,'建筑升级次数');}
  return state;
}
