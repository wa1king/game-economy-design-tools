import {validateProducts} from './order-engine.js';
import {applyImportedCoinValues} from './coin-values.js';
const clean=value=>String(value??'').trim();
export function readLandsByLevel(plan){
  const headerIndex=plan.findIndex(row=>row?.some(v=>clean(v)==='等级')&&row?.some(v=>clean(v)==='累计土地'));
  if(headerIndex<0)return {};
  const header=plan[headerIndex].map(clean),levelCol=header.indexOf('等级'),landCol=header.indexOf('累计土地'),addedCol=header.indexOf('新增土地');
  const lands={};let running=0,canRebuild=addedCol>=0;
  for(let row=headerIndex+1;row<plan.length;row++){
    const cells=plan[row]||[],rawLevel=cells[levelCol];
    if(clean(rawLevel)===''){if(Object.keys(lands).length)break;continue;}
    const level=Number(rawLevel);if(!Number.isInteger(level)||level<1||level>200)break;
    if(Object.hasOwn(lands,level))throw Error(`等级规划的 Lv ${level} 重复。`);
    const added=cells[addedCol];
    if(canRebuild){if(clean(added)===''||!Number.isInteger(Number(added))||Number(added)<0)canRebuild=false;else running+=Number(added);}
    const raw=cells[landCol],value=clean(raw)!==''?Number(raw):canRebuild?running:NaN;
    if(!Number.isInteger(value)||value<1)throw Error(`Lv ${level} 的累计土地缺失或无效，请在 Excel 重算后导出。`);
    lands[level]=value;
  }
  return lands;
}

