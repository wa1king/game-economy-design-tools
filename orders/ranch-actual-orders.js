import {hasEqualProductQuantities,orderCoinBalance} from './ranch-quantity.js';
import {ranchGoal} from './ranch-objective.js';

// A fixed-quantity optimum is a scheduling result, not an admitted order.
// All result views use this gate; the exhaustive preset catalogue stays intact.
export function ranchOrderAdmission(group,{result,target={},balance,model,error,capacityError}={}){
  const reject=(state,reason)=>({accepted:false,state,reason});
  if(capacityError)return reject('failed',String(capacityError));
  if(!hasEqualProductQuantities(group))return reject('invalid','相同商品数量不一致');
  if(error)return reject('failed',String(error.message??error));
  if(!result)return reject('pending','尚未计算');
  if(!result.proven||!Number.isFinite(result.optimalMinutes)||result.optimalMinutes<0)return reject('bounded','尚未证明最优');
  const checked=model?orderCoinBalance(model,group):balance;
  if(checked?.priced===false)return reject('invalid','金币单价未完整导入');
  if(checked?.valid!==true)return reject('invalid','单单金币占比不符合当前约束');
  const prices=model?group.slots.map(v=>model.by.get(v.id).coinValue):null;
  const goal=ranchGoal(target),coinValue=model?(prices.every(v=>Number.isFinite(v)&&v>=0)?group.slots.reduce((s,v,i)=>s+prices[i]*v.quantity,0):null):result.coinValue;
  if(goal.target==null)return reject('invalid','当前优化目标未配置');
  const actual=goal.metric==='coins'?coinValue:result.optimalMinutes;
  if(!Number.isFinite(actual))return reject('invalid','金币单价未完整导入');
  if(actual<goal.lower-1e-8||actual>goal.upper+1e-8)return reject('outside',goal.label+'不在目标范围内');
  if(model&&group.slots.some(v=>v.quantity>Number(model.cropIds.has(v.id)?target.fitCropMax:target.fitProductMax)))return reject('invalid','交付数量超过当前配量上限');
  return {accepted:true,state:'accepted',reason:'达标实际订单'};
}

export function ranchPlanAdmission(plan,group,target){
  return ranchOrderAdmission(group,{result:plan.results.get(group.key),target,balance:plan.orderCoinBalance?.get(group.key),model:plan.model,error:plan.quantityErrors?.get(group.id)??plan.quantityFits?.get?.(group.id)?.error??plan.failures.get(group.key),capacityError:plan.capacityError});
}

export function ranchActualGroups(plan,target){return plan.groups.filter(g=>ranchPlanAdmission(plan,g,target).accepted);}
