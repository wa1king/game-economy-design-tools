import * as game from './game-engine.js';
import {createGameStore} from './game-storage.js';
import {createFieldStroke} from './game-field-input.js';

const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(v,d=0)=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d});
const duration=ms=>{let s=Math.max(0,Math.ceil(ms/1000));const h=Math.floor(s/3600);s%=3600;return h?`${h}时${String(Math.floor(s/60)).padStart(2,'0')}分`:`${Math.floor(s/60)}分${String(s%60).padStart(2,'0')}秒`;};
const clock=ms=>{const s=Math.floor(ms/1000),h=Math.floor(s/3600);return `${String(h).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};

export function createGameMode(api){
  const $=id=>document.getElementById(id);
  $('openOrderSimulator').insertAdjacentHTML('afterend','<button type="button" id="openManagementGame" class="game-entry" disabled><span aria-hidden="true">▤</span> 模拟经营</button>');
  $('refreshSimulation').insertAdjacentHTML('beforebegin','<button type="button" id="openGameFromSimulator" class="game-button">进入模拟经营 →</button>');
  const root=document.createElement('div');root.innerHTML=`
  <dialog id="managementGameDialog" class="game-dialog" aria-labelledby="managementGameTitle"><div class="game-shell">
    <div class="game-head"><div class="game-brand"><span class="game-emblem" aria-hidden="true">禾</span><div><h2 id="managementGameTitle">模拟经营</h2><p id="gameProjectMeta"></p></div></div><div class="game-head-actions"><button class="game-button game-settings-button" id="gameSettingsButton" type="button">试玩设置</button><button class="game-button game-restart-button" id="gameRestart" type="button">重新试玩</button><button class="game-button gm" id="gameSkipHour" type="button">GM · 跳过1小时</button><button class="game-close" id="gameClose" type="button" aria-label="返回订单分析">×</button></div></div>
    <div class="game-stats"><div class="game-stat"><small>经营时间</small><strong id="gameClock">00:00:00</strong><span id="gameDay">第1天</span></div><div class="game-stat"><small>金币</small><strong id="gameMoney">0</strong><span id="gameEarned">累计收入 0</span></div><div class="game-stat game-warehouse"><small>仓库</small><strong id="gameStock">0<em>/ 200</em></strong><span id="gameStockHint"></span><div id="gameStockFloat" class="game-stock-float" role="status" aria-live="polite" aria-atomic="true" hidden></div></div><div class="game-stat"><small>已交订单</small><strong id="gameDelivered">0<em>单</em></strong><span id="gameReadyCount">可交付 0 单</span></div></div>
    <div class="game-notice" id="gameNotice" role="status" aria-live="polite"></div>
    <div class="game-body"><section class="game-production"><div class="game-section-heading"><nav class="game-tabs" aria-label="经营内容"><button class="active" type="button" data-game-tab="production">生产</button><button type="button" data-game-tab="inventory">仓库</button><button type="button" data-game-tab="log">记录</button></nav><small id="gameProductionSummary"></small></div><div id="gameProductionPane"><div id="gameSources" class="game-source-grid"></div></div><div id="gameInventoryPane" hidden><div class="game-inventory"><div class="game-inventory-tools"><input id="gameStockSearch" aria-label="搜索仓库商品" placeholder="搜索商品"><button class="game-button" type="button" id="gameExpandWarehouse"></button></div><div id="gameStockList" class="game-stock-list"></div></div></div><div id="gameLogPane" hidden><div id="gameLogList" class="game-log"></div></div></section>
    <section class="game-orders-side"><div class="game-section-heading"><h3>订单板 <small id="gameBoardCount"></small></h3><small id="gameRefreshHint"></small></div><div id="gameOrders" class="game-order-grid"></div></section></div>
    <div id="gameCropPicker" class="game-crop-picker" role="dialog" aria-label="田地操作" hidden></div>
    <div id="gameDragGhost" class="game-drag-ghost" aria-hidden="true" hidden></div>
    <div class="game-savebar"><span id="gameSaveStatus">自动存档</span></div>
  </div></dialog>
  <dialog id="gameSettingsDialog" class="game-settings" aria-labelledby="gameSettingsTitle"><h3 id="gameSettingsTitle">试玩设置</h3><p class="game-settings-sub">配方与时间来自导入表；以下为独立的试玩规则。</p><form id="gameSettingsForm"><div class="game-settings-grid">
    <label>仓库容量<input type="number" name="warehouseCapacity" min="1" max="1000000" required></label><label>农田数量<input type="number" name="landCapacity" min="1" max="10000" required></label><label>额外队列格数<input type="number" name="queueLimit" min="1" max="100" required></label><label>订单栏数量 · 重开生效<input type="number" name="orderSlots" min="1" max="12" required></label><label>刷新等待 · 分钟<input type="number" name="refreshMinutes" min="0" max="10080" step="any" required></label>
  </div><fieldset class="game-stock-multiplier"><legend>初始备货 · 订单需求的倍数 · 重开生效</legend><div>${[1,2,3].map(n=>`<label><input type="radio" name="initialStockMultiplier" value="${n}" ${n===2?'checked':''}><span>${n} 倍</span></label>`).join('')}</div><small>每种已解锁商品均发放；仓库容量不足时自动扩至可容纳初始物品。</small></fieldset><h4>加工建筑 · 并行生产线</h4><div id="gameChannelSettings" class="game-settings-grid"></div><p id="gameLandSettings" class="game-settings-note"></p><p class="game-settings-note">队列总格数 = 并行数 + 额外格数。订单奖励 = 商品金币价值 × 5；刷新、播种免费。</p><div id="gameSettingsError" class="game-setup-error" role="alert"></div><div class="game-setting-actions"><button id="gameNewSave" type="button" class="game-button danger">重新试玩</button><div><button id="gameCancelSettings" type="button" class="game-button">取消</button><button type="submit" class="game-button primary">保存设置</button></div></div></form></dialog>
  <dialog id="gameConfirmDialog" class="game-confirm" aria-labelledby="gameConfirmTitle"><h3 id="gameConfirmTitle"></h3><p id="gameConfirmText"></p><div class="game-confirm-actions"><button class="game-button" type="button" id="gameConfirmCancel">取消</button><button class="game-button primary" type="button" id="gameConfirmAccept">确认</button></div></dialog>`;
  document.querySelector('main').append(root);
  const dialog=$('managementGameDialog'),settingsDialog=$('gameSettingsDialog'),confirmDialog=$('gameConfirmDialog');
  let pendingMessage='',state,active,store,lastSavedAt=0,conflict=false,mode='production',view,confirmAction=null,boardStamp='',sourceStamp='',inventoryStamp='',logStamp='';
  const selection={};
  let pickupAmount=0,pickupAt=-Infinity,pickupTimer=0;
  let pickerPlot=null,pendingFarm=null,dragContext=null,suppressClickUntil=0;
  const stroke=createFieldStroke((index,tool,productId)=>{
    const plot=state.jobs.find(j=>j.sourceId==='__farm__'&&j.plotIndex===index);
    if(tool==='plant'&&!plot){game.plantPlot(state,active.catalog,productId,index);return true;}
    if(tool==='harvest'&&plot?.status==='ready'){game.harvestPlot(state,active.catalog,index);return true;}
    return false;
  });
  function ready(){const s=api.getState();return Boolean(s.valid&&s.result&&!s.result.blocked);}
  function message(text=''){ $('gameNotice').textContent=text; }
  function clearWarehousePickup(){
    clearTimeout(pickupTimer);pickupAmount=0;pickupAt=-Infinity;
    const bubble=$('gameStockFloat');bubble.hidden=true;bubble.classList.remove('show');
  }
  function showWarehousePickup(amount){
    if(amount<=0||!dialog.open)return;
    const now=performance.now();pickupAmount=now-pickupAt<800?pickupAmount+amount:amount;pickupAt=now;
    const used=Object.values(state.inventory).reduce((sum,n)=>sum+n,0),limit=state.settings.warehouseCapacity,bubble=$('gameStockFloat');
    bubble.dataset.tone=used>=limit?'full':used/limit>=.9?'near':'normal';
    bubble.innerHTML=`<b>+${number(pickupAmount)}</b><span>${number(used)} / ${number(limit)}</span>`;
    bubble.hidden=false;bubble.classList.remove('show');void bubble.offsetWidth;bubble.classList.add('show');
    clearTimeout(pickupTimer);pickupTimer=setTimeout(()=>{bubble.hidden=true;bubble.classList.remove('show');},2400);
  }
  function save(force=false){
    if(!state||conflict)return;
    if(!force&&Date.now()-lastSavedAt<5000)return;
    try{store.save(state);lastSavedAt=Date.now();$('gameSaveStatus').textContent='已保存';}
    catch(error){conflict=true;message(error.message);$('gameSaveStatus').textContent='存档未保存 · 请关闭后重新进入';disableActions();}
  }
  function disableActions(){dialog.querySelectorAll('button:not(#gameClose)').forEach(e=>e.disabled=true);}
  function confirm(title,text,action){$('gameConfirmTitle').textContent=title;$('gameConfirmText').textContent=text;confirmAction=action;confirmDialog.showModal();}
  function action(run,text=''){
    if(conflict)return;const produced=state.counters.produced;
    try{pendingMessage='';game.advanceGame(state,active.catalog,active.result);run();game.advanceGame(state,active.catalog,active.result);message(pendingMessage||text);render(true);save(true);}
    catch(error){message(error.message);render(true);}
    finally{showWarehousePickup(state.counters.produced-produced);}
  }
  function open(){
    if(!ready())return;
    state=undefined;store=null;
    try{
      api.hideItemInfo?.();const s=api.getState();active={catalog:s.catalog,result:s.result,level:s.level,filename:s.filename};
      const signature=game.gameSignature(active.catalog,active.result,active.level);
      store=createGameStore(localStorage,signature);const saved=store.load();
      state=saved?game.validateGameSave(saved,active.catalog,active.result):game.createGame(active.catalog,active.result,{level:active.level});
      game.advanceGame(state,active.catalog,active.result);conflict=false;boardStamp=sourceStamp=inventoryStamp=logStamp='';
      $('gameSettingsButton').disabled=$('gameRestart').disabled=$('gameSkipHour').disabled=false;
      dialog.querySelectorAll('[data-game-tab]').forEach(button=>button.disabled=false);
      $('gameProjectMeta').textContent=`Lv ${active.level} · ${active.filename||'当前导入项目'}`;
      clearWarehousePickup();closeCropPicker();mode='production';setMode();message(saved?'':'初始备货已发放');
      if($('orderSimulatorDialog').open)$('orderSimulatorDialog').close();
      render(true);dialog.showModal();save(true);
    }catch(error){
      if(store&&active)confirm('无法恢复经营存档',`${error.message} 可以保留原始存档备份，再按新规则重新开始；不会修改订单拟合配置。`,()=>{
        try{store.recover(game.createGame(active.catalog,active.result,{level:active.level}));open();}catch(recoveryError){api.onError?.(recoveryError.message);}
      });else api.onError?.(error.message);
    }
  }
  function render(force=false){
    if(!state)return;view=game.gameView(state,active.catalog);
    $('gameClock').textContent=clock(state.elapsedMs);$('gameDay').textContent=`第${Math.floor(state.elapsedMs/86400000)+1}天`;
    $('gameMoney').textContent=number(state.money,2);$('gameEarned').textContent=`累计收入 ${number(state.counters.earned,2)}`;
    $('gameStock').innerHTML=`${number(view.inventoryUsed)}<em>/ ${number(view.warehouseCapacity)}</em>`;
    const collectable=view.jobs.filter(j=>j.status==='ready'||j.status==='blocked').length;$('gameStockHint').textContent=collectable?`待收 ${collectable}`:'';
    $('gameDelivered').innerHTML=`${number(state.counters.delivered)}<em>单</em>`;$('gameReadyCount').textContent=`可交付 ${view.board.filter(b=>b.canDeliver).length} 单`;
    $('gameBoardCount').textContent=`· ${view.board.length} 栏`;$('gameRefreshHint').textContent=`刷新等待 ${number(state.settings.refreshMinutes,2)} 分钟`;
    $('gameProductionSummary').textContent=`生产中 ${view.jobs.filter(j=>j.status==='running').length} · 排队 ${view.jobs.filter(j=>j.status==='queued').length} · 待收 ${view.jobs.filter(j=>j.status==='ready'||j.status==='blocked').length}`;
    renderSources(force);renderBoard(force);if(mode==='inventory')renderInventory(force);if(mode==='log')renderLog(force);updateTimers();if(conflict)disableActions();
  }
  const sprout='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 39V23"/><path d="M24 29C11 29 9 19 9 16c10-1 15 4 15 13Z"/><path d="M24 23c0-10 8-15 15-14 0 10-5 16-15 14Z"/><path class="soil" d="M8 40h32"/></svg>';
  function renderSources(force){
    const stamp=JSON.stringify(view.sources.map(s=>[s.id,s.capacity,s.totalSlots]));
    if(force||stamp!==sourceStamp){
      sourceStamp=stamp;
      $('gameSources').innerHTML=view.sources.map(s=>{
        const goods=view.products.filter(p=>p.sourceId===s.id);if(!goods.some(p=>String(p.id)===String(selection[s.id])))selection[s.id]=goods[0]?.id;
        const choices=`<div class="game-product-choices" aria-label="${escape(s.name)}商品选择">${goods.map((p,i)=>`<button type="button" class="game-product-choice${String(p.id)===String(selection[s.id])?' selected':''}" data-game-choose="${escape(p.id)}" aria-pressed="${String(p.id)===String(selection[s.id])}"><span class="game-product-mark" aria-hidden="true" style="--crop-hue:${(i*39+75)%360}">${escape(p.name.slice(0,1))}</span><span class="game-choice-text"><b>${escape(p.name)}</b></span><span class="game-choice-stock" data-game-choice-stock="${escape(p.id)}">${p.quantity}</span></button>`).join('')}</div>`;
        return `<article class="game-source${s.isFarm?' farm':''}" data-game-source="${escape(s.id)}"><div class="game-source-title"><h4>${s.isFarm?'田间':escape(s.name)}</h4><div class="game-capacity"><small data-game-capacity="${escape(s.id)}"></small></div></div>${s.isFarm?'<div class="game-field-grid" data-game-plots role="group" aria-label="农田地块"></div>':`${choices}<div class="game-recipe" data-game-recipe="${escape(s.id)}"></div><div class="game-source-tools game-craft-action"><button class="game-button primary" type="button" data-game-enqueue="${escape(s.id)}">开始制作</button></div><div class="game-fixed-queue" data-game-jobs="${escape(s.id)}" aria-label="${escape(s.name)}生产队列"></div>`}</article>`;
      }).join('');
    }
    for(const s of view.sources){
      const article=[...$('gameSources').children].find(e=>e.dataset.gameSource===s.id);if(!article)continue;
      article.querySelector('[data-game-capacity]').textContent=s.isFarm?`${s.running} 生长 · ${s.ready} 待收 · ${s.capacity-s.running-s.ready} 空地`:`队列 ${view.jobs.filter(j=>j.sourceId===s.id).length}/${s.totalSlots}`;
      for(const p of view.products.filter(p=>p.sourceId===s.id)){const cell=[...article.querySelectorAll('[data-game-choice-stock]')].find(e=>e.dataset.gameChoiceStock===String(p.id));if(cell)cell.textContent=p.quantity;}
      const p=view.products.find(p=>String(p.id)===String(selection[s.id]));
      if(s.isFarm){
        const grid=article.querySelector('[data-game-plots]'),gridStamp=JSON.stringify(view.plots.map(p=>[p.index,p.job?.id,p.job?.status]));
        grid.style.setProperty('--plot-cols',Math.min(6,s.capacity));
        if(grid.dataset.stamp!==gridStamp){grid.dataset.stamp=gridStamp;grid.innerHTML=view.plots.map(({index,job})=>`<button type="button" class="game-plot ${job?.status||'empty'}" data-game-plot="${index}" aria-label="地块${index+1}：${job?escape(job.name)+(job.status==='ready'?'，成熟可收获':'，生长中'):'空地，点击播种'}"><span class="game-plot-number">${index+1}</span>${job?`<span class="game-plot-sprout">${sprout}</span><b>${escape(job.name)}</b><small ${job.status==='running'?`data-game-end="${job.endAt}"`:''}>${job.status==='ready'?'已成熟':duration(job.remainingMs)}</small>${job.status==='running'?`<i class="game-plot-progress"><i data-game-start="${job.startedAt}" data-game-finish="${job.endAt}" style="width:${job.progress*100}%"></i></i>`:''}`:'<span class="game-plot-plus">＋</span><small>空地</small>'}</button>`).join('');}
        for(const cell of grid.querySelectorAll('[data-game-plot]'))cell.classList.toggle('selected',Number(cell.dataset.gamePlot)===(pickerPlot??dragContext?.anchorIndex));
        continue;
      }
      const recipe=article.querySelector('[data-game-recipe]'),recipeStamp=JSON.stringify([p?.id,p?.missing]);
      if(recipe.dataset.stamp!==recipeStamp){recipe.dataset.stamp=recipeStamp;recipe.innerHTML=p?`<div class="game-recipe-heading"><strong>${escape(p.name)}</strong><span>${number(p.stepMinutes,2)}分钟</span></div><div class="game-ingredients">${p.missing.length?p.missing.map(i=>`<button type="button" data-game-locate="${escape(i.id)}" class="game-ingredient ${i.missing?'missing':''}" title="去生产原料"><b>${escape(i.name)}</b><span class="game-stock-count ${i.missing?'short':'enough'}" aria-label="库存 ${i.stock}，需求 ${i.quantity}"><strong>${i.stock}</strong><i>/</i><strong>${i.quantity}</strong></span></button>`).join(''):'<span>无需原料</span>'}</div>`:'';}
      const jobs=view.jobs.filter(j=>j.sourceId===s.id),list=article.querySelector('[data-game-jobs]'),jobStamp=JSON.stringify([s.totalSlots,jobs.map(j=>[j.id,j.status,j.waitingReason])]);
      const make=article.querySelector('[data-game-enqueue]'),full=jobs.length>=s.totalSlots,lacking=p?.missing.some(i=>i.missing>0);
      make.disabled=full||lacking;make.title=full?'队列已满':lacking?'材料不足':'开始制作';
      if(list.dataset.stamp!==jobStamp){
        list.dataset.stamp=jobStamp;
        const rank={running:0,queued:1,ready:2,blocked:2},ordered=[...jobs].sort((a,b)=>rank[a.status]-rank[b.status]||(a.endAt??Infinity)-(b.endAt??Infinity)||a.id-b.id);
        const cell=(job,index)=>{
          const done=job&&(job.status==='ready'||job.status==='blocked'),status=!job?'vacant':done?'ready':job.status;
          const label=!job?'空闲':done?'可收获':job.status==='running'?'制作中':'排队中';
          const body=`<small class="game-slot-state">${label}</small>${job?`<span class="game-slot-product-mark" aria-hidden="true">${escape(job.name.slice(0,1))}</span><b>${escape(job.name)}</b><span class="game-slot-detail" ${job.status==='running'?`data-game-end="${job.endAt}"`:''}>${done?'收获':job.status==='running'?duration(job.remainingMs):escape(job.waitingReason==='缺少原料'?'材料不足':'等待制作')}</span>${job.status==='running'?`<div class="game-progress"><i data-game-start="${job.startedAt}" data-game-finish="${job.endAt}" style="width:${job.progress*100}%"></i></div>`:''}`:'<span class="game-slot-empty" aria-hidden="true">◇</span>'}`;
          return `<li class="game-queue-position">${done?`<button type="button" class="game-queue-slot ready" data-game-claim-source="${escape(s.id)}" aria-label="${escape(job.name)}，可收获，领取本作坊已完成产品">${body}</button>`:`<div class="game-queue-slot ${status}" aria-label="队列第${index+1}格：${job?escape(job.name)+'，':''}${label}">${body}</div>`}</li>`;
        };
        list.innerHTML=`<ol class="game-queue-track" aria-label="${escape(s.name)}统一生产队列" style="--queue-count:${s.totalSlots}">${Array.from({length:s.totalSlots},(_,i)=>cell(ordered[i],i)).join('')}</ol>`;
      }
    }
  }
  function renderBoard(force){
    const stamp=JSON.stringify([state.board,state.inventory,state.money]);if(!force&&stamp===boardStamp)return;boardStamp=stamp;
    $('gameOrders').innerHTML=view.board.map(b=>b.status==='refreshing'?`<article class="game-order game-refreshing" aria-label="订单 ${b.index+1}"><span>刷新中</span><strong data-game-end="${b.readyAt}">${duration(b.remainingMs)}</strong></article>`:`<article class="game-order${b.canDeliver?' deliverable':''}" aria-label="订单 ${b.index+1}"><div class="game-order-top"><b>${b.reward===null?'缺少金币单价':'＋'+number(b.reward,2)+'金'}</b></div><div class="game-order-lines">${b.items.map(i=>`<div class="game-order-line${i.missing?'':' enough'}"><button type="button" data-game-locate="${escape(i.id)}" title="去生产该商品">${escape(i.name)}</button><span class="game-stock-count ${i.missing?'short':'enough'}"><strong>${i.stock}</strong><i>/</i><strong>${i.quantity}</strong></span></div>`).join('')}</div><div class="game-order-metrics">工时 ${number(b.order.cumulativeMinutes,1)}分 · 复杂度 ${b.order.cumulativeComplexity}</div><div class="game-order-actions"><button class="game-button" type="button" data-game-deliver="${b.index}" title="${b.reward===null?'请导入金币单价':b.canDeliver?'交付':'商品未备齐'}" ${b.canDeliver?'':'disabled'}>交付</button><button class="game-button" type="button" data-game-refresh="${b.index}" >刷新</button></div></article>`).join('');
  }
  function renderInventory(force){
    const query=$('gameStockSearch').value.trim().toLowerCase(),stamp=JSON.stringify([state.inventory,state.money,state.settings.warehouseCapacity,query]);if(!force&&stamp===inventoryStamp)return;inventoryStamp=stamp;
    $('gameExpandWarehouse').textContent=`扩容100格 · ${number(view.warehouseUpgradeCost)}金`;$('gameExpandWarehouse').disabled=state.money<view.warehouseUpgradeCost;
    const products=view.products.filter(p=>!query||p.name.toLowerCase().includes(query));
    $('gameStockList').innerHTML=products.length?products.sort((a,b)=>b.quantity-a.quantity||a.level-b.level).map(p=>`<div class="game-stock-row"><div><b>${escape(p.name)}</b><small>${escape(p.isCrop?'作物':p.buildingName||'加工品')} · ${number(p.stepMinutes,2)}分钟</small></div><strong>${number(p.quantity)}</strong><button type="button" data-game-locate="${escape(p.id)}">生产</button><button type="button" data-game-discard="${escape(p.id)}" ${p.quantity?'':'disabled'}>移除</button></div>`).join(''):'<div class="game-empty">没有匹配的商品</div>';
  }
  function renderLog(force){const stamp=JSON.stringify(state.log);if(!force&&stamp===logStamp)return;logStamp=stamp;$('gameLogList').innerHTML=[...state.log].reverse().map(l=>`<div><time>${clock(l.at)}</time><span>${escape(l.text)}</span></div>`).join('')||'<div class="game-empty">还没有经营记录</div>';}
  function updateTimers(){
    dialog.querySelectorAll('[data-game-end]').forEach(el=>el.textContent=duration(Number(el.dataset.gameEnd)-state.elapsedMs));
    dialog.querySelectorAll('[data-game-finish]').forEach(el=>el.style.width=`${Math.min(100,Math.max(0,(state.elapsedMs-Number(el.dataset.gameStart))/(Number(el.dataset.gameFinish)-Number(el.dataset.gameStart))*100))}%`);
  }
  function setMode(){
    closeCropPicker();finishFieldStroke();
    for(const name of ['production','inventory','log'])$('game'+name[0].toUpperCase()+name.slice(1)+'Pane').hidden=name!==mode;
    dialog.querySelectorAll('[data-game-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.gameTab===mode);b.setAttribute('aria-pressed',String(b.dataset.gameTab===mode));});
  }
  function locate(productId){
    const p=view.products.find(p=>String(p.id)===String(productId));if(!p)return;
    selection[p.sourceId]=p.id;mode='production';setMode();renderSources(true);
    const article=[...$('gameSources').children].find(e=>e.dataset.gameSource===p.sourceId);article?.scrollIntoView({behavior:'smooth',block:'nearest'});[...article?.querySelectorAll('[data-game-choose]')||[]].find(e=>e.dataset.gameChoose===String(p.id))?.focus();
  }
  const harvestIcon='<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M20 33V15a4 4 0 0 1 8 0v14-19a4 4 0 0 1 8 0v19-16a4 4 0 0 1 8 0v18-10a4 4 0 0 1 8 0v19c0 12-7 19-18 19-9 0-13-5-17-12l-8-13a4 4 0 0 1 7-5l7 9"/></svg>';
  function closeCropPicker(){const picker=$('gameCropPicker');picker.hidden=true;pickerPlot=null;dialog.querySelectorAll('.game-plot.selected').forEach(e=>e.classList.remove('selected'));}
  function positionCropPicker(){
    const picker=$('gameCropPicker');if(picker.hidden||pickerPlot==null)return;
    const plot=dialog.querySelector(`[data-game-plot="${pickerPlot}"]`);if(!plot){closeCropPicker();return;}
    const target=plot.getBoundingClientRect(),body=dialog.querySelector('.game-body').getBoundingClientRect(),farm=plot.closest('.game-source.farm').getBoundingClientRect();
    const left=Math.max(10,farm.left+10),right=Math.min(innerWidth-10,farm.right-10),top=Math.max(10,body.top+10),bottom=Math.min(innerHeight-10,body.bottom-10);
    if(target.bottom<=top||target.top>=bottom){closeCropPicker();return;}
    picker.style.maxWidth=`${right-left}px`;picker.style.maxHeight=`${Math.min(320,bottom-top)}px`;
    const box=picker.getBoundingClientRect(),above=target.top-box.height-10,below=target.bottom+10;
    const y=above>=top?above:below+box.height<=bottom?below:target.top-top>bottom-target.bottom?above:below;
    const x=Math.max(left,Math.min(target.left+(target.width-box.width)/2,right-box.width));
    picker.style.left=`${x}px`;picker.style.top=`${Math.max(top,Math.min(y,bottom-box.height))}px`;
  }
  function showCropPicker(index){
    finishFieldStroke();pickerPlot=index;view=game.gameView(state,active.catalog);
    const job=view.plots[index]?.job,picker=$('gameCropPicker');
    const done=job?.status==='ready',growing=job&&!done;
    picker.setAttribute('aria-label',done?'收获作物':growing?'作物状态':'选择作物');
    const heading=`<div class="game-picker-heading"><strong>${done?'收获':growing?'生长中':'种植'}</strong><button type="button" data-game-picker-close aria-label="关闭田地操作">×</button></div>`;
    picker.innerHTML=heading+(done?`<button class="game-harvest-tool" type="button" data-game-farm-tool="harvest" aria-label="按住收获工具拖到田地">${harvestIcon}<strong>收获</strong></button>`:growing?`<div class="game-growing-detail">${sprout}<b>${escape(job.name)}</b><span data-game-end="${job.endAt}">${duration(job.remainingMs)}</span></div>`:`<div class="game-crop-options">${view.products.filter(p=>p.isCrop).map((p,i)=>`<button type="button" data-game-farm-tool="plant" data-game-crop="${escape(p.id)}" class="game-crop-option" aria-label="按住${escape(p.name)}拖到田地"><span class="game-product-mark" style="--crop-hue:${(i*39+75)%360}">${sprout}</span><b>${escape(p.name)}</b><small>${number(p.stepMinutes,2)}分钟</small></button>`).join('')}</div>`);
    picker.hidden=false;
    positionCropPicker();
    renderSources(false);
  }
  function plotAtPoint(point){const target=document.elementFromPoint(point.x,point.y)?.closest('[data-game-plot]');return target&&dialog.contains(target)?Number(target.dataset.gamePlot):null;}
  dialog.querySelector('.game-body').addEventListener('scroll',positionCropPicker,{passive:true});
  window.addEventListener('resize',positionCropPicker);
  function hideDragGhost(){const ghost=$('gameDragGhost');ghost.hidden=true;dialog.classList.remove('field-dragging');}
  function finishFieldStroke(){hideDragGhost();pendingFarm=null;dragContext=null;stroke.cancel();if(state&&!conflict)save(true);}
  function showDragGhost(context,point){
    const ghost=$('gameDragGhost');ghost.innerHTML=context.mode==='harvest'?harvestIcon:sprout;ghost.dataset.tool=context.mode;
    ghost.hidden=false;ghost.style.left=`${point.x}px`;ghost.style.top=`${point.y}px`;dialog.classList.add('field-dragging');
  }
  function endFarmGesture(pointerId,force=false){
    const context=pendingFarm||dragContext;if(!context||!force&&context.pointerId!==pointerId)return false;
    const operated=stroke.hasAction,anchor=context.anchorIndex;stroke.end(context.pointerId);pendingFarm=null;dragContext=null;hideDragGhost();
    if(operated)closeCropPicker();else if(dialog.open&&mode==='production'&&!conflict)showCropPicker(anchor);
    render(false);save(true);suppressClickUntil=performance.now()+150;
    if(dialog.hasPointerCapture(context.pointerId))dialog.releasePointerCapture(context.pointerId);return true;
  }
  function fieldMutation(run){
    const produced=state.counters.produced;
    try{game.advanceGame(state,active.catalog,active.result);run();message('');render(false);save();}
    catch(error){endFarmGesture(null,true);message(error.message);render(false);save(true);}
    finally{showWarehousePickup(state.counters.produced-produced);}
  }
  dialog.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.isPrimary===false||conflict)return;suppressClickUntil=0;
    const tool=event.target.closest('[data-game-farm-tool]');
    if(tool){
      event.preventDefault();pendingFarm={pointerId:event.pointerId,mode:tool.dataset.gameFarmTool,productId:tool.dataset.gameCrop,anchorIndex:pickerPlot,start:{x:event.clientX,y:event.clientY}};
      try{dialog.setPointerCapture(event.pointerId);}catch{}return;
    }
    if(!event.target.closest('[data-game-plot]')&&!$('gameCropPicker').contains(event.target))closeCropPicker();
  });
  dialog.addEventListener('pointermove',event=>{
    const context=pendingFarm||dragContext;
    if(conflict||!context||context.pointerId!==event.pointerId)return;
    if(event.buttons===0&&(stroke.active||pendingFarm)){endFarmGesture(event.pointerId,true);return;}
    const point={x:event.clientX,y:event.clientY};
    if(pendingFarm&&pendingFarm.pointerId===event.pointerId){
      if(Math.hypot(point.x-pendingFarm.start.x,point.y-pendingFarm.start.y)<6)return;
      const context=pendingFarm;pendingFarm=null;dragContext=context;selection['__farm__']=context.productId;
      closeCropPicker();stroke.begin({pointerId:event.pointerId,mode:context.mode,productId:context.productId,anchorIndex:context.anchorIndex,point:context.start});
    }
    if(!stroke.active||dragContext.pointerId!==event.pointerId)return;
    event.preventDefault();showDragGhost(dragContext,point);fieldMutation(()=>stroke.move(event.pointerId,point,plotAtPoint));
  });
  dialog.addEventListener('pointerup',event=>{endFarmGesture(event.pointerId);});
  dialog.addEventListener('pointercancel',event=>{endFarmGesture(event.pointerId);});
  dialog.addEventListener('lostpointercapture',event=>{if(stroke.active||pendingFarm)endFarmGesture(event.pointerId);});
  window.addEventListener('blur',()=>{if(stroke.active||pendingFarm)endFarmGesture(null,true);});
  dialog.addEventListener('cancel',event=>{if(!$('gameCropPicker').hidden||stroke.active||pendingFarm){event.preventDefault();closeCropPicker();finishFieldStroke();renderSources(false);}});
  function showSettings(){
    if(conflict)return;const form=$('gameSettingsForm');for(const [name,value] of Object.entries(state.settings))if(name!=='channels'&&form.elements.namedItem(name))form.elements.namedItem(name).value=value;
    form.elements.namedItem('orderSlots').disabled=false;form.elements.namedItem('orderSlots').title='修改订单栏数量后，请使用重新开始应用';
    $('gameChannelSettings').innerHTML=view.sources.filter(s=>!s.isFarm).map(s=>`<label>${escape(s.name)}<input type="number" data-game-channel="${escape(s.id)}" min="1" max="20" value="${s.capacity}" required aria-label="${escape(s.name)}并行数"></label>`).join('');
    const farm=view.sources.find(s=>s.isFarm);form.elements.namedItem('landCapacity').value=farm?.capacity??state.settings.landCapacity??6;$('gameLandSettings').textContent=farm?(active.catalog.landsByLevel?.[state.level]?`本级累计土地默认 ${active.catalog.landsByLevel[state.level]} 片；可独立调整试玩数量。`:'当前保存的导入项目未保留累计土地，请手动设置农田数量。'):'';
    $('gameSettingsError').textContent='';settingsDialog.showModal();
  }
  function readSettings(){
    const form=$('gameSettingsForm'),patch={channels:{}};for(const name of ['warehouseCapacity','landCapacity','queueLimit','orderSlots','refreshMinutes','initialStockMultiplier']){const input=form.elements.namedItem(name);if(input.value.trim()==='')throw Error('请完整填写试玩设置。');patch[name]=Number(input.value);}
    form.querySelectorAll('[data-game-channel]').forEach(el=>{patch.channels[el.dataset.gameChannel]=Number(el.value);});return patch;
  }
  $('openManagementGame').onclick=open;$('openGameFromSimulator').onclick=open;
  $('gameClose').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{clearWarehousePickup();closeCropPicker();finishFieldStroke();if(state&&!conflict){game.advanceGame(state,active.catalog,active.result);save(true);}});
  $('gameSkipHour').onclick=()=>action(()=>game.skipGameTime(state,active.catalog,active.result,60),'已跳过1小时');
  $('gameSettingsButton').onclick=showSettings;$('gameCancelSettings').onclick=()=>settingsDialog.close();
  $('gameSettingsForm').onsubmit=event=>{event.preventDefault();if(conflict){$('gameSettingsError').textContent='存档已在其他页面更新，请关闭后重新进入。';return;}try{const patch=readSettings();game.advanceGame(state,active.catalog,active.result);game.updateGameSettings(state,active.catalog,patch);settingsDialog.close();message('试玩设置已更新。');render(true);save(true);}catch(error){$('gameSettingsError').textContent=error.message;}};
  function requestRestart(settings,fromSettings=false){
    if(conflict)return;const restartSettings=structuredClone(settings);
    confirm('重新试玩？','按当前试玩设置重新开始，重置进度并发放初始备货。当前存档会先备份。',()=>{
      if(conflict)return;
      try{
        game.advanceGame(state,active.catalog,active.result);
        const next=game.createGame(active.catalog,active.result,{level:active.level,settings:restartSettings});
        store.backup(state);store.save(next);state=next;lastSavedAt=Date.now();
        if(settingsDialog.open)settingsDialog.close();
        clearWarehousePickup();mode='production';setMode();render(true);message('已重新试玩，原存档已备份。');$('gameSaveStatus').textContent='已保存';
      }catch(error){if(fromSettings&&settingsDialog.open)$('gameSettingsError').textContent=error.message;else message(error.message);}
    });
  }
  $('gameRestart').onclick=()=>requestRestart(state.settings);
  $('gameNewSave').onclick=()=>{
    if(conflict)return;
    try{requestRestart(readSettings(),true);}catch(error){$('gameSettingsError').textContent=error.message;}
  };
  $('gameConfirmCancel').onclick=()=>confirmDialog.close();$('gameConfirmAccept').onclick=()=>{const run=confirmAction;confirmAction=null;confirmDialog.close();run?.();};
  $('gameExpandWarehouse').onclick=()=>action(()=>game.upgradeWarehouse(state,active.catalog));
  $('gameStockSearch').oninput=()=>renderInventory(true);
  dialog.addEventListener('click',event=>{
    if(event.detail>0&&performance.now()<suppressClickUntil&&(event.target===dialog||event.target.closest('[data-game-plot],[data-game-farm-tool]'))){event.preventDefault();return;}
    const button=event.target.closest('button');if(!button||button.disabled||conflict)return;const d=button.dataset;
    if(d.gameTab){mode=d.gameTab;setMode();render(true);}
    else if(d.gameLocate!=null)locate(d.gameLocate);
    else if(d.gameChoose!=null){const p=view.products.find(p=>String(p.id)===d.gameChoose);selection[p.sourceId]=p.id;renderSources(true);}
    else if(d.gamePlot!=null)showCropPicker(Number(d.gamePlot));
    else if(d.gameFarmTool!=null){if(event.detail===0&&pickerPlot!=null){const index=pickerPlot;action(()=>{if(d.gameFarmTool==='plant')game.plantPlot(state,active.catalog,d.gameCrop,index);else game.harvestPlot(state,active.catalog,index);});closeCropPicker();}}
    else if(d.gamePickerClose!=null)closeCropPicker();
    else if(d.gameClaimSource!=null)action(()=>{const result=game.claimBuildingProducts(state,active.catalog,d.gameClaimSource);pendingMessage=result.remaining?`已收获 ${result.harvested} 项，另有 ${result.remaining} 项等待仓库空位。`:`已收获 ${result.harvested} 项成品。`;});
    else if(d.gameEnqueue!=null)action(()=>game.enqueueProduction(state,active.catalog,selection[d.gameEnqueue],1));
    else if(d.gameDeliver!=null)action(()=>game.deliverGameOrder(state,active.catalog,active.result,Number(d.gameDeliver)),'已交付');
    else if(d.gameRefresh!=null)action(()=>game.refreshGameOrder(state,active.catalog,active.result,Number(d.gameRefresh)),'刷新中');
    else if(d.gameUpgrade!=null)action(()=>game.upgradeBuilding(state,active.catalog,d.gameUpgrade));
    else if(d.gameDiscard!=null){const p=view.products.find(p=>String(p.id)===d.gameDiscard);confirm('移除仓库商品？',`移除 ${p.name} × ${p.quantity}，不获得金币。`,()=>action(()=>game.discardInventory(state,active.catalog,p.id,p.quantity)));}
  });
  const timer=setInterval(()=>{if(!dialog.open||!state||conflict)return;try{game.advanceGame(state,active.catalog,active.result);render();save();}catch(error){message(error.message);}},1000);
  window.addEventListener('pagehide',()=>{if(state&&!conflict){try{game.advanceGame(state,active.catalog,active.result);save(true);}catch{}}});
  return {releaseSession(){if(dialog.open)dialog.close();clearWarehousePickup();closeCropPicker();finishFieldStroke();state=undefined;active=undefined;store=null;conflict=false;},sync(){const available=ready();$('openManagementGame').disabled=$('openGameFromSimulator').disabled=!available;$('openManagementGame').title=available?'使用本级配方、土地和拟合概率进行经营试玩':'请先拟合当前等级';},destroy(){clearInterval(timer);}};
}
