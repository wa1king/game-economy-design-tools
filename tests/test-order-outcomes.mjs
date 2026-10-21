import assert from 'node:assert/strict';
import {productionCalculator} from '../orders/order-engine.js';
import {summarizeOrderOutcomes} from '../orders/order-outcomes.js';

const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-9, `${message || 'value'}: ${actual} != ${expected}`);
const product = (id, name, buildingId, inputs = [], extras = {}) => ({
  id, name, buildingId, buildingName: `来源${buildingId}`, level: 1,
  stepMinutes: 1, analysisBatchYield: 1, inputs, ...extras
});
const base = {
  maxLevel: 2, sources: [0, 1, 2, 3, 4, 5].map(id => ({id, name: `来源${id}`})),
  products: [
    product(1, '麦', 0, [], {category: '田地作物', stepMinutes: 2}),
    product(2, '竹', 5, [], {category: '特殊作物', stepMinutes: 30}),
    product(3, '粉', 1, [{id: 1, quantity: 3}], {analysisBatchYield: 2, stepMinutes: 5}),
    product(4, '面包', 2, [{id: 3, quantity: 1}], {stepMinutes: 10}),
    product(5, '点心', 3, [{id: 3, quantity: 1}], {stepMinutes: 15}),
    product(6, '木框', 4, [{id: 2, quantity: 2}], {stepMinutes: 20}),
    product(7, '未来作物', 0, [], {level: 2, isCrop: true, stepMinutes: 1000})
  ]
};
const calculate = productionCalculator(base);
const order = (id, items, extras = {}) => ({id, items, itemTypes: items.length, minimumLevel: 1, maximumLevel: null, ...calculate(items), ...extras});
const catalog = {...base, orders: [
  order('crop', [{id: 1, quantity: 7}]),
  order('shared', [{id: 4, quantity: 1}, {id: 5, quantity: 1}]),
  order('mixed', [{id: 1, quantity: 7}, {id: 6, quantity: 1}]),
  order('zero', [{id: 1, quantity: 100}]),
  order('future', [{id: 7, quantity: 1}], {minimumLevel: 2})
]};
const result = {config: {level: 1}, probabilities: [.2, .5, .3, 0, 0]};
const original = JSON.stringify({catalog, result});
const summary = summarizeOrderOutcomes(catalog, result);
assert.equal(summary.empty, false);
assert.equal(summary.orderCount, 3);
assert.deepEqual(summary.stats.time, {mean: 49, p10: 14, p50: 36, p90: 94, min: 14, max: 94});
close(summary.stats.complexity.mean, 4.1, 'Complexity sums requested kinds, never quantity');
assert.deepEqual({...summary.stats.complexity, mean: 0}, {mean: 0, p10: 1, p50: 3, p90: 6, min: 1, max: 6});
assert.deepEqual(summary.complexityDistribution.map(row => [row.complexity, row.probability]), [[1, .2], [3, .3], [6, .5]]);
close(summary.directCropOrderProbability, .5);
close(summary.pureCropOrderProbability, .2);
close(summary.mixedCropOrderProbability, .3);
close(summary.noCropOrderProbability, .5);
close(summary.cropChainOrderProbability, 1);
const wheat = summary.crops.find(row => row.id === 1), bamboo = summary.crops.find(row => row.id === 2);
assert.equal(wheat.directQuantityPer100Orders, 350);
assert.equal(wheat.processingQuantityPer100Orders, 150, 'The shared two-output flour batch consumes wheat once for bread + cake');
assert.equal(wheat.totalDemandPer100Orders, 500);
assert.equal(wheat.productionMinutesPer100Orders, 1000);
assert.equal(bamboo.directQuantityPer100Orders, 0);
assert.equal(bamboo.processingQuantityPer100Orders, 60);
assert.equal(bamboo.productionMinutesPer100Orders, 1800);
close(wheat.chainOrderProbability, 1);
close(bamboo.chainOrderProbability, .3);
assert.equal(summary.cropTotals.totalDemandPer100Orders, 560);
assert.equal(summary.cropTotals.directQuantityPer100Orders, 350);
assert.equal(summary.cropTotals.processingQuantityPer100Orders, 210);
close(summary.products.find(row => row.id === 4).directOrderProbability, .5);
assert.equal(summary.products.find(row => row.id === 4).directQuantityPer100Orders, 50);
assert.equal(summary.products.find(row => row.id === 4).cumulativeComplexity, 3);
assert.equal(summary.products.find(row => row.id === 3).directOrderProbability, 0, 'Upstream use is not direct appearance');
assert(!summary.products.some(row => row.id === 7));
assert.equal(summarizeOrderOutcomes(catalog, result), summary, 'Repeated immutable result uses cached calculations');
assert.equal(JSON.stringify({catalog, result}), original, 'Never mutate imported data or fitted probabilities');

