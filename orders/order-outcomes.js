import {availableAt, productionCalculator, validateProducts} from './order-engine.js';

const catalogCache = new WeakMap();
const resultCache = new WeakMap();
const isCrop = product => Boolean(product.isCrop || product.category === '田地作物' || product.category === '特殊作物');
const emptyStats = () => ({mean: null, p10: null, p50: null, p90: null, min: null, max: null});
const emptyCropTotals = () => ({
  directQuantityPer100Orders: 0, processingQuantityPer100Orders: 0,
  totalDemandPer100Orders: 0, freshDemandPer100Orders: 0,
  productionQuantityPer100Orders: 0, productionMinutesPer100Orders: 0
});

function prepare(catalog) {
  if (catalogCache.has(catalog)) return catalogCache.get(catalog);
  const {by, depths} = validateProducts(catalog);
  const calculate = productionCalculator(catalog), chains = new Map();
  function chain(id) {
    if (chains.has(id)) return chains.get(id);
    const kinds = new Set([id]);
    for (const input of by.get(id).inputs) for (const kind of chain(input.id)) kinds.add(kind);
    chains.set(id, kinds);
    return kinds;
  }
  const products = catalog.products.map(product => ({
    id: product.id, name: product.name, level: product.level,
    buildingId: product.buildingId, buildingName: product.buildingName,
    coinValue: product.coinValue??null,coinValueStatus:product.coinValueStatus??'未提供',coinValueSource:product.coinValueSource??null,
    isCrop: isCrop(product), cumulativeComplexity: chain(product.id).size,
    stepMinutes: product.stepMinutes,
    unitCumulativeMinutes: product.unitCumulativeMinutes ?? calculate([{id: product.id, quantity: 1}]).cumulativeMinutes
  }));
  const productInfo = new Map(products.map(product => [product.id, product]));
  // Keep the exact productionCalculator ordering: whole-order demand is combined
  // before batch rounding, and coproduct producers run before peers at equal depth.
  const sequence = [...catalog.products].sort((a, b) => depths.get(b.id) - depths.get(a.id)
    || (b.coproducts?.length || 0) - (a.coproducts?.length || 0) || a.id - b.id);
  const orderCache = new WeakMap();
  function describe(order) {
    if (orderCache.has(order)) return orderCache.get(order);
    const demand = new Map(), direct = new Map(), spare = new Map(), crops = [];
    let complexity = 0, directCropKinds = 0;
    for (const item of order.items) {
      const product = productInfo.get(item.id);
      if (!product || !Number.isFinite(item.quantity) || item.quantity <= 0) throw Error(`订单 ${order.id} 的商品或数量无效。`);
      demand.set(item.id, (demand.get(item.id) || 0) + item.quantity);
      direct.set(item.id, (direct.get(item.id) || 0) + item.quantity);
      complexity += product.cumulativeComplexity;
      if (product.isCrop) directCropKinds++;
    }
    for (const product of sequence) {
      const requested = demand.get(product.id) || 0;
      const needed = requested - Math.min(requested, spare.get(product.id) || 0);
      const batches = Math.ceil(needed / product.analysisBatchYield);
      if (isCrop(product) && requested > 0) crops.push({
        id: product.id, totalDemand: requested, freshDemand: needed,
        productionQuantity: batches * product.analysisBatchYield,
        productionMinutes: batches * product.stepMinutes
      });
      if (!needed) continue;
      for (const input of product.inputs) demand.set(input.id, (demand.get(input.id) || 0) + batches * input.quantity);
      for (const output of product.coproducts || []) spare.set(output.id, (spare.get(output.id) || 0) + batches * output.quantity);
    }
    const value = {direct, crops, complexity, directCropKinds, itemKinds: order.items.length};
    orderCache.set(order, value);
    return value;
  }
  const prepared = {products, describe};
  catalogCache.set(catalog, prepared);
  return prepared;
}

// Inverse discrete CDF: the smallest value whose cumulative probability reaches
// the requested percentile. Zero-probability candidates never enter the range.
function weightedStats(entries) {
  if (!entries.length) return emptyStats();
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, row) => sum + row.probability, 0);
  const quantile = fraction => {
    let accumulated = 0;
    for (const row of sorted) {
      accumulated += row.probability;
      if (accumulated >= fraction * total - 1e-12 * total) return row.value;
    }
    return sorted.at(-1).value;
  };
  return {
    mean: sorted.reduce((sum, row) => sum + row.value * row.probability, 0) / total,
    p10: quantile(.1), p50: quantile(.5), p90: quantile(.9),
    min: sorted[0].value, max: sorted.at(-1).value
  };
}

/**
 * Outcome probabilities are fractions (0..1); quantities/work are expectations
 * per 100 generated orders. Orders and probabilities use catalog.orders order.
 * Only available, positive-probability orders enter the summary. If a caller
 * requests a different level, that subset is normalized conditionally and both
 * retained/excluded probability mass are returned explicitly.
 *
 * Crop total demand includes direct delivery plus expanded recipe consumption.
 * Fresh demand subtracts usable coproducts; production rounds that fresh demand
 * to whole batches. Recipe expansion itself also shares batches and coproducts.
 * The input catalog/result/config are never changed. Final fit objects and
 * catalogs are treated as immutable; new fits receive a new cached summary.
 */
