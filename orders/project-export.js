import {customOrdersAt,normalizeCustomOrders} from './custom-orders.js';
import {ordinaryOrderReward} from './coin-values.js';
const n=value=>Number.isFinite(value)?value:null;
export function projectExportSheets(catalog,project,levels){
  const products=new Map(catalog.products.map(p=>[p.id,p])),selection=normalizeCustomOrders(project.customOrders,catalog.maxLevel);
  if(levels.reduce((sum,row)=>sum+(row.fit?.orders.length??0),1)>1048576||Object.values(selection.levels).reduce((sum,ids)=>sum+ids.length,1)>1048576)throw Error('订单数量超过 Excel 单表行数上限，请减少导出等级或候选订单。');
  const common=['订单ID','商品内容','商品种类数','最低等级','累计工时分钟','累计复杂度','商品金币总值','订单金币奖励',...Array.from({length:3},(_,i)=>[`商品${i+1}ID`,`商品${i+1}名称`,`商品${i+1}数量`]).flat()];
  const commonRow=o=>[o.id,o.description,o.itemTypes,o.minimumLevel,o.cumulativeMinutes,o.cumulativeComplexity,n(o.coinValue),ordinaryOrderReward(o,products),...Array.from({length:3},(_,i)=>{const item=o.items[i];return item?[item.id,products.get(item.id)?.name??'',item.quantity]:[null,null,null];}).flat()];
  const probability=[['等级',...common,'生成概率','生成权重','权重总数','可生成',...catalog.sources.map(s=>s.name+'工时分钟')]],custom=[['等级','任务顺序',...common,...catalog.sources.map(s=>s.name+'工时分钟')]],summary=[['等级','概率订单状态','概率订单数量','定制任务数量','定制可用数量','定制不可用数量','累计工时目标分钟','工时波动比例%','来源约束','概率权重总数']];
  let unavailable=0;
  for(const entry of levels){
    const {level,status,fit}=entry,chosen=customOrdersAt(catalog,selection,level),valid=chosen.filter(e=>e.order);
    unavailable+=chosen.length-valid.length;
    const labels={matched:'目标达标',approximate:'近似解',blocked:'无法拟合',not_fitted:'未拟合 / 结果待更新'};
    summary.push([level,labels[status]??status,fit?.orders.length??0,chosen.length,valid.length,chosen.length-valid.length,project.configs[level].mean,project.configs[level].spreadPercent,project.configs[level].sourceEnabled?'启用':'关闭',project.probabilityScale]);
    if(fit)for(const o of fit.orders)probability.push([level,...commonRow(o),o.probability,o.relativeWeight,o.weightScale,o.generationAllowed?'是':'否',...o.sourceMinutes]);
    for(const e of valid)custom.push([level,e.sequence,...commonRow(e.order),...e.order.sourceMinutes]);
  }
  if(unavailable)throw Error(`有 ${unavailable} 项定制任务在当前等级或规则下不可用，请在“定制订单”中移除后再导出。`);
  return [
    {name:'概率订单',rows:probability,widths:[8,24,48],percentColumns:[common.length+2]},
    {name:'定制订单',rows:custom,widths:[8,12,24,48]},
    {name:'等级配置',rows:summary,widths:[8,26,18,18,18,20,23,21,16,20]}
  ];
}
const xml=value=>String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const col=index=>{let text='';for(let i=index+1;i;i=Math.floor((i-1)/26))text=String.fromCharCode(65+(i-1)%26)+text;return text;};
export function worksheetXML(sheet){
  if(sheet.rows.length>1048576)throw Error(`${sheet.name} 超过 Excel 单表行数上限，请减少导出等级或候选订单。`);
  const columns=sheet.rows[0]?.length??1;
  const data=sheet.rows.map((row,i)=>`<row r="${i+1}"${i===0?' ht="32" customHeight="1"':''}>${row.map((v,j)=>{
    if(v==null)return '';
    const ref=col(j)+(i+1),style=i===0?1:sheet.percentColumns?.includes(j+1)?3:2;
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
  zip.file('xl/styles.xml',`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${base}spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.000000%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF25715A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  for(let i=0;i<sheets.length;i++)zip.file(`xl/worksheets/sheet${i+1}.xml`,worksheetXML(sheets[i]));
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
