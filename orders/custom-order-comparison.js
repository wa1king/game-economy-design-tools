import {availableAt} from './order-engine.js';
import {customOrdersAt} from './custom-orders.js';

// Custom tasks are delivered once each. The remaining pool uses its existing
// final generation probabilities, conditioned on not drawing a custom task.
export function customOrderTimeComparison(catalog,selection,level,result,byId){
  const entries=customOrdersAt(catalog,selection,level,byId),chosen=new Set(entries.map(v=>v.id));
  const invalid=entries.filter(v=>!v.order).length;
  const customMean=entries.length&&!invalid?entries.reduce((sum,v)=>sum+v.order.cumulativeMinutes,0)/entries.length:null;
  let normalMean=null,normalMass=0,normalCount=0;
  if(result&&!result.blocked){
    if(result.probabilities?.length!==catalog.orders.length)throw Error('订单结果与最终概率数量不一致。');
    let work=0;
    catalog.orders.forEach((order,i)=>{
      const probability=result.probabilities[i];
      if(chosen.has(order.id)||!availableAt(order,level)||!(probability>0)||!Number.isFinite(probability))return;
      normalMass+=probability;work+=probability*order.cumulativeMinutes;normalCount++;
    });
    if(normalMass>0)normalMean=work/normalMass;
  }
  return {entries,invalid,customMean,normalMean,normalMass,normalCount,delta:customMean!=null&&normalMean!=null?customMean-normalMean:null};
}
