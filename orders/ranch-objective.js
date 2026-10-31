export const ranchObjective=raw=>raw?.objective==='coins'?'coins':'time';
export function ranchGoal(raw={}){
  const coins=ranchObjective(raw)==='coins',target=Number(coins?raw.targetCoins:Number(raw.targetHours)*60),tolerance=Number(coins?raw.coinTolerance:raw.targetTolerance);
  const valid=String(coins?raw.targetCoins??'':raw.targetHours??'').trim()!==''&&String(coins?raw.coinTolerance??'':raw.targetTolerance??'').trim()!==''&&Number.isFinite(target)&&target>0&&Number.isFinite(tolerance)&&tolerance>=0&&tolerance<target;
  return {metric:coins?'coins':'time',label:coins?'四单金币总值':'联合优化时间',unit:coins?'金币':'分钟',target:valid?target:null,tolerance:valid?tolerance:null,lower:valid?target-tolerance:null,upper:valid?target+tolerance:null};
}
export function ranchGoalWithin(result,options,coinValue=result?.coinValue){
  if(ranchObjective(options)==='coins')return Number.isFinite(coinValue)&&Math.abs(coinValue-options.targetCoins)<=options.coinTolerance+1e-8;
  return result?.lowerMinutes>=options.targetMinutes-options.toleranceMinutes-1e-7&&result?.feasibleMinutes<=options.targetMinutes+options.toleranceMinutes+1e-7;
}
export function ranchGoalOptions(target,work){return {objective:ranchObjective(target),targetCoins:Number(target.targetCoins??300),coinTolerance:Number(target.coinTolerance??30),targetMinutes:Number(target.targetHours)*60,toleranceMinutes:Number(target.targetTolerance),targetWorkMinutes:work,cropMax:Number(target.fitCropMax),productMax:Number(target.fitProductMax),timeLimitMs:Number(target.quantityBudget)};}
