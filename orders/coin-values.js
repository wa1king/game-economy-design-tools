const label=v=>String(v??'').replace(/\s/g,'').toUpperCase();
const priceLabels=new Set(['金币价格','金币价值','金币售价','金币单价']);
const isPrice=v=>priceLabels.has(label(v));
const columnName=index=>{let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
const address=(sheet,row,col)=>`${sheet}!${columnName(col)}${row+1}`;
function numericPrice(raw,source){
  if(raw==null||typeof raw==='string'&&raw.trim()==='')return null;
  const value=typeof raw==='number'?raw:typeof raw==='string'?Number(raw):NaN;
  if(!Number.isFinite(value)||value<0)throw Error(`${source} 的金币价格必须是非负数；公式缺少有效结果时，请回加工链路网页重算并导出。`);
  return value;
}
function singleRow(grid,test,sheet,description){
  const matches=[];grid.forEach((row,index)=>{if(row?.slice(0,4).some(test))matches.push(index);});
  if(matches.length>1)throw Error(`${sheet} 的${description}行重复。`);
  return matches[0]??-1;
}

// Read cached per-unit workbook values; never execute formulas or substitute zero.
export function applyImportedCoinValues(products,sheets){
  const grid=sheets['01_数值调参']||[],table=sheets['06_价格配置']||[],known=new Set(products.map(p=>p.id)),records=new Map();
  const priceRow=singleRow(grid,isPrice,'01_数值调参','金币价格');
  const statusRow=singleRow(grid,v=>label(v)==='价格状态','01_数值调参','价格状态');
  const header=table.findIndex(row=>row?.some(v=>label(v)==='商品ID')&&row.some(isPrice));
  if(table.length&&header<0)throw Error('06_价格配置 缺少“商品ID”和“金币价格”列。');
  if(header>=0){
    const idCol=table[header].findIndex(v=>label(v)==='商品ID'),priceCol=table[header].findIndex(isPrice),statusCol=table[header].findIndex(v=>label(v)==='价格状态');
    for(let row=header+1;row<table.length;row++){
      const cells=table[row]||[],raw=cells[idCol];if(raw==null||String(raw).trim()==='')continue;
      const id=Number(raw);if(!Number.isSafeInteger(id)||!known.has(id))continue;
      if(records.has(id))throw Error(`06_价格配置 的商品ID ${id} 重复。`);
      const source=address('06_价格配置',row,priceCol);
      records.set(id,{value:numericPrice(cells[priceCol],source),status:String(cells[statusCol]??'').trim(),source});
    }
  }
  const columns=new Map((grid[4]||[]).flatMap((id,col)=>id!=null&&String(id).trim()!==''&&Number.isSafeInteger(Number(id))?[[Number(id),col]]:[]));
  for(const p of products){
    const col=columns.get(p.id),mainSource=priceRow>=0?address('01_数值调参',priceRow,col):null;
    const main=priceRow>=0?numericPrice(grid[priceRow]?.[col],mainSource):null;
    const other=records.get(p.id),otherValue=other?.value??null;
    if(main!==null&&otherValue!==null&&Math.abs(main-otherValue)>1e-9*Math.max(1,main,otherValue))throw Error(`${p.name} 的金币价格在 ${mainSource} 与 ${other.source} 不一致，请重算后导出。`);
    const chosen=otherValue!==null?other:main!==null?{value:main,source:mainSource,status:String(grid[statusRow]?.[col]??'').trim()}:null;
    p.coinValue=chosen?.value??null;
    p.coinValueStatus=chosen?(chosen.status||String(grid[statusRow]?.[col]??'').trim()||'未标注'):'未提供';
    p.coinValueSource=chosen?.source??null;
  }
  return coinValueCoverage(products);
}

export function unitCoinValue(product){return typeof product?.coinValue==='number'&&Number.isFinite(product.coinValue)&&product.coinValue>=0?product.coinValue:null;}
export function coinValueCoverage(products){
  const priced=products.filter(p=>unitCoinValue(p)!==null);
  return {unit:'金币/件',total:products.length,priced:priced.length,missing:products.length-priced.length,estimated:priced.filter(p=>String(p.coinValueStatus||'').includes('估算')).length};
}
export function orderCoinValue(order,products){
  let total=0;
  for(const item of order.items){const value=unitCoinValue(products.get(item.id));if(value===null)return null;total+=value*item.quantity;}
  return total;
}
export const ORDINARY_ORDER_REWARD_MULTIPLIER=5;
export function ordinaryOrderReward(order,products){
  const value=orderCoinValue(order,products);
  return value===null?null:value*ORDINARY_ORDER_REWARD_MULTIPLIER;
}