export function initialSourceConfig(catalog,level,active){
  const weights=Object.fromEntries(catalog.sources.map(s=>[s.id,1]));
  const farm=catalog.sources.findIndex(s=>s.id===0||s.name==='农田'),lands=catalog.landsByLevel?.[level];
  const applied=farm>=0&&Number.isInteger(lands)&&lands>0;
  if(applied)weights[catalog.sources[farm].id]=lands;
  return {weights,sourceEnabled:applied&&Boolean(active[farm])};
}
export function catalogFromSheets(sheets,filename='加工链路.xlsx'){
  const grid=sheets['01_数值调参'];
  if(!grid)throw Error('缺少「01_数值调参」工作表，请使用加工链路工具导出的 Excel。');
  const cell=(r,c)=>grid[r-1]?.[c-1],plan=sheets['00_等级规划']||[];
  const sources=[],sourceByName=new Map();
  for(let r=28;r<plan.length;r++){
    const [id,name,level]=plan[r]||[];
    if(clean(id)===''||!clean(name)||!Number.isFinite(Number(id)))continue;
    const source={id:Number(id),name:clean(name),level:Number(level)||1,category:Number(id)===0?'田地':'加工'};
    if(sourceByName.has(source.name)||sources.some(s=>s.id===source.id))throw Error(`建筑重复：${source.name}`);
    sources.push(source);sourceByName.set(source.name,source);
  }
  const products=[];
  for(let col=5;col<=(grid[4]?.length||0);col++){
    if(clean(cell(5,col))==='')continue;
    const id=Number(cell(5,col)),name=clean(cell(6,col)),level=Number(cell(7,col)),buildingName=clean(cell(8,col)),stepMinutes=Number(cell(9,col));
    if(!Number.isInteger(id)||!name||!buildingName)throw Error(`第 ${col} 列的商品 ID、名称或建筑缺失。`);
    if(!sourceByName.has(buildingName)){
      let sid=buildingName==='农田'?0:100000+sources.length;while(sources.some(s=>s.id===sid))sid++;
      const source={id:sid,name:buildingName,level:1,category:buildingName==='农田'?'田地':'加工'};sources.push(source);sourceByName.set(buildingName,source);
    }
    const source=sourceByName.get(buildingName);
    if(source.level>level)throw Error(`${name} 的等级早于建筑 ${buildingName}。`);
    const inputs=[];let self=false;
    for(let row=18;row<=grid.length;row++){
      const raw=cell(row,1);if(clean(raw)===''||!Number.isFinite(Number(raw)))continue;
      const value=cell(row,col),quantity=clean(value)===''?0:Number(value);
      if(!Number.isInteger(quantity))throw Error(`${name} 的配方第 ${row} 行必须为整数，不能使用未计算的公式。`);
      if(Number(raw)===id){if(quantity!==1)throw Error(`${name} 的自身产量必须为 1。`);self=true;}
      else {if(quantity>0)throw Error(`${name} 的投入配方应填写负数。`);if(quantity<0)inputs.push({id:Number(raw),quantity:-quantity});}
    }
    if(!self)throw Error(`${name} 缺少自身产量行。`);
    const isCrop=source.id===0||source.name==='农田';
    if(isCrop&&inputs.length)throw Error(`${name} 是作物，不应有加工原料。`);
    if(!isCrop&&!inputs.length)throw Error(`${name} 是加工品，但没有配方。`);
    products.push({id,name,level,buildingId:source.id,buildingName,category:isCrop?'田地作物':'加工品',sourceCategory:isCrop?'田地':'加工',isCrop,stepMinutes,originalBatchYield:1,analysisBatchYield:1,inputs,coproducts:[]});
  }
  if(!products.length)throw Error('未识别到商品，请检查第 5～9 行。');
  const coinValues=applyImportedCoinValues(products,sheets);
  const landsByLevel=readLandsByLevel(plan),plannedLevels=Object.keys(landsByLevel).map(Number);
  const maxLevel=Math.max(...products.map(p=>p.level),...plannedLevels);
  const base={schemaVersion:'order-lab-import-v1',filename,maxLevel,landsByLevel,coinValues,source:{filename,snapshot:'用户导入'},products,sources,assumptions:['从 01_数值调参 的原始配方矩阵重算，未依赖 Excel 公式缓存。']};
  validateProducts(base);return base;
}
export async function readChainExcel(file){
  if(!/\.xlsx$/i.test(file.name))throw Error('请选择 .xlsx 文件。');
  if(file.size>20*1024*1024)throw Error('文件超过 20 MB，请缩小商品范围。');
  const zip=await globalThis.JSZip.loadAsync(await file.arrayBuffer(),{checkCRC32:true});
  const xml=async path=>{
    const entry=zip.file(path);if(!entry)throw Error(`Excel 缺少 ${path}`);
    if(entry._data?.uncompressedSize>30*1024*1024)throw Error('工作表过大。');
    const doc=new DOMParser().parseFromString(await entry.async('string'),'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw Error('Excel XML 无法解析。');return doc;
  };
  const tags=(doc,name)=>Array.from(doc.getElementsByTagNameNS('*',name));
  const strings=zip.file('xl/sharedStrings.xml')?tags(await xml('xl/sharedStrings.xml'),'si').map(si=>tags(si,'t').map(t=>t.textContent).join('')):[];
  const workbook=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels');
  const targets=new Map(tags(rels,'Relationship').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
  const sheets={};
  for(const sheet of tags(workbook,'sheet')){
    const name=sheet.getAttribute('name');if(!['01_数值调参','00_等级规划','06_价格配置'].includes(name))continue;
    const rid=sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'),target=targets.get(rid);
    if(!target)throw Error(`工作表 ${name} 的路径缺失。`);
    const parts=(target.startsWith('/')?target.slice(1):'xl/'+target).split('/'),path=[];
    for(const part of parts){if(part==='..')path.pop();else if(part!=='.'&&part)path.push(part);}
    const doc=await xml(path.join('/')),grid=[];
    for(const cell of tags(doc,'c')){
      const ref=cell.getAttribute('r')||'',match=ref.match(/^([A-Z]+)(\d+)$/);if(!match)continue;
      let col=0;for(const char of match[1])col=col*26+char.charCodeAt(0)-64;const row=Number(match[2])-1;
      if(row>10000||col>1000)continue;
      const type=cell.getAttribute('t'),value=tags(cell,'v')[0]?.textContent;
      let parsed=type==='s'?strings[Number(value)]:type==='inlineStr'?tags(cell,'t').map(t=>t.textContent).join(''):type==='e'?NaN:value==null?undefined:type==='str'?value:Number(value);
      (grid[row]??=[])[col-1]=parsed;
    }
    sheets[name]=grid;
  }
  const base=catalogFromSheets(sheets,file.name);base.source.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');return base;
}
