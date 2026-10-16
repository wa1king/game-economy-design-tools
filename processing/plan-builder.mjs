function recordWorkbook(){
 const operations=[],sheets=[];
 const makeSheet=name=>{
  const sheet={name,maxRow:1,maxCol:1};sheets.push(sheet);
  const record=(range,path,value)=>operations.push({sheet:name,range,path,value});
  const style=(range,path=[])=>new Proxy({}, {get(_,key){return style(range,[...path,key])},set(_,key,value){record(range,['format',...path,key],value);return true;}});
  sheet.getRangeByIndexes=(row,col,h=1,w=1)=>{
   if(!Number.isFinite(h)||!Number.isFinite(w))throw Error('Invalid workbook range');
   sheet.maxRow=Math.max(sheet.maxRow,row+h);sheet.maxCol=Math.max(sheet.maxCol,col+w);
   const range=[row+1,col+1,h,w];
   return new Proxy({format:style(range),setNumberFormat(value){record(range,['numberFormat'],value)},merge(){record(range,['merge'],true)},conditionalFormats:{add(type,value){record(range,['conditional',type],value)},addCustom(formula,value){record(range,['conditional','custom'],{formula,format:value})}}},{set(target,key,value){record(range,[key],value);target[key]=value;return true;}});
  };
  sheet.getUsedRange=()=>Object.assign(sheet.getRangeByIndexes(0,0,sheet.maxRow,sheet.maxCol),{rowCount:sheet.maxRow,columnCount:sheet.maxCol});
  sheet.freezePanes={freezeRows(value){record(null,['freezeRows'],value)},freezeColumns(value){record(null,['freezeColumns'],value)}};
  return new Proxy(sheet,{set(target,key,value){if(['tabColor','showGridLines'].includes(key))record(null,[key],value);target[key]=value;return true;}});
 };
 return {operations,sheets,worksheets:{add:makeSheet},recalculate(){}};
}

