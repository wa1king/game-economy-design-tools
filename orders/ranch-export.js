import {readFuelRules,ranchFuelReward} from './fuel-rewards.js';
import {ranchGoal} from './ranch-objective.js';
import {ranchCoinRules} from './ranch-coin-rules.js';
import {ranchDashboardRows} from './ranch-distribution.js';
import {ranchPlanAdmission} from './ranch-actual-orders.js';
import {readRanchTarget,loadRanchWorkspace} from './ranch-workspace.js';
import {exportProjectWorkbook} from './project-export.js';
import {prepareRanch} from './ranch-engine.js';

export function ranchExportSheets(ws){
  if(!ws?.plans)throw Error('请先导入加工链路 Excel。');
  const model=ws.model??prepareRanch(ws.base,ws.settings),fuelConfig=readFuelRules();
  const summary=[['等级','订单类型','预设组合数','预设已证明最优','预设待证明','预设未计算','预设排产失败','实际订单平均联合优化时间（分钟）','实际订单平均累计工时（分钟）','优化时间目标（分钟，金币模式为空）','时间允许偏差（分钟，金币模式为空）','累计工时目标（分钟）','数据文件','达标实际订单组数','实际订单平均金币总值','配量目标','金币目标','金币允许偏差','每单金币占比下限（%）','每单金币占比上限（%）','实际订单平均燃料奖励','兑换1燃料所需金币']];
  const targets=Object.fromEntries(ws.plans.map(p=>[p.level,readRanchTarget(ws.settings,p.level)]));
  for(const row of ranchDashboardRows(ws.plans,targets)){
    const target=readRanchTarget(ws.settings,row.level);
    summary.push([row.level,row.name,row.total,row.proven,row.bounded,row.pending,row.failed,row.optimized.mean,row.work.mean,target.objective==='coins'?null:Number(target.targetHours)*60,target.objective==='coins'?null:Number(target.targetTolerance),String(target.targetWork).trim()===''?null:Number(target.targetWork),ws.filename,row.accepted,row.missingCoins?null:row.coins.mean,ranchGoal(target).label,target.objective==='coins'?Number(target.targetCoins):null,target.objective==='coins'?Number(target.coinTolerance):null,ranchCoinRules(ws.settings).orderCoinMinPercent,ranchCoinRules(ws.settings).orderCoinMaxPercent,row.fuel.mean,fuelConfig.coinsPerFuel]);
  }
  const sources=ws.base.sources??[],header=['等级','订单内容',...['A','B','C','D'].flatMap(label=>[label+'商品 ID',label+'商品',label+'数量',label+'燃料奖励']),'四单燃料奖励合计','联合优化时间（分钟）','累计工时（分钟）','累计复杂度',...sources.map(s=>s.name+'工时（分钟）')],actualRows=[header];
  for(const plan of [...ws.plans].sort((a,b)=>a.level-b.level)){
    const seen=new Set();
    for(const group of plan.groups){
      if(seen.has(group.key)||!ranchPlanAdmission(plan,group,targets[plan.level]).accepted)continue;
      seen.add(group.key);
      const metric=plan.metrics.get(group.key),result=plan.results.get(group.key),fuel=ranchFuelReward(group,model.by,fuelConfig);
      actualRows.push([plan.level,metric.slots.map(v=>`${v.name} × ${v.quantity}`).join(' + '),...metric.slots.flatMap((v,i)=>[v.id,v.name,v.quantity,fuel.values[i]]),fuel.total,result.optimalMinutes,metric.totalMinutes,metric.complexity,...sources.map(s=>metric.sourceMinutes[s.id]??0)]);
    }
  }
  return [
    {name:'等级汇总',rows:summary,widths:[10,18,12,14,12,12,12,27,24,24,22,24,42],integerColumns:[9]},
    {name:'全部实际订单',rows:actualRows,widths:[8,68,...Array.from({length:4},()=>[14,20,10,14]).flat(),22,24,20,16,...sources.map(()=>20)],headerHeight:48,wrapColumns:[2],integerColumns:[5,6,9,10,13,14,17,18,19,21,22],decimalColumns:[20]}
  ];
}
export async function downloadRanchWorkbook({beforeExport,load=loadRanchWorkspace,download}={}){
  await beforeExport?.();
  const ws=await load(),bytes=await exportProjectWorkbook(ranchExportSheets(ws));
  const name='牧场订单_全部等级明细.xlsx';
  if(download){download(bytes,name);return;}
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
