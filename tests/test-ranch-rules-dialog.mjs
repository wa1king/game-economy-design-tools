import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {applyRanchRuleDraft} from '../orders/ranch-rules-dialog.js';
const base={maxLevel:3,sources:[{id:0,name:'农田',level:1},{id:1,name:'磨坊',level:2}]};
const previous={level:2,cropQuantity:7,productQuantity:1,capacities:{1:{0:6},2:{0:12,1:1}},quantityTargetsByLevel:{2:{targetHours:'6'}},quantityEdits:{2:{g:[2,1,1,1]}},browser:{groupId:'g'}};
const draft={level:2,cropQuantity:8,productQuantity:2,searchLimit:'2000',allowRepeated:true,capacities:{0:18,1:2}};
test('shared rule apply updates only rules and the chosen level capacity, retaining quantities and targets',()=>{
 const before=structuredClone(previous),next=applyRanchRuleDraft(base,previous,draft);assert.deepEqual(previous,before);assert.equal(next.cropQuantity,8);assert.equal(next.productQuantity,2);assert.deepEqual(next.capacities[2],{0:18,1:2});assert.deepEqual(next.capacities[1],{0:6});assert.deepEqual(next.quantityTargetsByLevel,previous.quantityTargetsByLevel);assert.deepEqual(next.quantityEdits,previous.quantityEdits);assert.deepEqual(next.browser,previous.browser);
});
test('invalid quantities, levels and capacities are rejected without partial writes',()=>{
 for(const patch of [{cropQuantity:0},{productQuantity:1.5},{level:4},{searchLimit:'123'},{capacities:{0:18,1:0}}])assert.throws(()=>applyRanchRuleDraft(base,previous,{...draft,...patch}));assert.deepEqual(previous.capacities[2],{0:12,1:1});
});
test('analysis loads shared modal first and puts import/export in the global header',()=>{
 const html=fs.readFileSync(new URL('../orders/ranch.html',import.meta.url),'utf8'),actions=html.match(/<section class="workspace-actionbar"[\s\S]*?<\/section>/)[0];const header=html.match(/<header\b[\s\S]*?<\/header>/)[0];assert(!html.includes('使用普通订单数据'));assert(header.includes('id="importButton"'));assert(header.includes('id="exportRanchExcel"'));assert(actions.includes('id="openSettings"'));assert(!actions.includes('exportButton'));assert(!html.includes('<section id="settings"'));assert(html.indexOf('src="ranch-shell.js"')<html.indexOf('src="ranch-app.js"'));
});
