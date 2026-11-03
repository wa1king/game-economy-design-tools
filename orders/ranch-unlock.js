export function ranchUnlockLevel(settings={}){
  if(settings.unlockLevel==null)return 1;
  const value=String(settings.unlockLevel).trim(),level=Number(value);
  if(!value||!Number.isSafeInteger(level)||level<1||level>200)throw Error('牧场解锁等级需为 1～200 的整数。');
  return level;
}
export function ranchLevelUnlocked(level,settings={}){return level>=ranchUnlockLevel(settings);}
export function ranchUnlockedPlans(plans,settings={}){
  const start=ranchUnlockLevel(settings);return plans.filter(plan=>plan.level>=start);
}