// A coproduct satisfies another finished good, avoiding its whole raw-material
// branch. A crop coproduct can additionally meet direct crop demand without land.
const coproductBase = {
  maxLevel: 1, sources: [{id: 0, name: '地'}, {id: 1, name: '坊'}],
  products: [
    product(1, '甲作物', 0, [], {isCrop: true, stepMinutes: 2, analysisBatchYield: 4}),
    product(2, '乙作物', 0, [], {isCrop: true, stepMinutes: 3}),
    product(3, '主产物', 1, [{id: 1, quantity: 3}], {coproducts: [{id: 4, quantity: 1}, {id: 2, quantity: 2}], stepMinutes: 5}),
    product(4, '副产物', 1, [{id: 2, quantity: 7}], {stepMinutes: 6})
  ]
};
const coproductCalculate = productionCalculator(coproductBase);
const items = [{id: 3, quantity: 1}, {id: 4, quantity: 1}, {id: 2, quantity: 2}];
const coproductCatalog = {...coproductBase, orders: [{id: 'coproduct', items, itemTypes: 3, minimumLevel: 1, ...coproductCalculate(items)}]};
const coproductSummary = summarizeOrderOutcomes(coproductCatalog, {config: {level: 1}, probabilities: [1]});
const [cropA, cropB] = coproductSummary.crops;
assert.equal(cropA.totalDemandPer100Orders, 300);
assert.equal(cropA.productionQuantityPer100Orders, 400, 'Crop batches round actual production up');
assert.equal(cropA.productionMinutesPer100Orders, 200);
assert.equal(cropB.totalDemandPer100Orders, 200, 'Only directly delivered crop remains after coproduct avoids the secondary recipe');
assert.equal(cropB.processingQuantityPer100Orders, 0);
assert.equal(cropB.freshDemandPer100Orders, 0, 'The crop coproduct satisfies all directly delivered crop');
assert.equal(cropB.productionMinutesPer100Orders, 0);
assert.equal(coproductSummary.stats.time.mean, 7);
assert.equal(coproductSummary.cropTotals.productionMinutesPer100Orders, coproductCalculate(items).sourceMinutes[0] * 100);

// A level mismatch is explicit and conditioned on the remaining valid orders.
const levelResult = {config: {level: 2}, probabilities: [.1, 0, 0, 0, .9]};
const atOne = summarizeOrderOutcomes(catalog, levelResult, 1);
close(atOne.probabilityMass, .1);
close(atOne.excludedProbabilityMass, .9);
assert.equal(atOne.directCropOrderProbability, 1);
assert.equal(atOne.cropTotals.directQuantityPer100Orders, 700);
assert.equal(atOne.stats.time.mean, 14);
assert(summarizeOrderOutcomes(catalog, levelResult, 2).products.some(row => row.id === 7));
for (const emptyResult of [null, {blocked: true}, {config: {level: 1}, probabilities: [0, 0, 0, 0, 0]}]) {
  const empty = summarizeOrderOutcomes(catalog, emptyResult, 1);
  assert.equal(empty.empty, true);
  assert.equal(empty.stats.time.mean, null);
  assert.equal(empty.stats.complexity.p90, null);
  assert.equal(empty.cropTotals.totalDemandPer100Orders, 0);
  assert.equal(empty.noCropOrderProbability, 0, 'No fitted results must not look like 100% no-crop orders');
}
assert.throws(() => summarizeOrderOutcomes(catalog, {probabilities: [1]}, 1), /不一致/);
assert.throws(() => summarizeOrderOutcomes(catalog, {probabilities: [1, -.1, 0, 0, 0]}, 1), /无效/);
console.log('Outcome analysis: weighted discrete quantiles, zero-probability exclusion, crop appearances, shared batches, coproduct reuse, crop production rounding, level filtering, empty states and input preservation passed.');
