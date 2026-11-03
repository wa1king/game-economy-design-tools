import {ranchCoinRules,ranchCoinRangeText} from './ranch-coin-rules.js';
const n=v=>Number(v.toFixed(6)).toLocaleString('zh-CN',{maximumFractionDigits:6});

// A necessary gold-share condition. Work is not constrained by these bounds.
export function coinConstraintConflict(model,group,profile,options){
  const rules=ranchCoinRules(options),ratio=rules.orderCoinMinPercent/rules.orderCoinMaxPercent;
  const prices=group.slots.map(v=>model.by.get(v.id)?.coinValue);
  if(prices.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))return null;
  if(prices.some(v=>v===0))return {code:'RANCH_QUANTITY_INFEASIBLE',kind:'constraint',metric:'coins-v1',message:`本预设包含单价为 0 的商品，无法满足每单金币占组 ${ranchCoinRangeText(options)} 的正数下限。该组合暂不入库。`};
  let conflict=null;
  for(let light=0;light<4;light++)for(let heavy=0;heavy<4;heavy++){
    const unit=prices[light],minimum=prices[heavy],required=Math.ceil(minimum*ratio/unit-1e-9),cap=model.cropIds.has(group.slots[light].id)?options.cropMax:options.productMax;
    if(required>cap&&(!conflict||required/cap>conflict.required/conflict.cap))conflict={light,heavy,required,cap,unit,minimum};
  }
  if(!conflict)return null;
  const {light,heavy,required,cap,unit,minimum}=conflict,a=model.by.get(group.slots[light].id),b=model.by.get(group.slots[heavy].id);
  return {code:'RANCH_QUANTITY_INFEASIBLE',kind:'constraint',metric:'coins-v1',...conflict,message:`本预设组合受金币占比限制：${b.name}×1 已值 ${n(minimum)} 金币；每单占组 ${ranchCoinRangeText(options)} 时，${a.name}至少需 ${required} 个（${n(unit*required)} 金币），超过当前上限 ${cap} 个。该组合暂不入库，其他组合可正常使用。`};
}
export function quantityIssueError(diagnostic){const e=Error(diagnostic.message);e.code=diagnostic.code;e.diagnostic=diagnostic;return e;}
export function isQuantityConstraintIssue(message,diagnostic){return diagnostic?.code==='RANCH_QUANTITY_INFEASIBLE'||/每单金币须占整组|当前数量上限无法满足每单金币|本预设组合受金币占比限制|没有符合要求的整数数量配置/.test(message??'');}
export function uniqueQuantityIssueText(messages,max=2){const values=[...new Set(messages)];return values.slice(0,max).join('；')+(values.length>max?`；另有 ${values.length-max} 类原因，可在单等级预设组合中查看。`:'');}