export function summarizeOrderOutcomes(catalog, result, level = result?.config?.level ?? catalog.maxLevel) {
  if (!Number.isInteger(level) || level < 1) throw Error('结果分析需要有效等级。');
  const cached = result && resultCache.get(result)?.get(catalog)?.get(level);
  if (cached && cached.probabilities === result.probabilities) return cached.summary;
  const prepared = prepare(catalog);
  const products = prepared.products.filter(product => product.level <= level).map(product => ({
    ...product, directOrderProbability: 0, directQuantityPer100Orders: 0
  }));
  const crops = products.filter(product => product.isCrop).map(product => ({
    ...product, ...emptyCropTotals(), chainOrderProbability: 0
  }));
  const summary = {
    empty: true, level, orderCount: 0, probabilityMass: 0, excludedProbabilityMass: 0,
    stats: {time: emptyStats(), complexity: emptyStats()}, complexityDistribution: [],
    directCropOrderProbability: 0, pureCropOrderProbability: 0,
    mixedCropOrderProbability: 0, noCropOrderProbability: 0, cropChainOrderProbability: 0,
    cropTotals: emptyCropTotals(), products, crops
  };
  if (!result || result.blocked || !result.probabilities?.length) return summary;
  if (result.probabilities.length !== catalog.orders.length) throw Error('订单结果与最终概率数量不一致。');
  const rows = [];
  for (let index = 0; index < catalog.orders.length; index++) {
    const probability = result.probabilities[index], order = catalog.orders[index];
    if (!Number.isFinite(probability) || probability < 0) throw Error('订单生成概率无效。');
    if (!probability) continue;
    if (!availableAt(order, level)) {summary.excludedProbabilityMass += probability; continue;}
    if (!Number.isFinite(order.cumulativeMinutes) || order.cumulativeMinutes < 0) throw Error(`订单 ${order.id} 的累计工时无效。`);
    rows.push({order, probability});
    summary.probabilityMass += probability;
  }
  if (!rows.length) return summary;
  summary.empty = false;
  summary.orderCount = rows.length;
  const productRows = new Map(products.map(product => [product.id, product]));
  const cropRows = new Map(crops.map(product => [product.id, product]));
  const times = [], complexities = [], distribution = new Map();
  for (const row of rows) {
    const probability = row.probability / summary.probabilityMass, detail = prepared.describe(row.order);
    times.push({value: row.order.cumulativeMinutes, probability});
    complexities.push({value: detail.complexity, probability});
    if (!distribution.has(detail.complexity)) distribution.set(detail.complexity, {complexity: detail.complexity, probability: 0, orderCount: 0});
    const bucket = distribution.get(detail.complexity);
    bucket.probability += probability;
    bucket.orderCount++;
    if (detail.directCropKinds) {
      summary.directCropOrderProbability += probability;
      if (detail.directCropKinds === detail.itemKinds) summary.pureCropOrderProbability += probability;
      else summary.mixedCropOrderProbability += probability;
    } else summary.noCropOrderProbability += probability;
    for (const [id, quantity] of detail.direct) {
      const product = productRows.get(id);
      if (!product) throw Error(`订单 ${row.order.id} 包含当前等级未解锁的商品 ${id}。`);
      product.directOrderProbability += probability;
      product.directQuantityPer100Orders += probability * quantity * 100;
      if (product.isCrop) {
        const crop = cropRows.get(id);
        crop.directOrderProbability += probability;
        crop.directQuantityPer100Orders += probability * quantity * 100;
      }
    }
    if (detail.crops.length) summary.cropChainOrderProbability += probability;
    for (const requirement of detail.crops) {
      const crop = cropRows.get(requirement.id);
      if (!crop) throw Error(`订单 ${row.order.id} 需要当前等级未解锁的作物 ${requirement.id}。`);
      crop.chainOrderProbability += probability;
      crop.totalDemandPer100Orders += probability * requirement.totalDemand * 100;
      crop.processingQuantityPer100Orders += probability * (requirement.totalDemand - (detail.direct.get(crop.id) || 0)) * 100;
      crop.freshDemandPer100Orders += probability * requirement.freshDemand * 100;
      crop.productionQuantityPer100Orders += probability * requirement.productionQuantity * 100;
      crop.productionMinutesPer100Orders += probability * requirement.productionMinutes * 100;
    }
  }
  summary.stats = {time: weightedStats(times), complexity: weightedStats(complexities)};
  summary.complexityDistribution = [...distribution.values()].sort((a, b) => a.complexity - b.complexity);
  for (const crop of crops) for (const key of Object.keys(summary.cropTotals)) summary.cropTotals[key] += crop[key];
  if (!resultCache.has(result)) resultCache.set(result, new WeakMap());
  if (!resultCache.get(result).has(catalog)) resultCache.get(result).set(catalog, new Map());
  resultCache.get(result).get(catalog).set(level, {probabilities: result.probabilities, summary});
  return summary;
}
