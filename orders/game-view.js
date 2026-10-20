import * as game from './game-engine.js';
import {createGameStore} from './game-storage.js';

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
    <div class="game-head"><div class="game-brand"><span class="game-emblem" aria-hidden="true">禾</span><div><h2 id="managementGameTitle">模拟经营</h2><p id="gameProjectMeta"></p></div></div><div class="game-head-actions"><button class="game-button game-settings-button" id="gameSettingsButton" type="button">试玩设置</button><button class="game-button gm" id="gameSkipHour" type="button">GM · 跳过1小时</button><button class="game-close" id="gameClose" type="button" aria-label="返回订单分析">×</button></div></div>
    <div class="game-stats"><div class="game-stat"><small>经营时间 · 现实 1:1</small><strong id="gameClock">00:00:00</strong><span id="gameDay">第1天</span></div><div class="game-stat"><small>金币</small><strong id="gameMoney">0</strong><span id="gameEarned">累计收入 0</span></div><div class="game-stat"><small>仓库</small><strong id="gameStock">0<em>/ 200</em></strong><span id="gameStockHint">作物手动收获 · 加工自动入库</span></div><div class="game-stat"><small>已交订单</small><strong id="gameDelivered">0<em>单</em></strong><span id="gameReadyCount">可交付 0 单</span></div></div>
    <div class="game-notice" id="gameNotice" role="status" aria-live="polite"></div>
    <div class="game-body"><section class="game-production"><div class="game-section-heading"><nav class="game-tabs" aria-label="经营内容"><button class="active" type="button" data-game-tab="production">生产</button><button type="button" data-game-tab="inventory">仓库</button><button type="button" data-game-tab="log">记录</button></nav><small id="gameProductionSummary"></small></div><div id="gameProductionPane"><div id="gameSources" class="game-source-grid"></div></div><div id="gameInventoryPane" hidden><div class="game-inventory"><div class="game-inventory-tools"><input id="gameStockSearch" aria-label="搜索仓库商品" placeholder="搜索商品"><button class="game-button" type="button" id="gameExpandWarehouse"></button></div><div id="gameStockList" class="game-stock-list"></div></div></div><div id="gameLogPane" hidden><div id="gameLogList" class="game-log"></div></div></section>
    <section class="game-orders-side"><div class="game-section-heading"><h3>订单板 <small id="gameBoardCount"></small></h3><small id="gameRefreshHint"></small></div><div id="gameOrders" class="game-order-grid"></div></section></div>
    <div class="game-savebar"><span id="gameSaveStatus">自动存档 · 离开后继续计时</span><strong id="gameRulesFoot">按拟合概率抽单 · 商品价值 × 5</strong></div>
  </div></dialog>
  <dialog id="gameSettingsDialog" class="game-settings" aria-labelledby="gameSettingsTitle"><h3 id="gameSettingsTitle">试玩设置</h3><p class="game-settings-sub">配方与时间来自导入表；以下为独立的试玩规则。</p><form id="gameSettingsForm"><div class="game-settings-grid">
    <label>仓库容量<input type="number" name="warehouseCapacity" min="1" max="1000000" required></label><label>农田数量<input type="number" name="landCapacity" min="1" max="10000" required></label><label>每建筑等待队列<input type="number" name="queueLimit" min="1" max="100" required></label><label>订单栏数量 · 重开生效<input type="number" name="orderSlots" min="1" max="12" required></label><label>刷新等待 · 分钟<input type="number" name="refreshMinutes" min="0" max="10080" step="any" required></label>
  </div><fieldset class="game-stock-multiplier"><legend>初始备货 · 订单需求的倍数 · 重开生效</legend><div>${[1,2,3].map(n=>`<label><input type="radio" name="initialStockMultiplier" value="${n}" ${n===2?'checked':''}><span>${n} 倍</span></label>`).join('')}</div><small>每种已解锁商品均发放；仓库容量不足时自动扩至可容纳初始物品。</small></fieldset><h4>加工建筑 · 并行生产线</h4><div id="gameChannelSettings" class="game-settings-grid"></div><p id="gameLandSettings" class="game-settings-note"></p><p class="game-settings-note">订单奖励 = 所交商品金币价值 × 5 · 免费刷新 · 免费播种</p><div id="gameSettingsError" class="game-setup-error" role="alert"></div><div class="game-setting-actions"><button id="gameNewSave" type="button" class="game-button danger">重新开始</button><div><button id="gameCancelSettings" type="button" class="game-button">取消</button><button type="submit" class="game-button primary">保存设置</button></div></div></form></dialog>
  <dialog id="gameConfirmDialog" class="game-confirm" aria-labelledby="gameConfirmTitle"><h3 id="gameConfirmTitle"></h3><p id="gameConfirmText"></p><div class="game-confirm-actions"><button class="game-button" type="button" id="gameConfirmCancel">取消</button><button class="game-button primary" type="button" id="gameConfirmAccept">确认</button></div></dialog>`;
  document.querySelector('main').append(root);
  const dialog=$('managementGameDialog'),settingsDialog=$('gameSettingsDialog'),confirmDialog=$('gameConfirmDialog');
  let pendingMessage='',state,active,store,lastSavedAt=0,conflict=false,mode='production',view,confirmAction=null,boardStamp='',sourceStamp='',inventoryStamp='',logStamp='';
  const selection={},batches={},expandedQueues=new Set();
  function ready(){const s=api.getState();return Boolean(s.valid&&s.result&&!s.result.blocked);}
  function message(text=''){ $('gameNotice').textContent=text; }
  function save(force=false){
    if(!state||conflict)return;
    if(!force&&Date.now()-lastSavedAt<5000)return;
    try{store.save(state);lastSavedAt=Date.now();$('gameSaveStatus').textContent='已自动保存 · 离开后继续计时';}
    catch(error){conflict=true;message(error.message);$('gameSaveStatus').textContent='存档未保存 · 请关闭后重新进入';disableActions();}
  }
  function disableActions(){dialog.querySelectorAll('button:not(#gameClose)').forEach(e=>e.disabled=true);}
  function confirm(title,text,action){$('gameConfirmTitle').textContent=title;$('gameConfirmText').textContent=text;confirmAction=action;confirmDialog.showModal();}
  function action(run,text=''){
    if(conflict)return;
    try{pendingMessage='';game.advanceGame(state,active.catalog,active.result);run();game.advanceGame(state,active.catalog,active.result);message(pendingMessage||text);render(true);save(true);}
    catch(error){message(error.message);render(true);}
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
      $('gameSettingsButton').disabled=$('gameSkipHour').disabled=false;
      dialog.querySelectorAll('[data-game-tab]').forEach(button=>button.disabled=false);
      $('gameProjectMeta').textContent=`Lv ${active.level} · ${active.filename||'当前导入项目'}`;
      mode='production';setMode();message(saved?'':'已发放全部商品的 2 倍订单需求备货 · 选作物，点空地播种。');
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
    $('gameClock').textContent=clock(state.elapsedMs);$('gameDay').textContent=`第${Math.floor(state.elapsedMs/86400000)+1}天 · 含GM跳时`;
    $('gameMoney').textContent=number(state.money,2);$('gameEarned').textContent=`累计收入 ${number(state.counters.earned,2)}`;
    $('gameStock').innerHTML=`${number(view.inventoryUsed)}<em>/ ${number(view.warehouseCapacity)}</em>`;
    const blocked=view.jobs.filter(j=>j.status==='blocked').length;$('gameStockHint').textContent=blocked?`${blocked} 项已完成，等待仓库空位`:'作物手动收获 · 加工自动入库';
    $('gameDelivered').innerHTML=`${number(state.counters.delivered)}<em>单</em>`;$('gameReadyCount').textContent=`可交付 ${view.board.filter(b=>b.canDeliver).length} 单`;
    $('gameBoardCount').textContent=`· ${view.board.length} 栏`;$('gameRefreshHint').textContent=`免费换单 · 等待 ${number(state.settings.refreshMinutes,2)} 分钟`;
    $('gameProductionSummary').textContent=`生产中 ${view.jobs.filter(j=>j.status==='running').length} · 等待 ${view.jobs.filter(j=>j.status==='queued').length}`;
    renderSources(force);renderBoard(force);if(mode==='inventory')renderInventory(force);if(mode==='log')renderLog(force);updateTimers();if(conflict)disableActions();
  }
  const sprout='<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 39V23"/><path d="M24 29C11 29 9 19 9 16c10-1 15 4 15 13Z"/><path d="M24 23c0-10 8-15 15-14 0 10-5 16-15 14Z"/><path class="soil" d="M8 40h32"/></svg>';
  function renderSources(force){
    const stamp=JSON.stringify(view.sources.map(s=>[s.id,s.capacity]));
    if(force||stamp!==sourceStamp){
      sourceStamp=stamp;
      $('gameSources').innerHTML=view.sources.map(s=>{
        const goods=view.products.filter(p=>p.sourceId===s.id);if(!goods.some(p=>String(p.id)===String(selection[s.id])))selection[s.id]=goods[0]?.id;
        const qty=batches[s.id]??1;batches[s.id]=qty;
        return `<article class="game-source${s.isFarm?' farm':''}" data-game-source="${escape(s.id)}"><div class="game-source-title"><h4>${s.isFarm?'田间':escape(s.name)}</h4><div class="game-capacity"><small data-game-capacity="${escape(s.id)}"></small>${s.isFarm?'':`<button type="button" class="game-button game-upgrade" data-game-upgrade="${escape(s.id)}" title="增加一条并行生产线">+1并行 · ${number(s.upgradeCost)}金</button>`}</div></div><div class="game-product-choices" aria-label="${escape(s.name)}商品选择">${goods.map((p,i)=>`<button type="button" class="game-product-choice${String(p.id)===String(selection[s.id])?' selected':''}" data-game-choose="${escape(p.id)}" aria-pressed="${String(p.id)===String(selection[s.id])}"><span class="game-product-mark" aria-hidden="true" style="--crop-hue:${(i*39+75)%360}">${s.isFarm?sprout:escape(p.name.slice(0,1))}</span><span class="game-choice-text"><b>${escape(p.name)}</b><small>${number(p.stepMinutes,2)}分钟</small></span><span class="game-choice-stock" data-game-choice-stock="${escape(p.id)}">${p.quantity}</span></button>`).join('')}</div>${s.isFarm?'<div class="game-field-toolbar"><span>点空地播种 · 点成熟作物收获</span><div><button class="game-button" type="button" data-game-plant-free>种满空地</button><button class="game-button primary" type="button" data-game-harvest-all>全部收获</button></div></div><div class="game-field-grid" data-game-plots role="group" aria-label="农田地块"></div>':`<div class="game-recipe" data-game-recipe="${escape(s.id)}"></div><div class="game-source-tools game-craft-action"><label>生产数量<input data-game-batches="${escape(s.id)}" aria-label="${escape(s.name)}生产批数" type="number" min="1" max="1000" value="${qty}"></label><button class="game-button primary" type="button" data-game-enqueue="${escape(s.id)}">加入生产</button></div><div class="game-queue" data-game-jobs="${escape(s.id)}"></div>`}</article>`;
      }).join('');
    }
    for(const s of view.sources){
      const article=[...$('gameSources').children].find(e=>e.dataset.gameSource===s.id);if(!article)continue;
      article.querySelector('[data-game-capacity]').textContent=s.isFarm?`${s.running} 生长 · ${s.ready} 待收 · ${s.capacity-s.running-s.ready} 空地`:`并行 ${s.running+s.blocked}/${s.capacity} · 等待 ${s.queued}/${s.queueLimit}`;
      for(const p of view.products.filter(p=>p.sourceId===s.id)){const cell=[...article.querySelectorAll('[data-game-choice-stock]')].find(e=>e.dataset.gameChoiceStock===String(p.id));if(cell)cell.textContent=p.quantity;}
      const p=view.products.find(p=>String(p.id)===String(selection[s.id]));
      if(s.isFarm){
        const grid=article.querySelector('[data-game-plots]'),gridStamp=JSON.stringify(view.plots.map(p=>[p.index,p.job?.id,p.job?.status]));
        grid.style.setProperty('--plot-cols',Math.min(10,s.capacity));
        if(grid.dataset.stamp!==gridStamp){grid.dataset.stamp=gridStamp;grid.innerHTML=view.plots.map(({index,job})=>`<button type="button" class="game-plot ${job?.status||'empty'}" data-game-plot="${index}" aria-label="地块${index+1}：${job?escape(job.name)+(job.status==='ready'?'，成熟可收获':'，生长中'):'空地，点击播种'}"><span class="game-plot-number">${index+1}</span>${job?`<span class="game-plot-sprout">${sprout}</span><b>${escape(job.name)}</b><small ${job.status==='running'?`data-game-end="${job.endAt}"`:''}>${job.status==='ready'?'点击收获':duration(job.remainingMs)}</small>${job.status==='running'?`<i class="game-plot-progress"><i data-game-start="${job.startedAt}" data-game-finish="${job.endAt}" style="width:${job.progress*100}%"></i></i>`:''}`:'<span class="game-plot-plus">＋</span><small>空地</small>'}</button>`).join('');}
        article.querySelector('[data-game-harvest-all]').disabled=!s.ready;
        article.querySelector('[data-game-plant-free]').disabled=s.running+s.ready>=s.capacity;
        continue;
      }
      const recipe=article.querySelector('[data-game-recipe]'),recipeStamp=JSON.stringify([p?.id,p?.missing]);
      if(recipe.dataset.stamp!==recipeStamp){recipe.dataset.stamp=recipeStamp;recipe.innerHTML=p?`<div class="game-recipe-heading"><strong>${escape(p.name)}</strong><span>${number(p.stepMinutes,2)}分钟 · 产出 ${number(p.outputQuantity)}个</span></div><div class="game-ingredients">${p.missing.length?p.missing.map(i=>`<button type="button" data-game-locate="${escape(i.id)}" class="game-ingredient ${i.missing?'missing':''}" title="去生产原料"><b>${escape(i.name)}</b><span>需要 ${i.quantity} · 库存 ${i.stock}${i.missing?' · 缺'+i.missing:' ✓'}</span></button>`).join(''):'<span>无需原料</span>'}</div>`:'';}
      const jobs=view.jobs.filter(j=>j.sourceId===s.id),list=article.querySelector('[data-game-jobs]'),jobStamp=JSON.stringify(jobs.map(j=>[j.id,j.status,j.waitingReason]));
      if(list.dataset.stamp!==jobStamp){list.dataset.stamp=jobStamp;list.innerHTML=jobs.length?jobs.slice(0,expandedQueues.has(s.id)?jobs.length:6).map(j=>`<div class="game-job ${j.status==='queued'?'waiting':j.status}" title="${escape(j.waitingReason||'生产中')}"><span>${escape(j.name)}</span><span class="game-job-time" ${j.status==='running'?`data-game-end="${j.endAt}"`:''}>${j.status==='running'?duration(j.remainingMs):j.status==='blocked'?'待入库':j.waitingReason}</span>${j.status==='queued'?`<button type="button" class="game-cancel" data-game-cancel="${j.id}" aria-label="取消${escape(j.name)}的等待任务">×</button>`:'<span></span>'}${j.status==='running'?`<div class="game-progress"><i data-game-start="${j.startedAt}" data-game-finish="${j.endAt}" style="width:${j.progress*100}%"></i></div>`:''}</div>`).join('')+(jobs.length>6?`<button type="button" class="game-cancel game-more" data-game-show-queue="${escape(s.id)}">${expandedQueues.has(s.id)?'收起队列':`查看全部 ${jobs.length} 项任务`}</button>`:''):'<div class="game-idle">空闲 · 选择商品开始加工</div>';}
    }
  }
  function renderBoard(force){
    const stamp=JSON.stringify([state.board,state.inventory,state.money]);if(!force&&stamp===boardStamp)return;boardStamp=stamp;
    $('gameOrders').innerHTML=view.board.map(b=>b.status==='refreshing'?`<article class="game-order game-refreshing"><span>订单 ${String(b.index+1).padStart(2,'0')} · 刷新中</span><strong data-game-end="${b.readyAt}">${duration(b.remainingMs)}</strong><small>到时按当前拟合概率补位</small></article>`:`<article class="game-order${b.canDeliver?' deliverable':''}"><div class="game-order-top"><span>订单 ${String(b.index+1).padStart(2,'0')} · ${b.order.itemTypes}种</span><b>${b.reward===null?'缺少金币单价':'＋'+number(b.reward,2)+'金'}</b></div><div class="game-order-lines">${b.items.map(i=>`<div class="game-order-line${i.missing?'':' enough'}"><button type="button" data-game-locate="${escape(i.id)}" title="去生产该商品">${escape(i.name)} ×${i.quantity}</button><span>${i.stock}/${i.quantity}${i.missing?' 缺'+i.missing:' ✓'}</span></div>`).join('')}</div><div class="game-order-metrics">工时 ${number(b.order.cumulativeMinutes,1)}分 · 复杂度 ${b.order.cumulativeComplexity}</div><div class="game-order-actions"><button class="game-button" type="button" data-game-deliver="${b.index}" ${b.canDeliver?'':'disabled'}>${b.reward===null?'待导入金币单价':b.canDeliver?'交付订单':'等待备货'}</button><button class="game-button" type="button" data-game-refresh="${b.index}" >↻ 免费换单</button></div></article>`).join('');
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
    for(const name of ['production','inventory','log'])$('game'+name[0].toUpperCase()+name.slice(1)+'Pane').hidden=name!==mode;
    dialog.querySelectorAll('[data-game-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.gameTab===mode);b.setAttribute('aria-pressed',String(b.dataset.gameTab===mode));});
  }
  function locate(productId){
    const p=view.products.find(p=>String(p.id)===String(productId));if(!p)return;
    selection[p.sourceId]=p.id;mode='production';setMode();renderSources(true);
    const article=[...$('gameSources').children].find(e=>e.dataset.gameSource===p.sourceId);article?.scrollIntoView({behavior:'smooth',block:'nearest'});[...article?.querySelectorAll('[data-game-choose]')||[]].find(e=>e.dataset.gameChoose===String(p.id))?.focus();
  }
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
  $('gameClose').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(state&&!conflict){game.advanceGame(state,active.catalog,active.result);save(true);}});
  $('gameSkipHour').onclick=()=>action(()=>game.skipGameTime(state,active.catalog,active.result,60),'已推进1小时，生产、队列和订单刷新均已结算。');
  $('gameSettingsButton').onclick=showSettings;$('gameCancelSettings').onclick=()=>settingsDialog.close();
  $('gameSettingsForm').onsubmit=event=>{event.preventDefault();if(conflict){$('gameSettingsError').textContent='存档已在其他页面更新，请关闭后重新进入。';return;}try{const patch=readSettings();game.advanceGame(state,active.catalog,active.result);game.updateGameSettings(state,active.catalog,patch);settingsDialog.close();message('试玩设置已更新。');render(true);save(true);}catch(error){$('gameSettingsError').textContent=error.message;}};
  $('gameNewSave').onclick=()=>{
    if(conflict)return;
    const input=$('gameSettingsForm').elements.namedItem('orderSlots');input.disabled=false;
    confirm('重新开始本级经营？','将备份当前存档，再以当前试玩设置、所选倍数备货和1,000金币重新开始。商品、土地与拟合概率保持当前版本。',()=>{
      if(conflict)return;try{const patch=readSettings();patch.orderSlots=Number(input.value);const next=game.createGame(active.catalog,active.result,{level:active.level,settings:patch});store.backup(state);state=next;settingsDialog.close();render(true);save(true);message('已重新开始，上一份存档已备份。');}catch(error){$('gameSettingsError').textContent=error.message;}
    });
  };
  $('gameConfirmCancel').onclick=()=>confirmDialog.close();$('gameConfirmAccept').onclick=()=>{const run=confirmAction;confirmAction=null;confirmDialog.close();run?.();};
  $('gameExpandWarehouse').onclick=()=>action(()=>game.upgradeWarehouse(state,active.catalog));
  $('gameStockSearch').oninput=()=>renderInventory(true);
  dialog.addEventListener('change',event=>{const target=event.target;if(target.dataset.gameBatches!=null)batches[target.dataset.gameBatches]=target.value;});
  dialog.addEventListener('input',event=>{if(event.target.dataset.gameBatches!=null)batches[event.target.dataset.gameBatches]=event.target.value;});
  dialog.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled||conflict)return;const d=button.dataset;
    if(d.gameTab){mode=d.gameTab;setMode();render(true);}
    else if(d.gameLocate!=null)locate(d.gameLocate);
    else if(d.gameChoose!=null){const p=view.products.find(p=>String(p.id)===d.gameChoose);selection[p.sourceId]=p.id;renderSources(true);}
    else if(d.gamePlot!=null)action(()=>{const index=Number(d.gamePlot),plot=view.plots[index];if(!plot.job)game.plantPlot(state,active.catalog,selection['__farm__'],index);else if(plot.job.status==='ready')game.harvestPlot(state,active.catalog,index);else throw Error(`${plot.job.name}还在生长，剩余${duration(plot.job.remainingMs)}。`);});
    else if(d.gameHarvestAll!=null)action(()=>{const result=game.harvestAll(state,active.catalog);if(result.remaining)pendingMessage=`已收获 ${result.harvested} 片，另有 ${result.remaining} 片因仓库满待收。`;});
    else if(d.gameEnqueue!=null)action(()=>game.enqueueProduction(state,active.catalog,selection[d.gameEnqueue],Number(batches[d.gameEnqueue])));
    else if(d.gamePlantFree!=null)action(()=>{const farm=view.sources.find(s=>s.isFarm);const free=farm.capacity-farm.running-farm.ready;if(!free)throw Error('当前没有空闲土地。');game.enqueueProduction(state,active.catalog,selection[farm.id],free);});
    else if(d.gameShowQueue!=null){expandedQueues.has(d.gameShowQueue)?expandedQueues.delete(d.gameShowQueue):expandedQueues.add(d.gameShowQueue);renderSources(true);}
    else if(d.gameCancel!=null)action(()=>game.cancelProduction(state,Number(d.gameCancel)));
    else if(d.gameDeliver!=null)action(()=>game.deliverGameOrder(state,active.catalog,active.result,Number(d.gameDeliver)),'订单已交付，新订单已补位。');
    else if(d.gameRefresh!=null)action(()=>game.refreshGameOrder(state,active.catalog,active.result,Number(d.gameRefresh)),'已免费换单，等待新订单到来。');
    else if(d.gameUpgrade!=null)action(()=>game.upgradeBuilding(state,active.catalog,d.gameUpgrade));
    else if(d.gameDiscard!=null){const p=view.products.find(p=>String(p.id)===d.gameDiscard);confirm('移除仓库商品？',`移除 ${p.name} × ${p.quantity}，不获得金币。`,()=>action(()=>game.discardInventory(state,active.catalog,p.id,p.quantity)));}
  });
  const timer=setInterval(()=>{if(!dialog.open||!state||conflict)return;try{game.advanceGame(state,active.catalog,active.result);render();save();}catch(error){message(error.message);}},1000);
  window.addEventListener('pagehide',()=>{if(state&&!conflict){try{game.advanceGame(state,active.catalog,active.result);save(true);}catch{}}});
  return {sync(){const available=ready();$('openManagementGame').disabled=$('openGameFromSimulator').disabled=!available;$('openManagementGame').title=available?'使用本级配方、土地和拟合概率进行经营试玩':'请先拟合当前等级';},destroy(){clearInterval(timer);}};
}
