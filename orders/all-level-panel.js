import {resultFeedback,renderFitProblems} from './fit-feedback.js';
import {normalizedSourceWeights} from './order-engine.js';
import {spreadPercent,actualSpread,spreadInterval} from './time-spread.js';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2});
const scales=[[100,'百分'],[1000,'千分'],[10000,'万分'],[100000,'十万分'],[1000000,'百万分'],[10000000,'千万分'],[0,'原始']];

export function createAllLevelPanel(api){
  const head=document.getElementById('allConfigHead'),body=document.getElementById('overviewRows');
  const field=(level,key,value,label,options='')=>`<input data-level="${level}" data-key="${key}" type="number" min="0" step="any" value="${value}" aria-label="Lv ${level} ${escape(label)}" ${options}>`;
  function rowStatus(level){
    const issue=api.getIssue(level);if(issue)return {text:issue.short,title:issue.message,type:'invalid'};
    const saved=api.getResult(level),fresh=saved?.revision===api.getConfig(level).revision;
    const error=api.getError(level);if(error)return {text:'无法拟合',title:error,type:'invalid'};
    return fresh?{text:saved.result.matched?'目标达标':'近似解',title:'',type:saved.result.matched?'good':'approximate'}:{text:saved?'待更新':'未计算',title:'',type:saved?'pending':''};
  }
  function refreshReadouts(){
    const catalog=api.getCatalog(),problems=[];
    const master=document.getElementById('allSourceEnabled');
    if(master){const enabled=Array.from({length:catalog.maxLevel},(_,i)=>api.getConfig(i+1).sourceEnabled).filter(Boolean).length;master.checked=enabled===catalog.maxLevel;master.indeterminate=enabled>0&&enabled<catalog.maxLevel;master.setAttribute('aria-checked',master.indeterminate?'mixed':String(master.checked));master.disabled=api.isBusy();}
    for(let level=1;level<=catalog.maxLevel;level++){
      const row=body.querySelector(`tr[data-level="${level}"]`);if(!row)continue;
      const c=api.getConfig(level),active=api.getInfo(level).active,ratios=normalizedSourceWeights(catalog.sources.map(s=>Number(c.weights[s.id]??1)),active);
      const sourceToggle=row.querySelector('[data-key=sourceEnabled]');sourceToggle.checked=c.sourceEnabled;sourceToggle.title=c.sourceEnabled?'已启用来源约束':'未启用；修改来源权重自动启用';
      row.querySelectorAll('[data-ratio]').forEach(output=>{const j=Number(output.dataset.ratio);output.textContent=active[j]?number(ratios[j])+'%':'—';});
      const sum=c.mix.reduce((a,b)=>a+b,0),sumEl=row.querySelector('[data-mix-sum]');sumEl.textContent=number(sum)+'%';sumEl.classList.toggle('invalid',Math.abs(sum-100)>1e-7);
      const state=rowStatus(level);if(state.title)problems.push({level,state:state.text,messages:[state.title]});
      const label=row.querySelector('[data-row-status]');label.textContent=state.text;label.title=state.title;label.className='matrix-state '+state.type;
      const saved=api.getResult(level),r=saved?.revision===c.revision?saved.result:null;
      if(r&&!r.matched&&!state.title)problems.push({level,state:'近似解',messages:resultFeedback(r,catalog)});
      row.querySelector('[data-actual-mean]').textContent=r?number(r.mean):'—';row.querySelector('[data-actual-spread]').textContent=r?number(actualSpread(r))+'%':'—';
      const interval=spreadInterval(c);row.querySelector('[data-spread-range]').textContent=interval.every(Number.isFinite)?interval.map(number).join('～')+' 分':'—';
      row.querySelector('select[data-key="probabilityScale"]').querySelector('option[value="0"]').disabled=c.minimumOrderWeight;
    }
    const feedback=document.getElementById('configProblems');feedback.hidden=!problems.length;feedback.innerHTML=renderFitProblems(problems);
  }
  function syncColumn(key,fromLevel){
    for(let level=fromLevel;level<=api.getCatalog().maxLevel;level++){
      const c=api.getConfig(level),row=body.querySelector(`tr[data-level="${level}"]`),el=row?.querySelector(`[data-key="${key}"]`);if(!el)continue;
      const value=key.startsWith('mix')?c.mix[Number(key.slice(3))]:key.startsWith('weight')?(c.weights[key.slice(6)]??1):c[key];
      if(el.type==='checkbox')el.checked=Boolean(value);else el.value=value;
      if(key.startsWith('mix'))el.disabled=api.isBusy()||(!api.getInfo(level).counts[Number(key.slice(3))]&&!value);
    }
    refreshReadouts();
  }
  function render(){
    const catalog=api.getCatalog();
    // An input keystroke must not replace the editor or reset its caret/scroll.
    if(body.contains(document.activeElement)){refreshReadouts();return;}
    const disabled=api.isBusy()?'disabled':'';
    head.innerHTML=`<tr class="group-head"><th rowspan="2" class="frozen-level">等级</th><th rowspan="2">候选</th><th colspan="4">商品种类占比</th><th colspan="2">累计工时目标</th><th colspan="${catalog.sources.length+1}" class="source-group"><span>来源权重 / 目标占比</span></th><th colspan="2">概率设置</th><th colspan="2">拟合结果</th><th rowspan="2" class="frozen-state">状态 / 分析</th></tr><tr class="column-head"><th>1 种 %</th><th>2 种 %</th><th>3 种 %</th><th>合计</th><th>均值 · 分钟</th><th title="标准差 ÷ 均值 × 100%；越小越集中">波动 % / 正态参考</th><th title="修改来源权重自动启用，可手动关闭">约束来源<label class="matrix-all-toggle" title="全选或取消全部等级的来源约束"><input id="allSourceEnabled" type="checkbox" aria-label="全部等级约束来源" ${disabled}>全选</label></th>${catalog.sources.map(s=>`<th>${escape(s.name)}</th>`).join('')}<th>精度</th><th>每单保底</th><th>实际均值</th><th>实际波动 %</th></tr>`;
    body.innerHTML=Array.from({length:catalog.maxLevel},(_,i)=>{
      const level=i+1,c=api.getConfig(level),info=api.getInfo(level);
      return `<tr data-level="${level}"><th class="frozen-level">Lv ${level}</th><td class="matrix-count">${number(info.orders.length)}</td>${c.mix.map((v,j)=>`<td>${field(level,'mix'+j,v,(j+1)+'种商品占比',`${disabled} ${!info.counts[j]&&!v?'disabled':''} max="100"`)}</td>`).join('')}<td class="matrix-sum" data-mix-sum></td><td>${field(level,'mean',c.mean,'累计工时均值',disabled)}</td><td>${field(level,'spreadPercent',Number(spreadPercent(c).toFixed(4)),'工时波动比例',disabled)}<output class="matrix-range" data-spread-range title="均值 ± 标准差；理想正态约68%，非硬性上下限"></output></td><td class="matrix-check"><input type="checkbox" data-level="${level}" data-key="sourceEnabled" aria-label="Lv ${level} 来源参与拟合" ${c.sourceEnabled?'checked':''} ${disabled}></td>${catalog.sources.map((s,j)=>`<td class="matrix-source${info.active[j]?'':' inactive'}">${field(level,'weight'+s.id,c.weights[s.id]??1,s.name+'来源权重',`${disabled} ${!info.active[j]?'disabled':''}`)}<output data-ratio="${j}"></output></td>`).join('')}<td><select data-level="${level}" data-key="probabilityScale" aria-label="Lv ${level} 概率精度" ${disabled}>${scales.map(([value,name])=>`<option value="${value}" ${Number(c.probabilityScale)===value?'selected':''} ${!value&&c.minimumOrderWeight?'disabled':''}>${name}</option>`).join('')}</select></td><td class="matrix-check"><input type="checkbox" data-level="${level}" data-key="minimumOrderWeight" aria-label="Lv ${level} 每单保底" ${c.minimumOrderWeight?'checked':''} ${disabled}></td><td class="matrix-actual" data-actual-mean>—</td><td class="matrix-actual" data-actual-spread>—</td><td class="frozen-state"><span data-row-status></span><button class="text-button" data-open-level="${level}" ${disabled}>查看单级</button></td></tr>`;
    }).join('');
    document.getElementById('allConfigSummary').textContent=`${catalog.maxLevel} 级 · ${catalog.products.length} 商品 · ${catalog.sources.length} 来源 · Ctrl+Enter 向下填充本列（含当前等级）`;
    body.querySelectorAll('input[data-key],select[data-key]').forEach(el=>{el.setAttribute('aria-keyshortcuts','Control+Enter');el.title='Ctrl+Enter：将当前值填入本列当前等级及后续等级';});
    refreshReadouts();
  }
  body.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||!event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||event.repeat)return;
    const el=event.target;if(!el.matches('input[data-key],select[data-key]')||el.disabled||api.isBusy())return;
    event.preventDefault();event.stopPropagation();
    if(el.type==='number'&&(!el.value.trim()||!el.validity.valid||!Number.isFinite(Number(el.value)))){document.getElementById('matrixMessage').textContent='请输入有效值后再向下填充';return;}
    const key=el.dataset.key,value=el.type==='checkbox'?el.checked:Number(el.value),label=(el.getAttribute('aria-label')||key).replace(/^Lv \d+\s*/,'');
    const fromLevel=Number(el.dataset.level);
    api.onFillColumn(key,value,fromLevel);syncColumn(key,fromLevel);document.getElementById('matrixMessage').textContent=`已填充 Lv ${fromLevel}～${api.getCatalog().maxLevel}：${label}`;
  });
  body.addEventListener('input',event=>{
    const el=event.target;if(!el.dataset.key||el.tagName==='SELECT')return;
    api.onEdit(Number(el.dataset.level),el.dataset.key,el.type==='checkbox'?el.checked:Number(el.value));refreshReadouts();
  });
  body.addEventListener('change',event=>{const el=event.target;if(el.tagName==='SELECT'&&el.dataset.key){api.onEdit(Number(el.dataset.level),el.dataset.key,Number(el.value));refreshReadouts();}});
  head.addEventListener('change',event=>{if(event.target.id==='allSourceEnabled'&&!api.isBusy()){api.onSetAllSources(event.target.checked);refreshReadouts();}});
  body.addEventListener('click',event=>{const button=event.target.closest('[data-open-level]');if(button)api.onOpen(Number(button.dataset.openLevel));});
  document.getElementById('configProblems').onclick=event=>{const button=event.target.closest('[data-problem-level]');if(button&&!api.isBusy())api.onAdjust(Number(button.dataset.problemLevel));};
  return {render,refreshReadouts};
}
