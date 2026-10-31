import {ranchWorkRules} from './ranch-work-rules.js';
export const DEFAULT_CROP_QUANTITY=6;
export const RANCH_QUANTITY_RULES_KEY='ranch-quantity-rules-v2';
const read=(storage,key)=>JSON.parse(storage.getItem(key)||'null');
const valid=value=>Number.isSafeInteger(Number(value))&&Number(value)>=1&&Number(value)<=1000;

// Reading never rewrites a saved value or infers its origin from its number.
// Only an explicit Apply action can make a shared preference authoritative.
export function readRanchSettings(storage,key){
  const settings=read(storage,key)??{},shared=read(storage,RANCH_QUANTITY_RULES_KEY)??{};
  const quantity=field=>shared.origin==='user'
    ?shared[field]??settings[field]
    :settings[field]??shared[field];
  return {...settings,cropQuantity:quantity('cropQuantity')??DEFAULT_CROP_QUANTITY,productQuantity:quantity('productQuantity')??1,...ranchWorkRules({orderWorkMinPercent:quantity('orderWorkMinPercent'),orderWorkMaxPercent:quantity('orderWorkMaxPercent')})};
}
export function saveRanchQuantityRules(settings,storage=globalThis.localStorage){
  if(!valid(settings.cropQuantity)||!valid(settings.productQuantity))throw Error('需求数量必须是 1～1000 的整数。');
  storage.setItem(RANCH_QUANTITY_RULES_KEY,JSON.stringify({origin:'user',cropQuantity:Number(settings.cropQuantity),productQuantity:Number(settings.productQuantity),...ranchWorkRules(settings)}));
}
export function fillMissingOrdinaryCropQuantity(project){
  if(!project?.rules||project.rules.cropQuantity!=null)return project;
  return {...project,rules:{...project.rules,cropQuantity:DEFAULT_CROP_QUANTITY}};
}
