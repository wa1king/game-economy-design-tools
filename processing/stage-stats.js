(function(root){
  'use strict';
  const stages=Array.from({length:4},(_,i)=>({id:i+1,start:i*5+1,end:(i+1)*5,label:`Lv${i*5+1}–${(i+1)*5}`}));
  function stageFor(level){return stages[Math.max(0,Math.min(3,Math.ceil(level/5)-1))]}
  function cohort(rows,stage,scope){return rows.filter(p=>p.level<=stage.end&&(scope==='unlocked'||p.level>=stage.start))}
  function referenceRows(rows,population){return rows.filter(p=>population==='all'||p.category==='田地'||p.category==='加工'&&(population==='processing'||p.noAnimalChain))}
  function aggregate(values,mode){
    if(!values.length||values.some(v=>typeof v!=='number'||!Number.isFinite(v)))return null;
    if(mode==='max')return Math.max(...values);
    if(mode==='min')return Math.min(...values);
    if(mode==='mean')return values.reduce((s,v)=>s+v,0)/values.length;
    const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;
    return n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;
  }
  const defaultGoals=[
    {count:7,stepMin:2,stepMax:20,workMax:45,optimalMax:30,waitMax:15,depthMax:2,directMax:2,distinctMax:4},
    {count:9,stepMin:10,stepMax:60,workMax:180,optimalMax:120,waitMax:60,depthMax:2,directMax:2,distinctMax:6},
    {count:16,stepMin:30,stepMax:120,workMax:360,optimalMax:240,waitMax:120,depthMax:2,directMax:3,distinctMax:7},
    {count:14,stepMin:30,stepMax:180,workMax:720,optimalMax:360,waitMax:180,depthMax:3,directMax:3,distinctMax:9}
  ];
  const goalFields=[['count','新增商品','件'],['stepMin','单步时间最小','min'],['stepMax','单步时间最大','min'],['workMax','累计时间最大','min'],['optimalMax','优化时间最大','min'],['waitMax','空仓等待最大','min'],['depthMax','深度最大','层'],['directMax','单步复杂度最大','种'],['distinctMax','累计复杂度最大','种']];
  const goalChecks=[['stepMin','batchMinutes','单步时间','min',true],['stepMax','batchMinutes','单步时间','min',false],['workMax','cumulative','累计时间','min',false],['optimalMax','optimized','优化时间','min',false],['waitMax','emptyWait','空仓等待','min',false],['depthMax','depth','链深度','层',false],['directMax','singleComplexity','单步复杂度','种',false],['distinctMax','complexity','累计复杂度','种',false]];
  function normalizeGoals(input){
    if(!Array.isArray(input)||input.length!==4)throw Error('阶段预期需包含4个阶段。');
    return defaultGoals.map((defaults,i)=>{
      if(!input[i]||typeof input[i]!=='object'||Array.isArray(input[i]))throw Error('阶段预期格式不正确。');
      const goal={...defaults,...input[i]};
      for(const [key,name] of goalFields){const n=goal[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw Error(`${stages[i].label}：${name}需为非负数。`);if(['count','depthMax','directMax','distinctMax'].includes(key)&&!Number.isInteger(n))throw Error(`${name}需为整数。`)}
      if(goal.stepMin>goal.stepMax)throw Error('单步时间最小值不能大于最大值。');
      return Object.fromEntries(goalFields.map(([k])=>[k,goal[k]]));
    });
  }
  function auditGoals(products,goals,valueFor){
    const records=[],summaries=[];
    for(const stage of stages){
      const rows=cohort(products,stage,'new'),goal=goals[stage.id-1],actual={count:rows.length};
      records.push({key:`stage:${stage.id}:count`,stage:stage.id,id:null,name:'新增商品',metric:'count',label:'新增商品',actual:rows.length,limit:goal.count,unit:'件',lower:false,exceeded:rows.length>goal.count});
      for(const p of rows)for(const [field,metric,label,unit,lower]of goalChecks){
        const actualValue=valueFor(p,metric),known=typeof actualValue==='number'&&Number.isFinite(actualValue);
        records.push({key:`${p.id}:${field}`,stage:stage.id,id:p.id,name:p.name,metric,field,label,actual:known?actualValue:null,limit:goal[field],unit,lower,exceeded:known?(lower?actualValue<goal[field]-1e-8:actualValue>goal[field]+1e-8):null});
      }
      for(const [field,metric,,,lower]of goalChecks)actual[field]=aggregate(rows.map(p=>valueFor(p,metric)),lower?'min':'max');
      summaries.push({stage:stage.id,actual,count:rows.length,issues:records.filter(r=>r.stage===stage.id&&r.exceeded===true).length,pending:records.filter(r=>r.stage===stage.id&&r.exceeded===null).length});
    }
    return {records,summaries,issues:records.filter(r=>r.exceeded===true),pending:records.filter(r=>r.exceeded===null)};
  }
  function parseGoalPaste(text,current,startStage=0,startColumn=0){
    // Excel uses quoted TSV when a header contains a line break.
    const rows=[[]];let cell='',quoted=false;
    text=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    if(text.length>30000)throw Error('粘贴内容过大，请只复制阶段预期区域。');
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else if(quoted||!cell)quoted=!quoted;else cell+=c}
      else if(!quoted&&(c==='\t'||c==='\n')){rows.at(-1).push(cell.trim());cell='';if(c==='\n')rows.push([])}else cell+=c;
    }
    if(quoted)throw Error('粘贴内容的引号不完整。');
    rows.at(-1).push(cell.trim());
    while(rows.length&&rows.at(-1).every(v=>!v))rows.pop();
    if(!rows.length)throw Error('没有可粘贴的数值。');
    const width=rows[0].length;
    if(rows.some(r=>r.length!==width))throw Error('矩阵各行列数不一致，请重新复制完整区域。');
    const clean=s=>s.replace(/\s|[()（）]/g,'').replace(/min|分钟|件|种|层/g,'');
    const names=new Map(goalFields.map(([k,n])=>[clean(n),k]));names.set('链深度最大','depthMax');
    const first=rows[0].map(clean),hasHeader=first.some(v=>names.has(v)||v==='等级阶段');
    let keys=null,labeled=false;
    if(hasHeader){
      labeled=first[0]==='等级阶段';
      keys=first.slice(labeled?1:0).map(v=>{if(!names.has(v))throw Error(`无法识别表头“${v}”，请按阶段预期表的列名复制。`);return names.get(v)});
      if(new Set(keys).size!==keys.length)throw Error('表头包含重复指标。');rows.shift();
    }
    const stageIndex=s=>{
      const match=s.replace(/\s/g,'').match(/^(?:Lv)?(\d+)[—–\-~～至](\d+)(?:级)?$/i);
      return match?stages.findIndex(x=>x.start===Number(match[1])&&x.end===Number(match[2])):-1;
    };
    if(!hasHeader&&rows.length&&stageIndex(rows[0][0])>=0)labeled=true;
    if(!rows.length)throw Error('表头下面没有数值。');
    const columns=width-(labeled?1:0);
    if(!keys){const offset=labeled&&columns===goalFields.length?0:startColumn;keys=goalFields.slice(offset,offset+columns).map(([k])=>k)}
    if(!columns||keys.length!==columns)throw Error('粘贴区域超出指标列，请选择更靠前的起始输入格。');
    const next=structuredClone(current),used=new Set();let count=0;
    rows.forEach((row,r)=>{
      const index=labeled?stageIndex(row[0]):startStage+r;
      if(index<0||index>=stages.length)throw Error(`第${r+1}行的等级阶段无效或超出四个阶段。`);
      if(used.has(index))throw Error('粘贴区域包含重复等级阶段。');used.add(index);
      row.slice(labeled?1:0).forEach((value,c)=>{
        if(!value)return; // Blank cells leave existing targets unchanged.
        const numeric=value.replace(/,/g,'');
        if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(numeric))throw Error(`${stages[index].label} · ${goalFields.find(([k])=>k===keys[c])[1]}：“${value}”不是有效数值。`);
        next[index][keys[c]]=Number(numeric);count++;
      });
    });
    if(!count)throw Error('没有可粘贴的数值，空白单元格保持原值。');
    return {goals:normalizeGoals(next),count};
  }
  const api={stages,stageFor,cohort,referenceRows,aggregate,defaultGoals,goalFields,goalChecks,normalizeGoals,auditGoals,parseGoalPaste};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ChainStageStats=api;
})(globalThis);
