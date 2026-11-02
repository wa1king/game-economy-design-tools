import {ranchWorkRules,ranchWorkRangeText} from './ranch-work-rules.js';
const n=v=>Number(v.toFixed(6)).toLocaleString('zh-CN',{maximumFractionDigits:6});

// A necessary condition: every light slot must have at least (min/max) times
// the work of every heavy slot. A violated cap proves this preset infeasible;
// it does not imply that the level or its gold target is infeasible.
export function coinConstraintConflict(model,group,profile,options){
  const rules=ranchWorkRules(options),ratio=rules.orderWorkMinPercent/rules.orderWorkMaxPercent;
  let conflict=null;
  for(let light=0;light<4;light++)for(let heavy=0;heavy<4;heavy++){
    const unit=profile.units[light].total,minimum=profile.units[heavy].total,required=Math.ceil(minimum*ratio/unit-1e-9),cap=model.cropIds.has(group.slots[light].id)?options.cropMax:options.productMax;
    if(required>cap&&(!conflict||required/cap>conflict.required/conflict.cap))conflict={light,heavy,required,cap,unit,minimum};
  }
  if(!conflict)return null;
  const {light,heavy,required,cap,unit,minimum}=conflict,a=model.by.get(group.slots[light].id),b=model.by.get(group.slots[heavy].id);
  return {code:'RANCH_QUANTITY_INFEASIBLE',kind:'constraint',...conflict,message:`本预设组合受工时占比限制：${b.name}×1 已需 ${n(minimum)} 分钟；每单占组 ${ranchWorkRangeText(options)} 时，${a.name}至少需 ${required} 个（${n(unit*required)} 分钟），超过当前上限 ${cap} 个。该组合暂不入库，其他组合可正常使用。`};
}
export function quantityIssueError(diagnostic){const e=Error(diagnostic.message);e.code=diagnostic.code;e.diagnostic=diagnostic;return e;}
export function isQuantityConstraintIssue(message,diagnostic){return diagnostic?.code==='RANCH_QUANTITY_INFEASIBLE'||/每单累计工时须占整组|当前数量上限无法满足每单累计工时|本预设组合受工时占比限制|没有符合要求的整数数量配置/.test(message??'');}
export function uniqueQuantityIssueText(messages,max=2){const values=[...new Set(messages)];return values.slice(0,max).join('；')+(values.length>max?`；另有 ${values.length-max} 类原因，可在单等级预设组合中查看。`:'');}
