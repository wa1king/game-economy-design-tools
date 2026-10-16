importScripts('runtime/pyodide.js');
let activeId=null,queue=Promise.resolve();
self.report_progress=(current,total,product)=>self.postMessage({id:activeId,progress:{current,total,product}});
const ready=(async()=>{
 const python=await loadPyodide({indexURL:new URL('runtime/',self.location.href).href});
 for(const name of ['scheduler.py','browser_engine.py','workbook_writer.py','bootstrap.json']){
  const response=await fetch(new URL(name,self.location.href));if(!response.ok)throw Error('无法加载计算文件 '+name);
  python.FS.writeFile('/home/pyodide/'+name,new Uint8Array(await response.arrayBuffer()));
 }
 await python.runPythonAsync('import sys,json\nsys.path.insert(0,"/home/pyodide")\nimport browser_engine');
 return python;
})();
ready.then(()=>self.postMessage({ready:true})).catch(error=>self.postMessage({startupError:error.message}));
let excelReady;
async function ensureExcel(python){
 if(!excelReady)excelReady=(async()=>{
  for(const name of ['et_xmlfile-2.0.0-py3-none-any.whl','openpyxl-3.1.5-py2.py3-none-any.whl']){
   const response=await fetch(new URL('runtime/'+name,self.location.href));if(!response.ok)throw Error('Excel 依赖加载失败');
   python.unpackArchive(new Uint8Array(await response.arrayBuffer()),'zip',{extractDir:'/home/pyodide/packages'});
  }
  await python.runPythonAsync('sys.path.insert(0,"/home/pyodide/packages")\nimport openpyxl,workbook_writer');
 })();
 return excelReady;
}
async function execute(message){
 activeId=message.id;
 try{
  const python=await ready;
  if(['import','export'].includes(message.kind))await ensureExcel(python);
  python.globals.set('_payload_json',JSON.stringify(message.payload));
  python.globals.set('_kind',message.kind);
  if(message.kind==='export'){
   await python.runPythonAsync('workbook_writer.save_plan(json.loads(_payload_json),"/home/pyodide/result.xlsx")');
   const bytes=python.FS.readFile('/home/pyodide/result.xlsx');
   self.postMessage({id:message.id,result:{bytes}},[bytes.buffer]);
  }else{
   const raw=await python.runPythonAsync('import json\njson.dumps(browser_engine.execute(_kind,json.loads(_payload_json)),ensure_ascii=False)');
   self.postMessage({id:message.id,result:JSON.parse(raw)});
  }
 }catch(error){self.postMessage({id:message.id,error:error.message||String(error)})}
 finally{activeId=null}
}
self.onmessage=event=>{queue=queue.then(()=>execute(event.data),()=>execute(event.data))};
