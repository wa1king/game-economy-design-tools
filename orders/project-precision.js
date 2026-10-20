import {PROBABILITY_SCALES} from './probability-floor.js';

export const DEFAULT_PROJECT_SCALE=10000;
function validScale(value){
  const scale=Number(value);
  if(!PROBABILITY_SCALES.includes(scale))throw Error('请选择有效的全局概率精度。');
  return scale;
}

export function migrateProjectPrecision(project){
  if(project.probabilityScale!=null)project.probabilityScale=validScale(project.probabilityScale);
  else{
    const configs=Object.values(project.configs),legacy=configs.filter(c=>c.probabilityScale!=null).map(c=>validScale(c.probabilityScale));
    const continuous=legacy.includes(0)&&!configs.some(c=>c.minimumOrderWeight);
    project.probabilityScale=continuous?0:legacy.length?Math.max(...legacy):DEFAULT_PROJECT_SCALE;
  }
  for(const c of Object.values(project.configs))delete c.probabilityScale;
  return project.probabilityScale;
}

export function setProjectProbabilityScale(project,value){
  const scale=validScale(value);
  if(project.probabilityScale===scale)return false;
  project.probabilityScale=scale;
  for(const c of Object.values(project.configs))c.revision=(c.revision||0)+1;
  return true;
}