export async function buildWorkbookPlan(D,analysis){
const mode="web";
const buildingOrder=new Map([[0,0],...[...D.buildings].sort((a,b)=>a.level-b.level||a.id-b.id).map((b,i)=>[b.id,i+1])]);
const Turnover=globalThis.ChainTurnover;
const Pricing=globalThis.ChainPricing;
const priceResult=Pricing.evaluate(D,D.pricing),priceConfig=priceResult.config;
if(priceResult.products.some(p=>p.error))throw Error(priceResult.products.find(p=>p.error).name+'：'+priceResult.products.find(p=>p.error).error);
const P=[...D.products];
// New exports match the web matrix; refresh retains the existing workbook layout.
if(mode!=='refresh')P.sort((a,b)=>buildingOrder.get(a.building)-buildingOrder.get(b.building)||a.level-b.level||a.id-b.id);
const N=P.length,byId=new Map(P.map(p=>[p.id,p])),idx=new Map(P.map((p,i)=>[p.id,i]));
const metrics=new Map(analysis.products.map(p=>[p.id,p]));
const wb=recordWorkbook();
const names=['01_数值调参','09b_工序负载','02_优化排程','03_全链计算','00_等级规划'];
const channels='04_渠道耗时';
const turnover='05_周转容量';
const pricing='06_价格配置';
if(mode!=='refresh')names.push(channels,turnover,pricing);
const [main,load,plan,calc,levels]=names,S=Object.fromEntries(names.map(n=>[n,mode==='refresh'?wb.worksheets.getItem(n):wb.worksheets.add(n)]));
const C=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
const last=C(N+3),first=5,matStart=18,matEnd=17+N;
const depthStart=10+N,changedRow=depthStart+N+6,validRow=changedRow+1,fixedRow=changedRow+2,freshRow=changedRow+3,snapshotTime=changedRow+6,snapshotMatrix=changedRow+8,snapshotBom=snapshotMatrix+N+7,taskHeader=N+10;
const r=(s,row,col,h=1,w=1)=>S[s].getRangeByIndexes(row-1,col-1,h,w);
const v=(s,row,col,value)=>r(s,row,col).values=[[value]];
const f=(s,row,col,value)=>r(s,row,col).formulas=[[value]];
const ref=(s,row,col,abs=false)=>`'${s}'!${abs?'$':''}${C(col-1)}${abs?'$':''}${row}`;
const m=(row,j,abs=false)=>ref(main,row,first+j,abs);
const b=(i,j,abs=false)=>ref(calc,7+i,first+j,abs);
const color=p=>p.building?D.buildings.find(x=>x.id===p.building).color:'#E2F0D9';
const Bnames=['农田',...D.buildings.map(x=>x.name)];
const Bchannels=[{id:0,name:'农田',color:'#E2F0D9'},...D.buildings];
function band(s,row,values){r(s,row,1,1,values.length).values=[values];r(s,row,1,1,values.length).format.fill='#344054';r(s,row,1,1,values.length).format.font={name:'Arial',size:10,color:'#FFFFFF',bold:true};r(s,row,1,1,values.length).format.horizontalAlignment='center';}
function border(s,row,col,h,w){r(s,row,col,h,w).format.borders={preset:'all',style:'thin',color:'#E5E9ED'};}
const matrix=P.map((p,i)=>P.map((t,j)=>i===j?1:-(t.inputs.find(([id])=>id===p.id)?.[1]||0)));

if(mode==='refresh'){
 // Preserve the edited workbook, including formatting and all formula areas.
 r(calc,snapshotTime,first,1,N).values=[P.map(p=>p.time)];
 r(calc,snapshotMatrix,first,N,N).values=matrix;
 r(calc,snapshotBom,first,N,N).values=P.map(p=>P.map(t=>metrics.get(t.id).bom_including_target.find(x=>x.id===p.id)?.quantity||0));
 for(let j=0;j<N;j++){
  const p=P[j],a=metrics.get(p.id),s=a.schedule_at_unlock;
  v(plan,5+j,5,s.lower_bound_minutes);v(plan,5+j,6,s.optimal_minutes);v(plan,5+j,8,s.feasible_minutes);
  v(plan,5+j,9,s.proof==='lower_bound_equals_feasible_schedule'?'下界＝可行完工':s.is_proven_optimal?'完整搜索证明':'未证最优');
  f(plan,5+j,7,`=IF('${main}'!$D$3<>"配方有效","待修正",IF(${ref(calc,freshRow,first+j)},${s.is_proven_optimal?'"最新"':'"未证最优"'},"待重算"))`);
 }
 const oldRows=S[plan].getUsedRange().rowCount;
 r(plan,43,1,Math.max(1,oldRows-42),7).clear({applyTo:'contents'});
 let rr=43;
 for(const p of P)for(const t of metrics.get(p.id).schedule_at_unlock.schedule){const resource=t.resource==='土地'?'农田':D.buildings.find(b=>String(b.id)===t.resource)?.name||t.resource;r(plan,rr++,1,1,7).values=[[p.id,p.name,t.name,resource,t.start_minutes,t.end_minutes,t.end_minutes-t.start_minutes]];}
 border(plan,43,1,rr-43,7);
 wb.recalculate();
 for(let j=0;j<N;j++){
  const a=metrics.get(P[j].id),c=first+j;
  if(Math.abs(r(main,10,c).values[0][0]-a.cumulative_total_minutes)>1e-7)throw Error('Refresh cumulative mismatch '+P[j].name);
  if(a.schedule_at_unlock.is_proven_optimal&&Math.abs(r(main,11,c).values[0][0]-a.schedule_at_unlock.optimal_minutes)>1e-7)throw Error('Refresh optimal mismatch '+P[j].name);
  if(r(main,13,c).values[0][0]!==a.depth||r(main,14,c).values[0][0]!==P[j].inputs.length||r(main,15,c).values[0][0]!==a.distinct_product_types_including_target)throw Error('Refresh complexity mismatch '+P[j].name);
 }
 if(r(main,3,4).values[0][0]!=='配方有效')throw Error('Refresh failed: '+r(main,3,4).values[0][0]);
 await(await SpreadsheetFile.exportXlsx(wb)).save(output);console.log(output);process.exit(0);
}

v(main,1,1,'加工链路数值调参');
v(main,2,1,'黄色输入：单步时间、负数配方数量。固定：解锁等级、建筑、每次产1件。');
v(main,3,1,'计算状态');
v(main,4,1,'网页导出已计算当前方案。若在Excel中修改输入，请回网页导入Excel并重算，再导出。');
const labels=[['固定','商品ID',''],['固定','商品',''],['固定','解锁等级','级'],['固定','生产建筑',''],['输入','单步时间','min'],['输出','累计时间','min'],['输出','优化时间','min'],['输出','空仓等待时间','min'],['输出','加工链深度','层'],['输出','单步复杂度','种'],['输出','累计复杂度','种'],['输出','排程状态','']];
r(main,5,1,labels.length,3).values=labels;
v(main,10,4,'含种植与自身');v(main,12,4,'优化－本步');v(main,14,4,'直接原料');v(main,15,4,'全链去重含自身');
for(let j=0;j<N;j++){
 const p=P[j],c=first+j;
 [p.id,p.name,p.level,p.buildingName,p.time].forEach((x,k)=>v(main,5+k,c,x));
 r(main,5,c).dataValidation={rule:{type:'whole',operator:'equal',formula1:p.id}};
 r(main,6,c).dataValidation={rule:{type:'list',values:[p.name]}};
 r(main,7,c).dataValidation={rule:{type:'whole',operator:'equal',formula1:p.level}};
 r(main,8,c).dataValidation={rule:{type:'list',values:[p.buildingName]}};
 f(main,10,c,`=IF($D$3="配方有效",SUMPRODUCT('${calc}'!${C(c-1)}$7:${C(c-1)}$${6+N},'${calc}'!$D$7:$D$${6+N}),"待修正")`);
 f(main,11,c,`=IF(${ref(plan,5+j,7)}="最新",${ref(plan,5+j,6)},${ref(plan,5+j,7)})`);
 f(main,12,c,`=IF(ISNUMBER(${C(c-1)}11),${C(c-1)}11-${C(c-1)}9,${C(c-1)}11)`);
 f(main,13,c,`=IF($D$3="配方有效",${ref(calc,depthStart+N,c)},"待修正")`);
 f(main,14,c,`=IF($D$3="配方有效",COUNTIF(${C(c-1)}${matStart}:${C(c-1)}${matEnd},"<0"),"待修正")`);
 f(main,15,c,`=IF($D$3="配方有效",COUNTIF('${calc}'!${C(c-1)}$7:${C(c-1)}$${6+N},">0"),"待修正")`);
 f(main,16,c,'='+ref(plan,5+j,7));
}
band(main,17,['投入ID','投入商品','等级','生产建筑',...P.map(p=>p.name)]);
r(main,matStart,1,N,4).values=P.map(p=>[p.id,p.name,p.level,p.buildingName]);
r(main,matStart,first,N,N).values=matrix;
v(main,matEnd+2,1,'配方：正1为本品产出，负数为投入件数，空白/0为无投入。作物不填投入。');
v(main,matEnd+3,1,'累计复杂度＝全链去重商品种类，含作物与目标；单步复杂度＝直接投入种类。');
v(main,matEnd+4,1,'底稿：桃源节奏参考版自拟方案，网页支持新增和等级规划；不是桃源原配置。');

// Build: full BOM equals the inverse of the single-yield input/output matrix.
v(calc,1,1,'全链展开与深度计算');
v(calc,2,1,'每列做1件目标：全链数量＝投入产出矩阵的逆矩阵。深度由最多N轮依赖展开计算。');
band(calc,5,['上游ID','上游商品','建筑','本步min',...P.map(p=>p.id)]);
for(let i=0;i<N;i++){
 [P[i].id,P[i].name,P[i].buildingName].forEach((x,k)=>v(calc,7+i,k+1,x));f(calc,7+i,4,'='+m(9,i));
 for(let j=0;j<N;j++)f(calc,6,first+j,'='+m(6,j));
}
f(calc,7,first,`=MINVERSE('${main}'!$E$${matStart}:$${last}$${matEnd})`);
v(calc,depthStart-1,1,'深度迭代');
v(calc,depthStart,1,0);r(calc,depthStart,first,1,N).values=[Array(N).fill(0)];
const depthRows=[];
for(let step=1;step<=N;step++){
 const rr=depthStart+step;v(calc,rr,1,step);
 depthRows.push(P.map((p,j)=>'=MAX('+P.map((q,i)=>`IF(${m(matStart+i,j)}<0,${ref(calc,rr-1,first+i)}+1,0)`).join(',')+')'));
}
r(calc,depthStart+1,first,N,N).formulas=depthRows;
v(calc,changedRow,1,'本品输入变化');v(calc,validRow,1,'输入合法');v(calc,fixedRow,1,'固定信息一致');v(calc,freshRow,1,'全链排程参数一致');v(calc,snapshotTime,1,'排程所用本步时间');
v(calc,snapshotMatrix-1,1,'排程所用原配方');r(calc,snapshotMatrix,first,N,N).values=matrix;
v(calc,snapshotBom-1,1,'排程所用全链数量');
r(calc,snapshotBom,first,N,N).values=P.map(p=>P.map(t=>metrics.get(t.id).bom_including_target.find(x=>x.id===p.id)?.quantity||0));
for(let j=0;j<N;j++){
 const p=P[j],c=first+j;v(calc,snapshotTime,c,p.time);
 f(calc,changedRow,c,'=IF(AND('+[`${m(9,j)}=${ref(calc,snapshotTime,c)}`,...P.map((q,i)=>`${m(matStart+i,j)}=${ref(calc,snapshotMatrix+i,c)}`)].join(',')+'),0,1)');
 const cellvalid=P.map((q,i)=>{
  const cell=m(matStart+i,j);
  if(i===j)return `${cell}=1`;
  if(!p.building||q.level>p.level)return `${cell}=0`;
  return `IF(ISNUMBER(${cell}),AND(${cell}<=0,${cell}=INT(${cell})),FALSE)`;
 });
 f(calc,validRow,c,`=AND(ISNUMBER(${m(9,j)}),${m(9,j)}>0,${cellvalid.join(',')}${p.building?`,COUNTIF('${main}'!${C(c-1)}${matStart}:${C(c-1)}${matEnd},"<0")>0`:''})`);
 f(calc,fixedRow,c,`=AND(${m(5,j)}=${p.id},${m(6,j)}="${p.name.replaceAll('"','""')}",${m(7,j)}=${p.level},${m(8,j)}="${p.buildingName.replaceAll('"','""')}")`);
 f(calc,freshRow,c,'=SUM('+P.map((q,i)=>`IF(OR(${b(i,j)}>0,${ref(calc,snapshotBom+i,c)}>0),${ref(calc,changedRow,first+i,true)},0)`).join(',')+')=0');
}
const stable=P.map((p,j)=>`${ref(calc,depthStart+N,first+j)}=${ref(calc,depthStart+N-1,first+j)}`).join(',');
f(main,3,4,`=IF(NOT(AND(${P.map((p,j)=>ref(calc,fixedRow,first+j)).join(',')})),"固定信息被修改",IF(NOT(AND(${P.map((p,j)=>ref(calc,validRow,first+j)).join(',')})),"输入不合法",IF(AND(${stable}),"配方有效","配方循环")))`);

// Exact schedule snapshots belong to this build, with per-chain stale checks.
v(plan,1,1,'优化排程');
v(plan,2,1,'空库存、当级土地并行、每加工建筑1通道、即时操作；仅已证明最优的时间进入01表。');
band(plan,4,['商品ID','商品','固定等级','当级土地','严格下界min','优化时间min','输入状态','可行完工min','证明']);
for(let j=0;j<N;j++){
 const p=P[j],a=metrics.get(p.id),s=a.schedule_at_unlock;
 r(plan,5+j,1,1,9).values=[[p.id,p.name,p.level,a.land_count_at_unlock,s.lower_bound_minutes,s.optimal_minutes,null,s.feasible_minutes,s.proof==='lower_bound_equals_feasible_schedule'?'下界＝可行完工':s.is_proven_optimal?'完整搜索证明':'未证最优']];
 f(plan,5+j,7,`=IF('${main}'!$D$3<>"配方有效","待修正",IF(${ref(calc,freshRow,first+j)},${s.is_proven_optimal?'"最新"':'"未证最优"'},"待重算"))`);
}
v(plan,taskHeader-3,1,'网页导出已计算当前方案；修改Excel后可重新导入网页计算。');
band(plan,taskHeader,['目标ID','目标商品','任务商品','生产资源','开始min','结束min','工序min']);
let taskrow=taskHeader+1;
for(const p of P)for(const t of metrics.get(p.id).schedule_at_unlock.schedule){
 const resource=t.resource==='土地'?'农田':D.buildings.find(b=>String(b.id)===t.resource)?.name||t.resource;
 r(plan,taskrow++,1,1,7).values=[[p.id,p.name,t.name,resource,t.start_minutes,t.end_minutes,t.end_minutes-t.start_minutes]];
}
band(plan,4,['商品ID','商品','固定等级','当级土地','严格下界min','优化时间min','输入状态','可行完工min','证明']);
r(plan,4,12,1,2).values=[['等级','固定土地数量']];r(plan,5,12,20,2).values=Array.from({length:20},(_,i)=>[i+1,D.lands_by_level[i+1]]);
r(plan,28,12,1,2).values=[['加工建筑','固定并行通道']];if(D.buildings.length)r(plan,29,12,D.buildings.length,2).values=D.buildings.map(b=>[b.name,1]);

v(load,1,1,'工序负载观察');
v(load,2,1,'上游全链数量×上游本步时间÷目标本步时间；下方合并同建筑工序。横纵粗线分隔建筑。');
v(load,3,1,'相对负载；农田未除土地数，加工未除通道数，不等于实际整体利用率。');
band(load,5,['上游ID','上游商品','生产建筑','本步min',...P.map(p=>p.id)]);
for(let j=0;j<N;j++){f(load,6,first+j,'='+m(6,j));f(load,7,first+j,'='+m(7,j));}
v(load,7,4,'解锁等级');
for(let i=0;i<N;i++){
 r(load,8+i,1,1,3).values=[[P[i].id,P[i].name,P[i].buildingName]];f(load,8+i,4,'='+m(9,i));
 for(let j=0;j<N;j++)f(load,8+i,first+j,`=IF('${main}'!$D$3="配方有效",${b(i,j)}*$D${8+i}/${m(9,j)},"待修正")`);
}
const groupRow=10+N;
band(load,groupRow,['资源合计','资源','口径','',...P.map(p=>p.name)]);
for(let k=0;k<Bnames.length;k++){
 v(load,groupRow+1+k,1,k?'加工':'种植');v(load,groupRow+1+k,2,Bnames[k]);v(load,groupRow+1+k,3,'同建筑合计');
 const members=P.map((p,i)=>p.buildingName===Bnames[k]?i:null).filter(x=>x!==null);
 for(let j=0;j<N;j++)f(load,groupRow+1+k,first+j,`=IF('${main}'!$D$3="配方有效",SUM(${members.length?members.map(i=>ref(load,8+i,first+j)).join(','):'0'}),"待修正")`);
}


// Same model, arranged by unlock level. No separate inputs or duplicate source.
v(levels,1,1,'等级解锁规划');
v(levels,2,1,'等级、建筑、商品配置来自网页当前方案；累计土地按每级新增量求和。');
band(levels,4,['等级','新增土地','累计土地','新增作物','新增建筑','新增物品']);
for(let level=1;level<=20;level++){
 const ps=P.filter(p=>p.level===level),lands=D.lands_by_level[level];
 r(levels,level+4,1,1,6).values=[[level,level===1?lands:lands-D.lands_by_level[level-1],lands,ps.filter(p=>!p.building).map(p=>p.name).join('、'),D.buildings.filter(b=>b.level===level).map(b=>b.name).join('、'),ps.filter(p=>p.building).map(p=>p.name).join('、')]];
 f(levels,level+4,3,`=SUM(B$5:B${level+4})`);
}
band(levels,28,['建筑ID','建筑名称','解锁等级','颜色']);
if(D.buildings.length)r(levels,29,1,D.buildings.length,4).values=D.buildings.map(b=>[b.id,b.name,b.level,b.color]);
v(levels,27,1,'建筑配置（供重新导入网页识别）');
border(levels,4,1,21,6);if(D.buildings.length)border(levels,28,1,D.buildings.length+1,4);
[9,12,12,30,28,60].forEach((w,i)=>r(levels,1,i+1,Math.max(24,29+D.buildings.length)).format.columnWidth=w);
S[levels].freezePanes.freezeRows(4);S[levels].freezePanes.freezeColumns(3);
r(levels,5,2,20,1).format.fill='#FFF4D6';S[levels].tabColor='#315E48';

// Reference styling: one building palette, thin ordinary grids, strong group boundaries.
for(const n of names){const s=S[n],used=s.getUsedRange();s.showGridLines=false;used.format.font={name:'Arial',size:10,color:'#263B4B'};used.format.rowHeight=22;used.format.verticalAlignment='center';r(n,1,1).format.font={name:'Arial',size:14,bold:true,color:'#263B4B'};r(n,1,1).format.rowHeight=30;r(n,2,1).format.font.color='#6D7F8C';r(n,2,1).format.rowHeight=24;}
for(const n of [main,load,calc]){
 [12,23,9,18,...Array(N).fill(9.5)].forEach((w,i)=>r(n,1,i+1,S[n].getUsedRange().rowCount).format.columnWidth=w);
}
[12,18,13,13,18,18,17,19,24,4,4,19,21].forEach((w,i)=>r(plan,1,i+1,S[plan].getUsedRange().rowCount).format.columnWidth=w);
r(plan,taskHeader-3,1).format.rowHeight=28;
for(const [n,row,w] of [[main,17,N+4],[load,5,N+4],[load,groupRow,N+4],[calc,5,N+4],[plan,4,9],[plan,taskHeader,7]]){
 r(n,row,1,1,w).format.fill='#344054';r(n,row,1,1,w).format.font={name:'Arial',size:10,color:'#FFFFFF',bold:true};r(n,row,1,1,w).format.rowHeight=32;r(n,row,1,1,w).format.horizontalAlignment='center';
}
border(main,5,1,12,N+4);border(main,17,1,N+1,N+4);border(load,5,1,N+3,N+4);border(load,groupRow,1,Bnames.length+1,N+4);border(calc,5,1,N+2,N+4);border(plan,4,1,N+1,9);border(plan,taskHeader,1,taskrow-taskHeader,7);
r(main,5,first,4,N).format.fill='#F2F5F7';r(main,9,first,1,N).format.fill='#FFF4D6';r(main,9,first,1,N).format.font.color='#245D8C';r(main,10,first,7,N).format.fill='#F0F6F3';
r(main,5,first,12,N).format.horizontalAlignment='center';r(main,9,first,4,N).setNumberFormat('0.00');
r(main,13,first,3,N).setNumberFormat('0');r(main,matStart,first,N,N).setNumberFormat('0;-0;;@');
r(main,9,first,1,N).dataValidation={rule:{type:'decimal',operator:'between',formula1:0.01,formula2:100000}};
for(let i=0;i<N;i++)for(let j=0;j<N;j++){
 const target=P[j],up=P[i],cell=r(main,matStart+i,first+j),editable=target.building&&i!==j&&up.level<=target.level;
 cell.format.fill=editable?'#FFF9E8':i===j?'#DDEAF4':'#F1F3F5';
 cell.dataValidation={rule:{type:'whole',operator:editable?'between':'equal',formula1:editable?-100:i===j?1:0,...(editable?{formula2:0}:{})}};
 if(editable)cell.format.font.color='#245D8C';
}
for(let i=0;i<N;i++){
 const p=P[i];r(main,6,first+i).format.fill=color(p);r(main,17,first+i).format.fill=color(p);r(main,17,first+i).format.font.color='#263B4B';r(main,matStart+i,1,1,4).format.fill=color(p);
 r(load,6,first+i).format.fill=color(p);r(load,8+i,1,1,4).format.fill=color(p);
 if(i>0&&p.building!==P[i-1].building){
  r(main,matStart+i,1,1,N+4).format.borders={top:{style:'medium',color:'#8093A0'}};r(main,5,first+i,matEnd-4).format.borders={left:{style:'medium',color:'#8093A0'}};
  r(load,8+i,1,1,N+4).format.borders={top:{style:'medium',color:'#8093A0'}};r(load,5,first+i,N+3).format.borders={left:{style:'medium',color:'#8093A0'}};
 }
}
r(main,matStart,first,N,N).conditionalFormats.add('cellIs',{operator:'lessThan',formula:0,format:{fill:'#FBE5DA',font:{color:'#A34D38'}}});
r(main,11,first,2,N).conditionalFormats.add('containsText',{text:'待',format:{fill:'#FFF1D0',font:{color:'#9B6E23'}}});
r(load,8,first,N,N).setNumberFormat('0.00;-0.00;;@');r(load,8,first,N,N).format.horizontalAlignment='center';
r(load,8,first,N,N).conditionalFormats.add('cellIs',{operator:'greaterThan',formula:1.00000001,format:{fill:'#FBE5DA',font:{color:'#A34D38'}}});
r(load,8,first,N,N).conditionalFormats.addCustom('$A8=E$5',{fill:'#DDEAF4',font:{bold:true,color:'#2F5D7D'}});
r(load,groupRow+1,first,Bnames.length,N).setNumberFormat('0.00');r(load,groupRow+1,first,Bnames.length,N).conditionalFormats.add('cellIs',{operator:'greaterThan',formula:1.00000001,format:{fill:'#FBE5DA',font:{color:'#A34D38'}}});
S[main].freezePanes.freezeRows(17);S[main].freezePanes.freezeColumns(4);S[load].freezePanes.freezeRows(7);S[load].freezePanes.freezeColumns(4);S[plan].freezePanes.freezeRows(4);S[calc].freezePanes.freezeRows(6);S[calc].freezePanes.freezeColumns(4);
S[main].tabColor='#344054';S[load].tabColor='#6E8C7B';

// Channel work minutes reuse the full BOM and live unit times, not elapsed time.
v(channels,1,1,'各渠道累计时间');
v(channels,2,1,'从零做1件：全链工序次数×单步时间，按生产建筑汇总，含目标自身。');
v(channels,3,1,'农田按各地块累计分钟，不除土地数；各渠道合计等于01累计时间。');
band(channels,5,['渠道ID','生产渠道','',...P.map(p=>p.id)]);
for(let j=0;j<N;j++){
 f(channels,6,4+j,'='+m(6,j));f(channels,7,4+j,'='+m(7,j));
 r(channels,6,4+j).format.fill=color(P[j]);
}
v(channels,7,1,'解锁等级');v(channels,7,2,'单位：min');
for(let k=0;k<Bchannels.length;k++){
 const channel=Bchannels[k],row=8+k;
 v(channels,row,1,channel.id);v(channels,row,2,channel.name);r(channels,row,1,1,2).format.fill=channel.color;
 const members=P.map((p,i)=>p.building===channel.id?i:null).filter(i=>i!==null);
 for(let j=0;j<N;j++)f(channels,row,4+j,`=IF('${main}'!$D$3="配方有效",SUM(${members.length?members.map(i=>`${b(i,j)}*${ref(calc,7+i,4,true)}`).join(','):'0'}),"待修正")`);
 r(channels,row,1,1,N+3).format.borders={top:{style:'medium',color:'#8093A0'}};
}
const channelTotalRow=8+Bchannels.length;
v(channels,channelTotalRow,2,'合计');
for(let j=0;j<N;j++)f(channels,channelTotalRow,4+j,`=IF('${main}'!$D$3="配方有效",SUM(${C(j+3)}8:${C(j+3)}${channelTotalRow-1}),"待修正")`);
const channelUsed=S[channels].getUsedRange();channelUsed.format.font={name:'Arial',size:10,color:'#263B4B'};channelUsed.format.rowHeight=24;channelUsed.format.verticalAlignment='center';
r(channels,1,1).format.font={name:'Arial',size:14,bold:true,color:'#263B4B'};r(channels,1,1).format.rowHeight=30;
r(channels,2,1,2,1).format.font.color='#6D7F8C';
[11,23,3,...Array(N).fill(13)].forEach((width,i)=>r(channels,1,i+1,channelTotalRow).format.columnWidth=width);
border(channels,5,1,channelTotalRow-4,N+3);
for(let k=0;k<Bchannels.length;k++)r(channels,8+k,1,1,N+3).format.borders={top:{style:'medium',color:'#8093A0'}};
r(channels,5,1,1,N+3).format.fill='#344054';r(channels,5,1,1,N+3).format.font={name:'Arial',size:10,color:'#FFFFFF',bold:true};
r(channels,5,1,3,N+3).format.horizontalAlignment='center';
r(channels,8,4,Bchannels.length+1,N).setNumberFormat('0.00" min"');r(channels,8,4,Bchannels.length+1,N).format.horizontalAlignment='right';
r(channels,channelTotalRow,1,1,N+3).format.fill='#F0F6F3';r(channels,channelTotalRow,1,1,N+3).format.font.bold=true;
r(channels,channelTotalRow,1,1,N+3).format.borders={top:{style:'medium',color:'#8093A0'}};
for(let j=1;j<N;j++)if(P[j].building!==P[j-1].building)r(channels,5,4+j,channelTotalRow-4).format.borders={left:{style:'medium',color:'#8093A0'}};
S[channels].freezePanes.freezeRows(7);S[channels].freezePanes.freezeColumns(3);S[channels].tabColor='#6E8C7B';

// Direct recipe queue consumption, not recursive BOM quantities.
const queueConfig=Turnover.settings(D),queueBuildings=[...D.buildings].sort((a,b)=>a.level-b.level||a.id-b.id),firstSku=3+queueBuildings.length;
v(turnover,1,1,'各等级商品周转容量');
v(turnover,2,1,'各商品独立最大值不能相加。全仓上限按各建筑总投料最大配方计算。');
v(turnover,3,1,'另计在产位（0/1）');r(turnover,3,1,1,2).merge();v(turnover,3,3,queueConfig.includeActive?1:0);
v(turnover,4,1,'黄色为等待长度。网页修改会覆盖后续等级；Excel各级输入独立。仅计直接加工投料。');
band(turnover,5,['等级','全仓投料上限/件',...queueBuildings.map(b=>b.name+'等待长度'),...P.map(p=>p.name)]);
v(turnover,6,1,'商品/建筑ID');
queueBuildings.forEach((b,k)=>v(turnover,6,3+k,'建筑:'+b.id));P.forEach((p,j)=>v(turnover,6,firstSku+j,p.id));

for(let level=1;level<=20;level++){
 const row=level+6;v(turnover,row,1,level);
 queueBuildings.forEach((b,k)=>v(turnover,row,3+k,queueConfig.queues[b.id][level-1]));
 const validQueues='AND(OR($C$3=0,$C$3=1),'+queueBuildings.map((b,k)=>{const q=C(k+2)+row;return `ISNUMBER(${q}),${q}>=0,MOD(${q},1)=0`}).concat(['TRUE']).join(',')+')';
 function expression(upIndex){return 'SUM('+queueBuildings.map((building,k)=>{
  const candidates=P.map((p,j)=>p.building===building.id?j:null).filter(j=>j!==null);
  const amounts=candidates.map(j=>{
   const count=upIndex===null?'-SUM('+P.map((p,i)=>i!==j?m(matStart+i,j,true):null).filter(Boolean).concat(['0']).join(',')+')':upIndex===j?'0':'-'+m(matStart+upIndex,j,true);
   return `IF(${m(7,j,true)}<=$A${row},${count},0)`;
  });
  return `IF($A${row}>=${building.level},(${C(k+2)}${row}+$C$3)*MAX(0${amounts.length?','+amounts.join(','):''}),0)`;
 }).concat(['0']).join(',')+')'}
 const guard=inner=>`=IF('${main}'!$D$3<>"配方有效","待修正",IF(${validQueues},${inner},"队列待修正"))`;
 const formulas=[guard(expression(null)),...queueBuildings.map(()=>''),...P.map((p,j)=>guard(`IF($A${row}<${m(7,j,true)},"—",${expression(j)})`))];
 // Inputs occupy C onward; only B and SKU columns are formulas.
 f(turnover,row,2,formulas[0]);r(turnover,row,firstSku,1,N).formulas=[formulas.slice(1+queueBuildings.length)];
}
const turnUsed=S[turnover].getUsedRange();turnUsed.format.font={name:'Arial',size:10,color:'#263B4B'};turnUsed.format.rowHeight=25;turnUsed.format.verticalAlignment='center';
r(turnover,1,1).format.font={name:'Arial',size:14,bold:true};r(turnover,1,1).format.rowHeight=30;
r(turnover,5,1,1,firstSku+N-1).format.fill='#344054';r(turnover,5,1,1,firstSku+N-1).format.font={name:'Arial',size:10,bold:true,color:'#FFFFFF'};r(turnover,5,1,1,firstSku+N-1).format.rowHeight=38;r(turnover,5,1,1,firstSku+N-1).format.wrapText=true;r(turnover,5,1,1,firstSku+N-1).format.horizontalAlignment='center';
[10,23,...Array(queueBuildings.length).fill(17),...Array(N).fill(13)].forEach((width,j)=>r(turnover,1,j+1,26).format.columnWidth=width);
r(turnover,3,3).format.fill='#FFF4D6';r(turnover,3,3).format.font.color='#245D8C';
if(queueBuildings.length){r(turnover,7,3,20,queueBuildings.length).format.fill='#FFF4D6';r(turnover,7,3,20,queueBuildings.length).format.font.color='#245D8C'}
r(turnover,7,2,20,1).format.fill='#F0F6F3';r(turnover,7,2,20,1).format.font.bold=true;
r(turnover,7,1,20,firstSku+N-1).setNumberFormat('0');r(turnover,7,2,20,1).setNumberFormat('0" 件"');r(turnover,7,firstSku,20,N).setNumberFormat('0" 件"');
r(turnover,7,firstSku,20,N).format.horizontalAlignment='right';r(turnover,7,1,20,firstSku+N-1).format.borders={insideHorizontal:{style:'thin',color:'#E8EFE8'},insideVertical:{style:'thin',color:'#E5ECE3'}};
for(let j=0;j<N;j++){r(turnover,5,firstSku+j,2,1).format.fill=color(P[j]);r(turnover,5,firstSku+j,2,1).format.font.color='#263B4B';if(!j||P[j].building!==P[j-1].building)r(turnover,5,firstSku+j,22,1).format.borders={left:{style:'medium',color:'#8093A0'}}}
for(const row of [7,12,17,22])r(turnover,row,1,1,firstSku+N-1).format.borders={top:{style:'medium',color:'#8093A0'}};
S[turnover].freezePanes.freezeRows(6);S[turnover].freezePanes.freezeColumns(2);S[turnover].tabColor='#6E8C7B';

// Price inputs and the short, traceable build share one sheet. Existing matrix rows stay fixed.
const timePointEnd=4+priceConfig.timeValues.length,priceSources=[{id:0,name:'田地'},...D.buildings];
const priceHeader=Math.max(timePointEnd,4+priceSources.length)+4,priceStart=priceHeader+1;
const priceRowById=new Map(P.map((p,j)=>[p.id,priceStart+j]));
const mainPriceRow=matEnd+6;
v(pricing,1,1,'价格配置');
v(pricing,2,1,'价格＝INT（原料总价＋本步时间价值×来源系数）。原料使用已取整价格。');
v(pricing,3,1,'缺失时间用线性插值；区间外按端点斜率外推，最低0。黄色为输入。');
r(pricing,4,1,1,2).values=[['时间-s','价值']];
r(pricing,5,1,priceConfig.timeValues.length,2).values=priceConfig.timeValues.map(p=>[p.seconds,p.value]);
r(pricing,4,5,1,3).values=[['来源ID','来源','价值系数']];
r(pricing,5,5,priceSources.length,3).values=priceSources.map(p=>['来源:'+p.id,p.name,priceConfig.sourceCoefficients[String(p.id)]]);
band(pricing,priceHeader,['商品ID','商品','生产来源','时间-s','时间价值','来源系数','原料总价','本步增值','金币价格','时间取值','区间序号','配方状态','价格状态']);
const secondsRange=`$A$5:$A$${timePointEnd}`,valuesRange=`$B$5:$B$${timePointEnd}`;
for(let j=0;j<N;j++){
 const p=P[j],row=priceStart+j,c=first+j,sourceRow=5+priceSources.findIndex(source=>source.id===p.building);
 r(pricing,row,1,1,3).values=[[p.id,p.name,p.buildingName]];
 f(pricing,row,4,`=${m(9,j)}*60`);
 f(pricing,row,11,`=MAX(1,MIN(${priceConfig.timeValues.length-1},COUNTIF(${secondsRange},"<="&(D${row}+0.000001))))`);
 const lowerTime=`INDEX(${secondsRange},K${row})`,upperTime=`INDEX(${secondsRange},K${row}+1)`,lowerValue=`INDEX(${valuesRange},K${row})`,upperValue=`INDEX(${valuesRange},K${row}+1)`;
 f(pricing,row,5,`=IF(ABS(D${row}-${lowerTime})<=0.000001,${lowerValue},IF(ABS(D${row}-${upperTime})<=0.000001,${upperValue},MAX(0,${lowerValue}+(D${row}-${lowerTime})*(${upperValue}-${lowerValue})/(${upperTime}-${lowerTime}))))`);
 f(pricing,row,6,`=$G$${sourceRow}`);
 const inputs=p.inputs.map(([id])=>({row:priceRowById.get(id),cell:m(matStart+idx.get(id),j)}));
 f(pricing,row,12,`=IF(AND(COUNTIF('${main}'!${C(c-1)}${matStart}:${C(c-1)}${matEnd},"<0")=${inputs.length}${inputs.map(input=>`,${input.cell}<0`).join('')}),"当前","待重算")`);
 const ingredients=inputs.length?`SUM(${inputs.map(input=>`-${input.cell}*I${input.row}`).join(',')})`:'0';
 const ready=`AND('${main}'!$D$3="配方有效",L${row}="当前"${inputs.map(input=>`,ISNUMBER(I${input.row})`).join('')})`;
 f(pricing,row,7,`=IF(${ready},${ingredients},"待重算")`);
 f(pricing,row,8,`=E${row}*F${row}`);
 f(pricing,row,9,`=IF(ISNUMBER(G${row}),INT(G${row}+H${row}),G${row})`);
 f(pricing,row,10,`=IF(OR(ABS(D${row}-${lowerTime})<=0.000001,ABS(D${row}-${upperTime})<=0.000001),"配置值",IF(OR(D${row}<$A$5,D${row}>$A$${timePointEnd}),"外推估算","插值估算"))`);
 f(pricing,row,13,`=IF(ISNUMBER(I${row}),IF(OR(J${row}<>"配置值"${inputs.map(input=>`,M${input.row}="含估算"`).join('')}),"含估算","配置值"),"待重算")`);
 f(main,mainPriceRow,c,'='+ref(pricing,row,9));f(main,mainPriceRow+1,c,'='+ref(pricing,row,13));
}
r(main,mainPriceRow,1,2,4).values=[['输出','金币价格','金币',''],['输出','价格状态','','']];
r(main,mainPriceRow,1,2,N+4).format.fill='#F0F6F3';
r(main,mainPriceRow,first,1,N).setNumberFormat('0');r(main,mainPriceRow,first,2,N).format.horizontalAlignment='center';
r(main,mainPriceRow,first,1,N).format.font.bold=true;
r(main,mainPriceRow,1,1,N+4).format.borders={top:{style:'medium',color:'#8093A0'}};
const priceUsed=S[pricing].getUsedRange();priceUsed.format.font={name:'Arial',size:10,color:'#263B4B'};priceUsed.format.rowHeight=24;priceUsed.format.verticalAlignment='center';
r(pricing,1,1).format.font={name:'Arial',size:14,bold:true,color:'#263B4B'};r(pricing,1,1).format.rowHeight=30;
r(pricing,2,1,2,1).format.font.color='#6D7F8C';
[12,22,17,13,13,13,14,14,14,16,11,13,13].forEach((width,j)=>r(pricing,1,j+1,priceStart+N-1).format.columnWidth=width);
for(const [row,col,width] of [[4,1,2],[4,5,3],[priceHeader,1,13]]){r(pricing,row,col,1,width).format.fill='#344054';r(pricing,row,col,1,width).format.font={name:'Arial',size:10,bold:true,color:'#FFFFFF'};r(pricing,row,col,1,width).format.horizontalAlignment='center';r(pricing,row,col,1,width).format.rowHeight=30;}
for(const [row,col,height,width] of [[5,1,priceConfig.timeValues.length,2],[5,7,priceSources.length,1]]){r(pricing,row,col,height,width).format.fill='#FFF4D6';r(pricing,row,col,height,width).format.font.color='#245D8C';r(pricing,row,col,height,width).setNumberFormat('0.00');}
r(pricing,5,1,priceConfig.timeValues.length,1).setNumberFormat('0');
r(pricing,5,1,priceConfig.timeValues.length,1).dataValidation={rule:{type:'decimal',operator:'greaterThan',formula1:0}};
r(pricing,5,2,priceConfig.timeValues.length,1).dataValidation={rule:{type:'decimal',operator:'greaterThanOrEqual',formula1:0}};
r(pricing,5,7,priceSources.length,1).dataValidation={rule:{type:'decimal',operator:'greaterThanOrEqual',formula1:0}};
r(pricing,priceStart,4,N,6).setNumberFormat('0.00');r(pricing,priceStart,9,N,1).setNumberFormat('0" 金币"');
r(pricing,priceStart,9,N,1).format.fill='#F0F6F3';r(pricing,priceStart,9,N,1).format.font.bold=true;
r(pricing,priceStart,1,N,13).format.borders={insideHorizontal:{style:'thin',color:'#E5E9ED'}};
r(pricing,priceStart,10,N,1).conditionalFormats.add('containsText',{text:'估算',format:{fill:'#FFF1D0',font:{color:'#9B6E23'}}});
r(pricing,priceStart,13,N,1).conditionalFormats.add('containsText',{text:'估算',format:{fill:'#FFF1D0',font:{color:'#9B6E23'}}});
v(pricing,priceStart+N+1,1,'修改时间、系数或已有原料数量会重算；增加或删除原料后，请回网页导入Excel重算。');
S[pricing].tabColor='#6E8C7B';

 const caches={};const cache=(sheet,row,col,value)=>{(caches[sheet]??={})[C(col-1)+row]=value};
 cache(main,3,4,'配方有效');
 for(let j=0;j<N;j++){
  const p=P[j],a=metrics.get(p.id),schedule=a.schedule_at_unlock,ready=schedule.is_proven_optimal?'最新':'未证最优',c=first+j;
  [a.cumulative_total_minutes,schedule.is_proven_optimal?schedule.optimal_minutes:'未证最优',schedule.is_proven_optimal?schedule.optimal_minutes-p.time:'未证最优',a.depth,p.inputs.length,a.distinct_product_types_including_target,ready].forEach((value,k)=>cache(main,10+k,c,value));
  cache(plan,5+j,7,ready);
  for(let i=0;i<N;i++){const quantity=a.bom_including_target.find(x=>x.id===P[i].id)?.quantity||0;cache(calc,7+i,c,quantity);cache(load,8+i,c,quantity*P[i].time/p.time);}
  for(let step=1;step<=N;step++)cache(calc,depthStart+step,c,Math.min(a.depth,step));
  for(const [row,value] of [[changedRow,0],[validRow,true],[fixedRow,true],[freshRow,true]])cache(calc,row,c,value);
  for(let k=0;k<Bchannels.length;k++){cache(channels,8+k,4+j,a.resource_minutes[String(Bchannels[k].id)]||0);cache(load,groupRow+1+k,c,(a.resource_minutes[String(Bchannels[k].id)]||0)/p.time);}
  cache(channels,channelTotalRow,4+j,a.cumulative_total_minutes);
  const price=priceResult.products.find(x=>x.id===p.id),row=priceStart+j;
  const interval=Math.max(1,Math.min(priceConfig.timeValues.length-1,priceConfig.timeValues.filter(x=>x.seconds<=price.seconds+0.000001).length));
  const mode=price.estimated?(price.estimateMode==='extrapolation'?'外推估算':'插值估算'):'配置值';
  [price.seconds,price.timeValue,price.coefficient,price.materialCost,price.addedValue,price.price,mode,interval,'当前',price.priceEstimated?'含估算':'配置值'].forEach((value,k)=>cache(pricing,row,4+k,value));
  cache(main,mainPriceRow,c,price.price);cache(main,mainPriceRow+1,c,price.priceEstimated?'含估算':'配置值');
 }
 for(let level=1;level<=20;level++)cache(levels,level+4,3,D.lands_by_level[String(level)]);
 for(const row of Turnover.rows(D)){cache(turnover,row.level+6,2,row.total);for(let j=0;j<N;j++)cache(turnover,row.level+6,firstSku+j,row.capacities.get(P[j].id)??'—');}
 return {names,operations:wb.operations,caches,array:{sheet:calc,row:7,col:first,height:N,width:N}};

}
