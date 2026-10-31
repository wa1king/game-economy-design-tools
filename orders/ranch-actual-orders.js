import {hasEqualProductQuantities,orderWorkBalance} from './ranch-quantity.js';

// A fixed-quantity optimum is a scheduling result, not an admitted order.
// All result views use this gate; the exhaustive preset catalogue stays intact.
export function ranchOrderAdmission(group,{result,target={},balance,model,error,capacityError}={}){
  const reject=(state,reason)=>({accepted:false,state,reason});
  if(capacityError)return reject('failed',String(capacityError));
  if(!hasEqualProductQuantities(group))return reject('invalid','相同商品数量不一致');
  if(error)return reject('failed',String(error.message??error));
  if(!result)return reject('pending','尚未计算');
  if(!result.proven||!Number.isFinite(result.optimalMinutes)||result.optimalMinutes<0)return reject('bounded','尚未证明最优');
  const checked=model?orderWorkBalance(model,group):balance;
  if(checked?.valid!==true)return reject('invalid','单单累计工时占比不符合当前约束');
  const minutes=Number(target.targetHours)*60,tolerance=Number(target.targetTolerance);
  if(!(minutes>0)||!Number.isFinite(minutes)||String(target.targetTolerance??'').trim()===''||!Number.isFinite(tolerance)||tolerance<0)return reject('invalid','优化时间目标未配置');
  if(result.optimalMinutes<Math.max(0,minutes-tolerance)-1e-8||result.optimalMinutes>minutes+tolerance+1e-8)return reject('outside','优化时间不在目标范围内');
  if(model&&group.slots.some(v=>v.quantity>Number(model.cropIds.has(v.id)?target.fitCropMax:target.fitProductMax)))return reject('invalid','交付数量超过当前配量上限');
  return {accepted:true,state:'accepted',reason:'达标实际订单'};
}

export function ranchPlanAdmission(plan,group,target){
  return ranchOrderAdmission(group,{result:plan.results.get(group.key),target,balance:plan.orderWorkBalance?.get(group.key),model:plan.model,error:plan.quantityErrors?.get(group.id)??plan.quantityFits?.get?.(group.id)?.error??plan.failures.get(group.key),capacityError:plan.capacityError});
}

export function ranchActualGroups(plan,target){return plan.groups.filter(g=>ranchPlanAdmission(plan,g,target).accepted);}
