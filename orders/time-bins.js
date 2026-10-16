export const HALF_HOUR=30;
export function inTimeRange(minutes,range){return !range||(minutes>=range.start&&minutes<range.end);}
export function halfHourStats(catalog,result,onlyPositive=true){
  const rows=catalog.orders.map((order,i)=>({order,probability:result.probabilities[i]}))
    .filter(({order,probability})=>order.minimumLevel<=result.config.level&&(order.maximumLevel==null||order.maximumLevel>=result.config.level)&&(!onlyPositive||probability>0));
  const max=rows.reduce((v,{order})=>Math.max(v,order.cumulativeMinutes),0);
  const bins=Array.from({length:Math.floor(max/HALF_HOUR)+1},(_,i)=>({start:i*HALF_HOUR,end:(i+1)*HALF_HOUR,count:0,probability:0}));
  for(const {order,probability} of rows){const bin=bins[Math.floor(order.cumulativeMinutes/HALF_HOUR)];bin.count++;bin.probability+=probability;}
  return bins;
}
