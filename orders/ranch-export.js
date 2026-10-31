import {ranchTypes,ranchDistributionRows} from './ranch-distribution.js';
import {readRanchTarget,loadRanchWorkspace} from './ranch-workspace.js';
import {exportProjectWorkbook} from './project-export.js';

const valid=value=>Number.isFinite(value)&&value>=0?value:null;
export function ranchExportSheets(ws){
  if(!ws?.plans)throw Error('请先导入加工链路 Excel。');
  const summary=[['等级','订单类型','组合数','已证明最优','待证明','未计算','排产失败','平均联合优化时间（分钟，仅已证明）','平均累计工时（分钟）','优化时间目标（分钟）','允许偏差（分钟）','累计工时目标（分钟）','数据文件']];
  for(const row of ranchDistributionRows(ws.plans)){
    const target=readRanchTarget(ws.settings,row.level);
    summary.push([row.level,row.name,row.total,row.proven,row.bounded,row.pending,row.failed,row.optimized.mean,row.work.mean,Number(target.targetHours)*60,Number(target.targetTolerance),String(target.targetWork).trim()===''?null:Number(target.targetWork),ws.filename]);
  }
  const sources=ws.base.sources??[],header=['等级','组合编号','订单内容',...['A','B','C','D'].flatMap(label=>[label+'商品 ID',label+'商品',label+'数量']),'联合优化时间（分钟，已证明）','可行排程时间（分钟）','时间下界（分钟）','排产状态','累计工时（分钟）','累计复杂度','金币总值',...sources.map(s=>s.name+'工时（分钟）')];
  const sheets=[{name:'等级汇总',rows:summary,widths:[10,18,12,14,12,12,12,27,24,24,22,24,42],integerColumns:[9]}];
  for(const type of ranchTypes){
    const rows=[header];
    for(const plan of ws.plans)for(const group of plan.groups.filter(g=>g.types.includes(type.id))){
      const metric=plan.metrics.get(group.key),result=plan.results.get(group.key),failure=plan.failures.get(group.key);
      const optimal=result?.proven?valid(result.optimalMinutes):null;
      const status=optimal!=null?'已证明最优':valid(result?.feasibleMinutes)!=null?'待证明最优':failure?'排产失败':'未计算';
      rows.push([plan.level,group.id,metric.slots.map(v=>`${v.name} × ${v.quantity}`).join(' + '),...metric.slots.flatMap(v=>[v.id,v.name,v.quantity]),optimal,valid(result?.feasibleMinutes),valid(result?.lowerMinutes),failure?status+'：'+String(failure.message??failure):status,metric.totalMinutes,metric.complexity,metric.coinValue,...sources.map(s=>metric.sourceMinutes[s.id]??0)]);
    }
    sheets.push({name:type.name+'订单',rows,widths:header.map((_,i)=>i===2?68:i===18?32:18),integerColumns:[20,22]});
  }
  return sheets;
}
export async function downloadRanchWorkbook({beforeExport,load=loadRanchWorkspace,download}={}){
  await beforeExport?.();
  const ws=await load(),bytes=await exportProjectWorkbook(ranchExportSheets(ws));
  const name='牧场订单_全部等级明细.xlsx';
  if(download){download(bytes,name);return;}
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
