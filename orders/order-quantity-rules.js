export const DEFAULT_CROP_QUANTITY=6;
export const RANCH_QUANTITY_RULES_KEY='ranch-quantity-rules-v2';
const read=(storage,key)=>JSON.parse(storage.getItem(key)||'null');
const valid=value=>Number.isSafeInteger(Number(value))&&Number(value)>=1&&Number(value)<=1000;

// Base delivery quantities are design preferences, not recipe-specific targets.
// Legacy 7 was the old built-in default. Migrate once; later explicit 7 is valid.
export function readRanchSettings(storage,key){
  const settings=read(storage,key)??{};
  let quantities=read(storage,RANCH_QUANTITY_RULES_KEY);
  if(!quantities){
    quantities={cropQuantity:valid(settings.cropQuantity)&&Number(settings.cropQuantity)!==7?Number(settings.cropQuantity):DEFAULT_CROP_QUANTITY,productQuantity:valid(settings.productQuantity)?Number(settings.productQuantity):1};
    storage.setItem('ranch-quantity-rules-before-v2',JSON.stringify({key,settings}));
    storage.setItem(RANCH_QUANTITY_RULES_KEY,JSON.stringify(quantities));
  }
  return {...settings,...quantities};
}
export function saveRanchQuantityRules(settings,storage=globalThis.localStorage){
  if(!valid(settings.cropQuantity)||!valid(settings.productQuantity))throw Error('需求数量必须是 1～1000 的整数。');
  storage.setItem(RANCH_QUANTITY_RULES_KEY,JSON.stringify({cropQuantity:Number(settings.cropQuantity),productQuantity:Number(settings.productQuantity)}));
}
export function migrateOrdinaryCropQuantity(project){
  if(!project?.rules||project.rules.quantityDefaultsVersion===2)return project;
  return {...project,rules:{...project.rules,cropQuantity:Number(project.rules.cropQuantity)===7?DEFAULT_CROP_QUANTITY:project.rules.cropQuantity??DEFAULT_CROP_QUANTITY,quantityDefaultsVersion:2}};
}
