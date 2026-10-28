export function parseNumericClipboard(text){
  if(typeof text!=='string'||text.length>2_000_000)throw Error('粘贴内容过大。');
  const rows=text.replace(/\r\n?/g,'\n').split('\n').map(row=>row.split('\t'));
  while(rows.length&&rows.at(-1).every(v=>!v.trim()))rows.pop();
  return rows;
}

export function planConfigPaste(text,start,columns,rowCount,isEditable=()=>true,selection=null){
  let rows=parseNumericClipboard(text);
  if(!rows.length)return {cells:[],skipped:0,range:null};
  if(selection&&rows.length===1&&rows[0].length===1){
    rows=Array.from({length:selection.bottom-selection.top+1},()=>Array(selection.right-selection.left+1).fill(rows[0][0]));
    start={level:selection.top,column:selection.left};
  }
  const width=rows.reduce((max,row)=>Math.max(max,row.length),0);
  if(start.level<1||start.column<0||start.level+rows.length-1>rowCount||start.column+width>columns.length)throw Error('粘贴区域超出可填写的等级或数值列，请缩小区域或调整起点。');
  const cells=[];let skipped=0;
  rows.forEach((row,i)=>row.forEach((raw,j)=>{
    const level=start.level+i,key=columns[start.column+j],text=raw.trim();if(!text)return;
    if(!isEditable(level,key)){skipped++;return;}
    const value=Number(/^\+?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)?text.replaceAll(',',''):text);
    if(!Number.isFinite(value)||value<0)throw Error(`Lv ${level} 第 ${start.column+j+1} 个数值列含无效值“${text.slice(0,24)}”，本次未粘贴；请填写非负数字。`);
    cells.push({level,key,value});
  }));
  return {cells,skipped,range:{top:start.level,bottom:start.level+rows.length-1,left:start.column,right:start.column+width-1}};
}

// Build all changed configurations before committing anything. One paste updates
// each affected level's revision once, even if it changes several columns.
export function prepareConfigCellEdits(configs,cells,assign){
  const drafts=new Map();
  for(const {level,key,value} of cells){
    if(!Number.isInteger(level)||!configs[level]||typeof key!=='string'||!Number.isFinite(value)||value<0)throw Error('粘贴配置包含无效单元格。');
    if(!drafts.has(level))drafts.set(level,structuredClone(configs[level]));
    assign(drafts.get(level),key,value);
  }
  for(const [level,draft] of drafts){
    if(JSON.stringify(draft)===JSON.stringify(configs[level]))drafts.delete(level);
    else draft.revision=(configs[level].revision||0)+1;
  }
  return drafts;
}

export function createConfigClipboard({root,getColumns,getRowCount,isBusy,onApply,onRefresh,onMessage}){
  let anchor=null,end=null,dragging=false;
  const inputAt=(level,column)=>root.querySelector(`input[data-level="${level}"][data-key="${getColumns()[column]}"]`);
  const point=target=>{
    const input=target.closest?.('td')?.querySelector('input[type="number"][data-key]');
    if(!input)return null;const column=getColumns().indexOf(input.dataset.key),level=Number(input.dataset.level);
    return column<0?null:{level,column,input};
  };
  const range=()=>anchor&&end?{top:Math.min(anchor.level,end.level),bottom:Math.max(anchor.level,end.level),left:Math.min(anchor.column,end.column),right:Math.max(anchor.column,end.column)}:null;
  function paint(){
    root.querySelectorAll('.matrix-cell-selected,.matrix-cell-anchor').forEach(cell=>cell.classList.remove('matrix-cell-selected','matrix-cell-anchor'));
    const r=range();if(!r)return;
    for(let level=r.top;level<=r.bottom;level++)for(let col=r.left;col<=r.right;col++)inputAt(level,col)?.closest('td')?.classList.add('matrix-cell-selected');
    inputAt(anchor.level,anchor.column)?.closest('td')?.classList.add('matrix-cell-anchor');
  }
  function refresh(){
    if(anchor&&(!inputAt(anchor.level,anchor.column)||!inputAt(end.level,end.column)))anchor=end=null;
    paint();
  }
  root.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;const p=point(event.target);
    if(!p){anchor=end=null;paint();return;}
    dragging=true;if(!event.shiftKey||!anchor)anchor=p;end=p;
    if(event.shiftKey){event.preventDefault();p.input.focus({preventScroll:true});}paint();
  });
  root.addEventListener('pointerover',event=>{if(!dragging||event.buttons!==1)return;const p=point(event.target);if(p&&(p.level!==end?.level||p.column!==end?.column)){end=p;event.preventDefault();paint();}});
  const finishDrag=()=>{dragging=false;};root.ownerDocument?.addEventListener('pointerup',finishDrag);root.ownerDocument?.addEventListener('pointercancel',finishDrag);
  root.addEventListener('focusin',event=>{if(dragging)return;const p=point(event.target);if(p){anchor=end=p;paint();}});
  root.addEventListener('selectstart',event=>{const r=range();if(dragging&&r&&(r.top!==r.bottom||r.left!==r.right))event.preventDefault();});
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){anchor=end=null;paint();}});
  root.addEventListener('copy',event=>{
    const p=point(event.target);if(!anchor&&p)anchor=end=p;const r=range();if(!r||!event.clipboardData)return;
    const rows=[];for(let level=r.top;level<=r.bottom;level++){const row=[];for(let col=r.left;col<=r.right;col++)row.push(inputAt(level,col)?.value??'');rows.push(row.join('\t'));}
    event.preventDefault();event.clipboardData.setData('text/plain',rows.join('\r\n'));onMessage(`已复制 ${r.bottom-r.top+1} 行 × ${r.right-r.left+1} 列数值`);
  });
  root.addEventListener('paste',event=>{
    const p=point(event.target);if(!p||!event.clipboardData)return;event.preventDefault();
    if(isBusy()){onMessage('正在拟合，请等待完成后再粘贴。');return;}
    try{
      const selected=range(),start=selected?{level:selected.top,column:selected.left}:p;
      const plan=planConfigPaste(event.clipboardData.getData('text/plain'),start,getColumns(),getRowCount(),(level,key)=>{const input=inputAt(level,getColumns().indexOf(key));return Boolean(input&&!input.disabled);},selected);
      if(!plan.cells.length){onMessage(plan.skipped?'粘贴区域内的数值均未开放，未修改。':'没有可粘贴的数值。');return;}
      onApply(plan.cells);
      for(const cell of plan.cells){const input=inputAt(cell.level,getColumns().indexOf(cell.key));if(input)input.value=String(cell.value);}
      anchor={level:plan.range.top,column:plan.range.left};end={level:plan.range.bottom,column:plan.range.right};paint();onRefresh();
      onMessage(`已粘贴 ${plan.cells.length} 个数值${plan.skipped?` · 跳过 ${plan.skipped} 个未开放单元格`:''}`);
    }catch(error){onMessage(error.message);}
  });
  return {refresh};
}
