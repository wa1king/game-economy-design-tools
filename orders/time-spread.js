// Coefficient of variation shown as a percentage. Variance remains the solver contract.
export function spreadPercent(config){
  if(config.spreadPercent!=null)return Number(config.spreadPercent);
  return config.mean>0?Math.sqrt(config.variance)/config.mean*100:NaN;
}
export function actualSpread(result){return result?.mean>0?result.sd/result.mean*100:NaN;}
export function migrateSpread(config){
  if(config.spreadPercent==null)config.spreadPercent=spreadPercent(config);
  return config;
}
export function setTimeTarget(config,key,value){
  migrateSpread(config);
  config[key]=Number(value);
  config.variance=(Number(config.mean)*config.spreadPercent/100)**2;
}
export function spreadInterval(config){
  const mean=Number(config.mean),sd=mean*spreadPercent(config)/100;
  return [mean-sd,mean+sd];
}
