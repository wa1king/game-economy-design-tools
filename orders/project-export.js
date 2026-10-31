import {customOrdersAt,normalizeCustomOrders} from './custom-orders.js';
import {ordinaryOrderReward} from './coin-values.js';
const n=value=>Number.isFinite(value)?value:null;
export function dashboardExportSheets(levels){
  const summary=[['等级','状态','平均累计工时分钟','中位累计工时分钟','平均累计复杂度','中位累计复杂度','平均金币奖励','金币奖励统计状态','含作物订单概率','候选订单数','非零订单数','目标累计工时分钟','实际累计工时分钟','目标工时波动%','实际工时波动%','种类最大偏差百分点','来源最大偏差百分点','来源约束','工时形态','问题说明']];
  const sources=[['等级','状态','来源ID','来源名称','来源可用','来源约束','实际工时占比','目标工时占比','目标偏差百分点']];
  const custom=[['等级','状态','定制订单内容','定制订单数','不可用定制订单数','定制平均累计工时分钟','非定制平均累计工时分钟','差值分钟（定制−非定制）','非定制剩余概率','非定制非零订单数','对照状态']];
  const labels={matched:'目标达标',approximate:'近似解',blocked:'需调整',not_fitted:'未拟合 / 结果待更新'};
  for(const row of levels){
    const d=row.dashboard,o=d?.outcome,v=d?.comparison,status=labels[row.status]??row.status;
    const missing=o?.coinRewardCoverage.missingOrderCount;
    summary.push([row.level,status,n(o?.stats.time.mean),n(o?.stats.time.p50),n(o?.stats.complexity.mean),n(o?.stats.complexity.p50),n(o?.stats.coinReward.mean),!o?'待拟合':o.empty?'无非零概率订单':missing?'缺少单价':o.coinRewardCoverage.estimatedProbability>0?'含估算单价':'完整',o&&!o.empty?o.directCropOrderProbability:null,d?.candidateOrders??null,d?.nonZeroOrders??null,n(d?.targetMean),n(d?.actualMean),n(d?.targetSpreadPercent),n(d?.actualSpreadPercent),n(d?.mixMaxDeviationPoints),n(d?.sourceMaxDeviationPoints),row.rawSettings?.sourceEnabled?'启用':'未约束',d?.timeShape??null,row.error??(d?.problems?.join('\n')||null)]);
    for(const s of d?.sources??[])sources.push([row.level,status,s.id,s.name,s.active?'是':'否',s.constrained?'启用':'未约束',n(s.actualShare),n(s.targetShare),n(s.deviationPoints)]);
    custom.push([row.level,status,v?.entries.map(e=>`${e.sequence}. ${e.order?.description??e.id+'（不可用）'}`).join('\n')??'',v?.entries.length??0,v?.invalid??0,n(v?.customMean),n(v?.normalMean),n(v?.delta),o?n(v?.normalMass):null,o?v?.normalCount??null:null,v?.invalid?'含不可用订单':!v?.entries.length?'未配置定制订单':!o?'待拟合':v.normalMean==null?'无非定制概率':'可对照']);
  }
  return [
    {name:'总面板统计',rows:summary,widths:[8,26,22,22,20,20,20,22,20,18,18,22,22,20,20,24,24,18,24,60],headerHeight:48,percentColumns:[9],percentDigits:2,decimalColumns:[3,4,5,6,7,12,13,14,15,16,17],wrapColumns:[20]},
    {name:'来源工时占比',rows:sources,widths:[8,26,16,24,16,18,22,22,24],headerHeight:48,percentColumns:[7,8],percentDigits:2,decimalColumns:[9]},
    {name:'定制工时对照',rows:custom,widths:[8,26,70,18,22,26,28,30,24,24,26],headerHeight:48,percentColumns:[9],percentDigits:2,decimalColumns:[6,7,8],wrapColumns:[3]}
  ];
}
export function projectExportSheets(catalog,project,levels,getTiming=()=>null){
  const products=new Map(catalog.products.map(p=>[p.id,p])),selection=normalizeCustomOrders(project.customOrders,catalog.maxLevel);
  if(levels.reduce((sum,row)=>sum+(row.fit?.orders.length??0),1)>1048576||Object.values(selection.levels).reduce((sum,ids)=>sum+ids.length,1)>1048576)throw Error('订单数量超过 Excel 单表行数上限，请减少导出等级或候选订单。');
  const common=['订单ID','商品内容','商品种类数','最低等级','累计工时分钟','累计复杂度','商品金币总值','订单金币奖励',...Array.from({length:3},(_,i)=>[`商品${i+1}ID`,`商品${i+1}名称`,`商品${i+1}数量`]).flat()];
  const commonRow=o=>[o.id,o.description,o.itemTypes,o.minimumLevel,o.cumulativeMinutes,o.cumulativeComplexity,n(o.coinValue),ordinaryOrderReward(o,products),...Array.from({length:3},(_,i)=>{const item=o.items[i];return item?[item.id,products.get(item.id)?.name??'',item.quantity]:[null,null,null];}).flat()];
  const probability=[['等级',...common,'生成概率','生成权重','权重总数','可生成',...catalog.sources.map(s=>s.name+'工时分钟')]],custom=[['等级','任务顺序',...common,'优化时间分钟','排产下界分钟','可行完工时间分钟','排产状态',...catalog.sources.map(s=>s.name+'工时分钟')]],summary=[['等级','概率订单状态','概率订单数量','定制任务数量','定制可用数量','定制不可用数量','累计工时目标分钟','工时波动比例%','来源约束','概率权重总数']];
  let unavailable=0;
  for(const entry of levels){
    const {level,status,fit}=entry,chosen=customOrdersAt(catalog,selection,level),valid=chosen.filter(e=>e.order);
    unavailable+=chosen.length-valid.length;
    const labels={matched:'目标达标',approximate:'近似解',blocked:'无法拟合',not_fitted:'未拟合 / 结果待更新'};
    summary.push([level,labels[status]??status,fit?.orders.length??0,chosen.length,valid.length,chosen.length-valid.length,project.configs[level].mean,project.configs[level].spreadPercent,project.configs[level].sourceEnabled?'启用':'关闭',project.probabilityScale]);
    if(fit)for(const o of fit.orders)probability.push([level,...commonRow(o),o.probability,o.relativeWeight,o.weightScale,o.generationAllowed?'是':'否',...o.sourceMinutes]);
    for(const e of valid){const t=getTiming(e.order,level);custom.push([level,e.sequence,...commonRow(e.order),n(t?.optimalMinutes),n(t?.lowerMinutes),n(t?.feasibleMinutes),t?.error?'无法排产：'+t.error:t?.proven?'已证明最优':t?'未证最优':'未计算',...e.order.sourceMinutes]);}
  }
  if(unavailable)throw Error(`有 ${unavailable} 项定制任务在当前等级或规则下不可用，请在“定制订单”中移除后再导出。`);
  return [
    {name:'概率订单',rows:probability,widths:[8,24,48],percentColumns:[common.length+2]},
    {name:'定制订单',rows:custom,widths:[8,12,24,48]},
    {name:'等级配置',rows:summary,widths:[8,26,18,18,18,20,23,21,16,20]},
    ...dashboardExportSheets(levels)
  ];
}
const xml=value=>String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const col=index=>{let text='';for(let i=index+1;i;i=Math.floor((i-1)/26))text=String.fromCharCode(65+(i-1)%26)+text;return text;};
export function worksheetXML(sheet){
  if(sheet.rows.length>1048576)throw Error(`${sheet.name} 超过 Excel 单表行数上限，请减少导出等级或候选订单。`);
  const columns=sheet.rows[0]?.length??1;
  const rowHeight=row=>Math.min(409,Math.max(21,...(sheet.wrapColumns??[]).map(column=>String(row[column-1]??'').split('\n').reduce((lines,line)=>lines+Math.max(1,Math.ceil([...line].reduce((w,c)=>w+(c.charCodeAt(0)>255?2:1),0)/(sheet.widths?.[column-1]??18))),0)*21)));
  const data=sheet.rows.map((row,i)=>`<row r="${i+1}"${i===0?` ht="${sheet.headerHeight??32}" customHeight="1"`:sheet.wrapColumns?.length?` ht="${rowHeight(row)}" customHeight="1"`:''}>${row.map((v,j)=>{
    if(v==null)return '';
    const ref=col(j)+(i+1),style=i===0?1:sheet.percentColumns?.includes(j+1)?(sheet.percentDigits===2?7:3):sheet.integerColumns?.includes(j+1)?4:sheet.wrapColumns?.includes(j+1)?5:sheet.decimalColumns?.includes(j+1)?6:2;
    return typeof v==='number'&&Number.isFinite(v)?`<c r="${ref}" s="${style}"><v>${v}</v></c>`:`<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${col(columns-1)}${Math.max(1,sheet.rows.length)}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="21"/><cols>${Array.from({length:columns},(_,j)=>`<col min="${j+1}" max="${j+1}" width="${sheet.widths?.[j]??18}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData><autoFilter ref="A1:${col(columns-1)}${Math.max(1,sheet.rows.length)}"/></worksheet>`;
}
export async function exportProjectWorkbook(sheets,Zip=globalThis.JSZip){
  if(!Zip)throw Error('Excel 导出组件未加载，请刷新页面。');
  const zip=new Zip(),base='http://schemas.openxmlformats.org/';
  zip.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${base}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${base}package/2006/relationships"><Relationship Id="rId1" Type="${base}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${base}spreadsheetml/2006/main" xmlns:r="${base}officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${base}package/2006/relationships">${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="${base}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="${base}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml',`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${base}spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.000000%"/><numFmt numFmtId="165" formatCode="0.00%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF25715A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  for(let i=0;i<sheets.length;i++)zip.file(`xl/worksheets/sheet${i+1}.xml`,worksheetXML(sheets[i]));
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
