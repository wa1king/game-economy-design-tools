import {addOrderComplexity} from './order-complexity.js';
import {availableAt} from './order-engine.js';
import {coinValueCoverage,orderCoinValue,unitCoinValue} from './coin-values.js';
export function rowsForExport(catalog,result){
  addOrderComplexity(catalog);
  const scale=result.probabilityScale||1e6,products=new Map(catalog.products.map(p=>[p.id,p]));
  return catalog.orders.map((o,i)=>({...o,coinValue:orderCoinValue(o,products),probability:result.probabilities[i],relativeWeight:result.integerWeights?result.integerWeights[i]:result.probabilities[i]*scale,
    integerWeight:result.integerWeights?result.integerWeights[i]:null,weightScale:scale,generationAllowed:eligibleOrder(o,result.config),originalProbability:result.continuousProbabilities?.[i]??result.probabilities[i]})).filter(o=>availableAt(o,result.config.level));
}
export function toCSV(catalog,result){
  const rows=rowsForExport(catalog,result);
  return '\ufeff'+[['订单ID','商品种类','最低等级','商品内容','累计工时分钟','累计复杂度','复杂度计算明细','生成概率','生成权重','权重总数','原拟合概率','可生成',...catalog.sources.map(s=>s.name+'工时分钟'),'商品金币总值'],...rows.map(o=>[o.id,o.itemTypes,o.minimumLevel,o.description,o.cumulativeMinutes,o.cumulativeComplexity,o.complexityBreakdown.map(p=>p.name+" "+p.cumulativeComplexity).join(" + ")+" = "+o.cumulativeComplexity,o.probability,o.relativeWeight,o.weightScale,o.originalProbability,o.generationAllowed?'是':'否',...o.sourceMinutes,o.coinValue??''])].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
}
export function toJSON(catalog,result){
  const {probabilities,continuousProbabilities,integerWeights,...diagnostics}=result;
  return JSON.stringify({schemaVersion:'order-fit-v3',generatedAt:new Date().toISOString(),source:catalog.source,quantityRule:catalog.rules,timeDefinition:'whole-order cumulative resource work; not wall-clock waiting',complexityDefinition:'sum of requested product kinds cumulative recipe complexity; each product includes itself, deduplicates its own ancestors, ignores order quantity; shared ancestors across requested kinds are counted separately; coproducts do not reduce complexity',coinValueDefinition:'imported per-unit product value in coins; order coinValue=sum(requested quantity*unit value), not an order reward; null means at least one missing price',coinValues:coinValueCoverage(catalog.products),products:catalog.products.map(p=>({...p,coinValue:unitCoinValue(p)})),probabilityPrecision:{scale:result.probabilityScale||null,unitProbability:result.probabilityScale?1/result.probabilityScale:null,integerWeights:!!result.integerWeights,minimumIntegerWeight:result.config.minimumOrderWeight?1:0,minimumScope:'eligible orders after level, item-type and zero-source exclusions'},assumptions:catalog.assumptions,sources:catalog.sources,targets:result.config,diagnostics,orders:rowsForExport(catalog,result)},null,2);
}
import {eligibleOrder} from './probability-floor.js';
