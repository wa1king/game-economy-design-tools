import assert from 'node:assert/strict';
import {parseNumericClipboard,planConfigPaste,prepareConfigCellEdits,createConfigClipboard} from '../orders/config-clipboard.js';
import {setTimeTarget} from '../orders/time-spread.js';
import {createAllLevelPanel} from '../orders/all-level-panel.js';
const columns=['mix0','mix1','mean','spreadPercent','weight0'];
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
test('TSV preserves internal empty cells and row alignment across Excel/Windows newlines',()=>{
  assert.deepEqual(parseNumericClipboard('10\t\t30\r\n\t5\t\r\n'),[['10','','30'],['','5','']]);
  assert.deepEqual(planConfigPaste('1,234.5\t2e2',{level:1,column:2},columns,3).cells,[{level:1,key:'mean',value:1234.5},{level:1,key:'spreadPercent',value:200}]);
  assert.equal(planConfigPaste(' \n',{level:1,column:0},columns,3).cells.length,0);
});
test('pasting rectangles skips locked/empty cells without shifting later columns',()=>{
  const p=planConfigPaste('5\t6\t7\r\n8\t\t10',{level:1,column:0},columns,3,(level,key)=>!(level===1&&key==='mix1'));
  assert.deepEqual(p.cells,[{level:1,key:'mix0',value:5},{level:1,key:'mean',value:7},{level:2,key:'mix0',value:8},{level:2,key:'mean',value:10}]);assert.equal(p.skipped,1);
});
test('a scalar fills the selected rectangle; out-of-bounds or invalid blocks fail before application',()=>{
  const p=planConfigPaste('9',{level:1,column:0},columns,3,()=>true,{top:2,bottom:3,left:2,right:3});assert.equal(p.cells.length,4);assert.deepEqual(p.range,{top:2,bottom:3,left:2,right:3});assert(p.cells.every(c=>c.value===9));
  for(const text of ['2\tbad','2\t-1','2\tInfinity'])assert.throws(()=>planConfigPaste(text,{level:1,column:0},columns,3),/本次未粘贴/);
  assert.throws(()=>planConfigPaste('1\t2',{level:3,column:4},columns,3),/超出/);assert.throws(()=>planConfigPaste('1\n2',{level:3,column:0},columns,3),/超出/);
});
const assign=(c,key,value)=>{if(key==='mean'||key==='spreadPercent')setTimeTarget(c,key,value);else if(key.startsWith('mix'))c.mix[Number(key.slice(3))]=value;else if(key.startsWith('weight')){c.weights[key.slice(6)]=value;c.sourceEnabled=true;}else throw Error('unknown field');};
const config=()=>({revision:3,mix:[20,40,40],mean:100,spreadPercent:30,variance:900,weights:{0:3},sourceEnabled:false});
test('batch edits atomically prepare configs, recalculate variance, preserve raw weights and increment each revision once',()=>{
  const configs={1:config(),2:config()},before=JSON.stringify(configs),edits=[{level:1,key:'mean',value:200},{level:1,key:'spreadPercent',value:50},{level:1,key:'weight0',value:7},{level:2,key:'mix0',value:60}],drafts=prepareConfigCellEdits(configs,edits,assign);
  assert.equal(JSON.stringify(configs),before);assert.equal(drafts.get(1).variance,10000);assert.equal(drafts.get(1).revision,4);assert.equal(drafts.get(1).weights[0],7);assert(drafts.get(1).sourceEnabled);assert.deepEqual(drafts.get(2).mix,[60,40,40]);assert.equal(drafts.get(2).revision,4);
  assert.throws(()=>prepareConfigCellEdits(configs,[edits[0],{level:2,key:'unknown',value:5}],assign),/unknown/);assert.equal(JSON.stringify(configs),before);
  assert.equal(prepareConfigCellEdits(configs,[{level:1,key:'mean',value:100}],assign).size,0);
});
// Isolated cell/event simulation: no access to browser or actual user data.
const handlers={},docHandlers={},cells=new Map(),configs={1:config(),2:config(),3:config()};let busy=false,message='',calls=0,refreshes=0;
const root={addEventListener:(event,handler)=>{handlers[event]=handler;},ownerDocument:{addEventListener:(event,handler)=>{docHandlers[event]=handler;}},querySelector(selector){const m=selector.match(/data-level="(\d+)".*data-key="([^"]+)"/);return m?cells.get(m[1]+':'+m[2])?.input:null;},querySelectorAll(){return [...cells.values()].filter(cell=>cell.classes.size);}};
for(let level=1;level<=3;level++)for(const key of columns){
  const c=configs[level],value=key.startsWith('mix')?c.mix[Number(key.slice(3))]:key.startsWith('weight')?c.weights[0]:c[key],classes=new Set(),cell={classes,classList:{add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x))},querySelector:()=>cell.input};
  cell.input={dataset:{level:String(level),key},type:'number',value:String(value),disabled:level===1&&key==='mix1',closest:selector=>selector==='td'?cell:null,focus(){handlers.focusin({target:this});}};cells.set(level+':'+key,cell);
}
const ui=createConfigClipboard({root,getColumns:()=>columns,getRowCount:()=>3,isBusy:()=>busy,onApply:edits=>{calls++;for(const [level,c] of prepareConfigCellEdits(configs,edits,assign))configs[level]=c;},onRefresh:()=>refreshes++,onMessage:text=>{message=text;}});
const input=(level,key)=>cells.get(level+':'+key).input,select=(level,key,shiftKey=false)=>{handlers.pointerdown({target:input(level,key),button:0,shiftKey,preventDefault(){}});docHandlers.pointerup();};
const paste=(target,text)=>{let prevented=false;handlers.paste({target,clipboardData:{getData:()=>text},preventDefault(){prevented=true;}});assert(prevented);};
test('drag selection copies only input values as TSV, including disabled numeric positions',()=>{
  select(1,'mix0');handlers.pointerdown({target:input(1,'mix0'),button:0});handlers.pointerover({target:input(2,'mean'),buttons:1,preventDefault(){}});docHandlers.pointerup();let clipboard='';handlers.copy({target:input(1,'mix0'),clipboardData:{setData:(type,text)=>{assert.equal(type,'text/plain');clipboard=text;}},preventDefault(){}});
  assert.equal(clipboard,'20\t40\t100\r\n20\t40\t100');assert(cells.get('2:mean').classes.has('matrix-cell-selected'));assert(message.includes('2 行 × 3 列'));
});
test('Shift selection supports scalar fill, locked cells remain unchanged, and refresh runs once',()=>{
  select(1,'mix0');select(2,'mean',true);const before=calls;paste(input(2,'mean'),'12');assert.equal(calls,before+1);assert.equal(configs[1].mix[1],40);assert.equal(configs[1].mix[0],12);assert.equal(configs[2].mean,12);assert.equal(input(2,'mean').value,'12');assert.equal(refreshes,1);assert(message.includes('跳过 1'));
});
test('matrix paste uses the selected top-left, retains blank cells, and changes no checkbox inputs',()=>{
  select(2,'mean');paste(input(2,'mean'),'200\t50\t15\n300\t\t18');assert.equal(configs[2].variance,10000);assert.equal(configs[3].mean,300);assert.equal(configs[3].spreadPercent,30);assert.equal(configs[2].weights[0],15);assert.equal(configs[3].weights[0],18);assert(configs[2].sourceEnabled);assert.equal(configs[3].revision,4);
});
test('invalid paste and fitting lock cannot partially mutate configs or visible inputs',()=>{
  select(1,'mean');let before=JSON.stringify(configs),old=input(1,'mean').value,n=calls;paste(input(1,'mean'),'500\twrong');assert.equal(JSON.stringify(configs),before);assert.equal(input(1,'mean').value,old);assert.equal(calls,n);assert(message.includes('本次未粘贴'));
  busy=true;paste(input(1,'mean'),'700');assert.equal(calls,n);assert(message.includes('正在拟合'));busy=false;
});
test('keyboard focus collapses the old range and Escape clears highlighting',()=>{
  input(3,'weight0').focus();paste(input(3,'weight0'),'4');assert.equal(configs[3].weights[0],4);assert.equal(configs[2].weights[0],15);handlers.keydown({key:'Escape'});assert([...cells.values()].every(c=>!c.classes.size));ui.refresh();
});
test('header-style whole-column selection retains its rectangle while focusing an editable input',()=>{
  assert(ui.selectRange({top:1,bottom:3,left:1,right:1}));assert.deepEqual(ui.getRange(),{top:1,bottom:3,left:1,right:1});
  paste(input(2,'mix1'),'25');assert.equal(configs[1].mix[1],40);assert.equal(configs[2].mix[1],25);assert.equal(configs[3].mix[1],25);assert.equal(configs[2].mean,200);
  assert.equal(ui.selectRange({top:1,bottom:4,left:0,right:0}),false);assert.deepEqual(ui.getRange(),{top:1,bottom:3,left:1,right:1});
});
test('row and select-all rectangles copy the exact selected shape without normalized readouts',()=>{
  ui.selectRange({top:2,bottom:2,left:0,right:4});let text='';const copy=()=>handlers.copy({target:root,clipboardData:{setData:(_,v)=>{text=v;}},preventDefault(){}});copy();assert.equal(text.split('\t').length,5);assert.equal(text.split('\r\n').length,1);
  ui.selectRange({top:1,bottom:3,left:0,right:4});copy();assert.equal(text.split('\r\n').length,3);assert(text.split('\r\n').every(row=>row.split('\t').length===5));assert(!text.includes('%'));
});
// Exercise the actual panel's header/row click handlers, using isolated cells.
for(let level=1;level<=3;level++){
  const classes=new Set(),cell={classes,classList:{add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x))},querySelector:()=>cell.input};
  cell.input={dataset:{level:String(level),key:'mix2'},value:String(configs[level].mix[2]),disabled:false,closest:()=>cell,focus(){handlers.focusin({target:this});}};cells.set(level+':mix2',cell);
}
const originalQuery=root.querySelectorAll;root.querySelectorAll=selector=>selector==='[data-select-row]'?[]:originalQuery(selector);
const headerHandlers={},head={addEventListener:(name,fn)=>{headerHandlers[name]=fn;},querySelectorAll:()=>[],querySelector:()=>null},matrixMessage={},feedback={},priorDocument=globalThis.document;
try{
  globalThis.document={getElementById:id=>({allConfigHead:head,overviewRows:root,matrixMessage,configProblems:feedback})[id]};
  createAllLevelPanel({getCatalog:()=>({maxLevel:3,sources:[{id:0}]}),isBusy:()=>false});
  const click=(where,dataset,shiftKey=false)=>where({target:{closest:()=>({dataset})},shiftKey,preventDefault(){}}),copied=()=>{let text='';handlers.copy({target:root,clipboardData:{setData:(_,v)=>{text=v;}},preventDefault(){}});return text.split('\r\n').map(row=>row.split('\t'));};
  test('actual column headers and Shift clicks select contiguous full-height numeric columns',()=>{
    click(headerHandlers.click,{selectColumn:'mean'});let rows=copied();assert.equal(rows.length,3);assert(rows.every(r=>r.length===1));assert.equal(rows[1][0],'200');
    click(headerHandlers.click,{selectColumn:'weight0'},true);rows=copied();assert(rows.every(r=>r.length===3));assert.equal(rows[1][2],'15');
  });
  test('actual level cells, grouped headings and corner select rows, field groups and all numeric cells',()=>{
    click(handlers.click,{selectRow:'2'});let rows=copied();assert.equal(rows.length,1);assert.equal(rows[0].length,6);
    click(handlers.click,{selectRow:'3'},true);assert.equal(copied().length,2);
    click(headerHandlers.click,{selectGroup:'mix0 mix1 mix2'});rows=copied();assert.equal(rows.length,3);assert(rows.every(r=>r.length===3));
    click(headerHandlers.click,{selectAll:''});rows=copied();assert.equal(rows.length,3);assert(rows.every(r=>r.length===6));assert(matrixMessage.textContent.includes('3 行 × 6 列'));
  });
}finally{if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;}
console.log(count+' config clipboard checks passed');
