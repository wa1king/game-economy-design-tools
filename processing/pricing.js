(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ChainPricing=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DEFAULT_TIMES=[[120,1],[300,2],[600,3],[1200,4],[1800,5],[3600,6],[7200,7],[10800,8],[14400,9],[18000,10]];
  const EPSILON=1e-6;
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const isNumber=value=>typeof value==='number'&&Number.isFinite(value);
  function sourceRows(buildings){
    if(!Array.isArray(buildings))throw Error('建筑列表格式不正确。');
    const rows=[{id:0,name:'田地'},...buildings.filter(b=>b&&String(b.id)!=='0').slice().sort((a,b)=>(a.level||0)-(b.level||0)||String(a.id).localeCompare(String(b.id),undefined,{numeric:true}))];
    const seen=new Set();
    for(const row of rows){if(row.id===undefined||row.id===null||String(row.id)===''||seen.has(String(row.id)))throw Error('建筑编号缺失或重复。');seen.add(String(row.id))}
    return rows;
  }
  function normalizeTimes(rows){
    if(!Array.isArray(rows)||rows.length<2)throw Error('至少配置两个时间点。');
    const result=rows.map(row=>{
      if(!row||!isNumber(row.seconds)||row.seconds<=0)throw Error('时间须为大于 0 的秒数。');
      if(!isNumber(row.value)||row.value<0)throw Error('时间价值须为非负数。');
      return {seconds:row.seconds,value:row.value};
    }).sort((a,b)=>a.seconds-b.seconds);
    for(let i=1;i<result.length;i++){
      if(result[i].seconds-result[i-1].seconds<=EPSILON)throw Error('时间点不能重复。');
      if(result[i].value<result[i-1].value)throw Error('时间越长，价值不能降低。');
    }
    return result;
  }
  function defaultConfig(buildings=[]){
    return {version:1,timeValues:DEFAULT_TIMES.map(([seconds,value])=>({seconds,value})),sourceCoefficients:Object.fromEntries(sourceRows(buildings).map(row=>[String(row.id),String(row.id)==='0'?1:2]))};
  }
  function normalizeConfig(config,buildings=[]){
    if(config===undefined)return defaultConfig(buildings);
    if(!config||typeof config!=='object'||Array.isArray(config))throw Error('价格配置格式不正确。');
    if(config.version!==undefined&&config.version!==1)throw Error('不支持此价格配置版本。');
    const timeValues=normalizeTimes(config.timeValues);
    const raw=config.sourceCoefficients===undefined?{}:config.sourceCoefficients;
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('来源系数格式不正确。');
    for(const value of Object.values(raw))if(!isNumber(value)||value<0)throw Error('来源系数须为非负数。');
    const sourceCoefficients=Object.fromEntries(sourceRows(buildings).map(row=>{
      const key=String(row.id);return [key,own(raw,key)?raw[key]:key==='0'?1:2];
    }));
    return {version:1,timeValues,sourceCoefficients};
  }
  function interpolate(seconds,rows){
    if(!isNumber(seconds)||seconds<=0)throw Error('生产时间须为正数。');
    const exact=rows.find(row=>Math.abs(row.seconds-seconds)<=EPSILON);
    if(exact)return {value:exact.value,estimated:false,mode:'exact'};
    let right=rows.findIndex(row=>row.seconds>seconds),mode='interpolation';
    if(right===0){right=1;mode='extrapolation'}
    else if(right<0){right=rows.length-1;mode='extrapolation'}
    const a=rows[right-1],b=rows[right];
    const value=Math.max(0,a.value+(seconds-a.seconds)*(b.value-a.value)/(b.seconds-a.seconds));
    if(!Number.isFinite(value))throw Error('时间价值超出可计算范围。');
    return {value,estimated:true,mode};
  }
  function timeValue(seconds,config){return interpolate(seconds,normalizeTimes(config===undefined?defaultConfig().timeValues:config.timeValues))}
  function evaluate(design,config){
    if(!design||!Array.isArray(design.products))throw Error('商品列表格式不正确。');
    const normalized=normalizeConfig(config===undefined?design.pricing:config,design.buildings||[]),index=new Map(),duplicates=new Set(),memo=new Map(),visiting=new Set(),causes=new Map();
    for(const product of design.products){const id=String(product.id);if(index.has(id))duplicates.add(id);index.set(id,product)}
    function visit(product){
      const id=String(product.id);
      if(memo.has(id))return memo.get(id);
      const result={id:product.id,name:product.name,seconds:product.time*60,timeValue:null,coefficient:null,materialCost:null,addedValue:null,price:null,estimated:false,priceEstimated:false,estimateMode:null,error:null};
      if(visiting.has(id))return {...result,error:'配方存在循环。'};
      visiting.add(id);
      try{
        if(product.id===undefined||product.id===null||duplicates.has(id))throw Error('商品编号缺失或重复。');
        if(!isNumber(product.time)||product.time<=0)throw Error('生产时间须为正数。');
        const value=interpolate(result.seconds,normalized.timeValues);
        result.timeValue=value.value;result.estimated=value.estimated;result.priceEstimated=value.estimated;result.estimateMode=value.mode;
        const source=String(product.building);
        if(!own(normalized.sourceCoefficients,source))throw Error('所属建筑不存在。');
        result.coefficient=normalized.sourceCoefficients[source];
        result.addedValue=value.value*result.coefficient;
        if(!Number.isFinite(result.addedValue))throw Error('本步价值超出可计算范围。');
        if(!Array.isArray(product.inputs))throw Error('配方格式不正确。');
        if(source!=='0'&&!product.inputs.length)throw Error('没有原料，请重新设计配方。');
        if(source==='0'&&product.inputs.length)throw Error('作物不需要配方。');
        let materialCost=0;const seenInputs=new Set();
        for(const input of product.inputs){
          if(!Array.isArray(input)||input.length!==2)throw Error('配方格式不正确。');
          const [up,quantity]=input,key=String(up);
          if(!Number.isInteger(quantity)||quantity<1)throw Error('原料数量须为正整数。');
          if(seenInputs.has(key))throw Error('配方含重复原料。');seenInputs.add(key);
          if(!index.has(key))throw Error('配方原料不存在。');
          const upstream=visit(index.get(key));
          result.priceEstimated=result.priceEstimated||upstream.priceEstimated;
          if(upstream.error){const cause=causes.get(key)||upstream.error,error=Error(`原料“${upstream.name||up}”价格不可用：${cause}`);error.priceCause=cause;throw error}
          materialCost+=quantity*upstream.price;
        }
        result.materialCost=materialCost;
        const price=Math.trunc(materialCost+result.addedValue);
        if(!Number.isSafeInteger(price))throw Error('商品价格超出可计算范围。');
        result.price=price;
      }catch(error){result.error=error.message||'价格计算失败。';causes.set(id,error.priceCause||result.error)}
      visiting.delete(id);memo.set(id,result);return result;
    }
    const products=design.products.map(visit);
    const warnings=products.filter(product=>product.estimated).map(product=>({id:product.id,name:product.name,seconds:product.seconds,mode:product.estimateMode}));
    return {config:normalized,products,warnings};
  }
  function readTSV(text){
    text=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    if(text.length>30000)throw Error('粘贴内容过大，请只复制配置区域。');
    const rows=[[]];let cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const char=text[i];
      if(char==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else if(quoted||!cell)quoted=!quoted;else cell+=char}
      else if(!quoted&&(char==='\t'||char==='\n')){rows[rows.length-1].push(cell.trim());cell='';if(char==='\n')rows.push([])}
      else cell+=char;
    }
    if(quoted)throw Error('粘贴内容的引号不完整。');
    rows[rows.length-1].push(cell.trim());
    while(rows.length&&rows[rows.length-1].every(cell=>!cell))rows.pop();
    if(!rows.length)throw Error('没有可粘贴的数值。');
    if(rows.some(row=>row.length!==rows[0].length))throw Error('矩阵各行列数不一致。');
    return rows;
  }
  function numeric(text,label){
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))throw Error(`${label}必须是数值。`);
    const n=Number(text);if(!Number.isFinite(n))throw Error(`${label}必须是有限数值。`);return n;
  }
  const cleanHeader=value=>value.toLowerCase().replace(/[\s_\-—:：()（）\/]/g,'');
  const timeHeaders=new Set(['时间','时间s','时间秒','单步时间s','单步时间秒','秒','s','seconds','timeseconds','time']);
  const valueHeaders=new Set(['价值','金币价值','时间价值','价值金币','value','coinvalue']);
  const sourceHeaders=new Set(['来源','生产来源','建筑','生产建筑','所属建筑','source','名称','名字']);
  const coefficientHeaders=new Set(['价值系数','来源系数','相对价值系数','系数','coefficient']);
  function anchor(row,column,width){if(!Number.isInteger(row)||row<0||!Number.isInteger(column)||column<0||column>=width)throw Error('粘贴起点不正确。')}
  function pasteTimes(text,currentRows,startRow=0,startColumn=0){
    const current=normalizeTimes(currentRows),rows=readTSV(text),first=rows[0].map(cleanHeader);
    const hasHeader=first.some(value=>timeHeaders.has(value)||valueHeaders.has(value));
    let result=current.map(row=>({...row})),columns;
    if(hasHeader){
      if(first.length!==2||first.filter(value=>timeHeaders.has(value)).length!==1||first.filter(value=>valueHeaders.has(value)).length!==1)throw Error('表头须包含“时间-s”和“价值”。');
      columns=first.map(value=>timeHeaders.has(value)?'seconds':'value');rows.shift();
      if(!rows.length)throw Error('表头下没有数值。');result=[];startRow=0;
    }else{
      anchor(startRow,startColumn,2);
      if(startRow>current.length||rows[0].length+startColumn>2)throw Error('粘贴区域超出时间价值表。');
      columns=['seconds','value'].slice(startColumn,startColumn+rows[0].length);
    }
    rows.forEach((row,index)=>{
      const target=startRow+index,previous=current[target],next={...(result[target]||previous||{})};
      row.forEach((cell,column)=>{if(cell!=='')next[columns[column]]=numeric(cell,columns[column]==='seconds'?'时间':'价值')});
      result[target]=next;
    });
    return normalizeTimes(result);
  }
  function pasteCoefficients(text,buildings,currentMap,startRow=0,startColumn=0){
    const sources=sourceRows(buildings),normalized=normalizeConfig({version:1,timeValues:defaultConfig().timeValues,sourceCoefficients:currentMap},buildings);
    const result={...normalized.sourceCoefficients},rows=readTSV(text),first=rows[0].map(cleanHeader);
    let labeled=rows[0].length===2,nameColumn=0,valueColumn=labeled?1:0;
    const hasHeader=first.some(value=>sourceHeaders.has(value)||coefficientHeaders.has(value));
    if(hasHeader){
      if(first.length===1&&coefficientHeaders.has(first[0]))labeled=false;
      else if(first.length===2&&first.filter(value=>coefficientHeaders.has(value)).length===1&&first.filter(value=>sourceHeaders.has(value)||value==='').length===1){labeled=true;valueColumn=first.findIndex(value=>coefficientHeaders.has(value));nameColumn=1-valueColumn}
      else throw Error('表头须为“来源”和“价值系数”。');
      rows.shift();if(!rows.length)throw Error('表头下没有数值。');
    }
    if(rows[0].length>2)throw Error('来源系数最多粘贴两列。');
    if(!labeled){
      anchor(startRow,startColumn,2);
      // A numeric column always targets coefficient values, including a dialog-wide paste.
      if(startRow+rows.length>sources.length)throw Error('粘贴行数超出来源数量。');
    }
    const names=new Map(),aliases=new Map([['田地','0'],['农田','0']]);
    for(const source of sources){const name=String(source.name||'').trim();if(name)names.set(name,names.has(name)?null:String(source.id))}
    sources.slice(1).forEach((source,index)=>aliases.set(`建筑${index+1}`,String(source.id)));
    function resolve(label){
      if(own(result,label))return label;
      if(names.has(label)){if(names.get(label)===null)throw Error(`来源“${label}”重名，请使用编号。`);return names.get(label)}
      if(aliases.has(label))return aliases.get(label);
      throw Error(`未找到来源“${label}”。`);
    }
    const changed=new Set();
    rows.forEach((row,index)=>{
      const key=labeled?resolve(row[nameColumn]):String(sources[startRow+index].id);
      if(changed.has(key))throw Error('同一来源不能重复粘贴。');changed.add(key);
      const cell=row[valueColumn];if(cell!=='')result[key]=numeric(cell,'价值系数');
    });
    return normalizeConfig({...normalized,sourceCoefficients:result},buildings).sourceCoefficients;
  }
  return {defaultConfig,normalizeConfig,evaluate,timeValue,pasteTimes,pasteCoefficients};
});
