import {createSessionSnapshot,validateSessionSnapshot,fetchSharedSession} from './session-snapshot.js';
import {captureComputeCache} from './session-compute-cache.js';

export function createSessionBackupView(api){
  const button=document.createElement('button');button.id='sessionBackup';button.className='quiet';button.textContent='备份 / 恢复';
  document.querySelector('main .workspace-actionbar .workspace-actions').append(button);
  const dialog=document.createElement('dialog');dialog.className='session-dialog';dialog.setAttribute('aria-labelledby','sessionBackupTitle');
  dialog.innerHTML=`<div class="session-heading"><h2 id="sessionBackupTitle">项目备份</h2><button type="button" id="closeSessionBackup" aria-label="关闭项目备份">×</button></div><p id="sessionBackupSummary"></p><p id="sessionBackupError" role="alert" hidden></p><div class="session-actions"><button id="saveSessionBackup" class="primary" type="button">下载备份</button><button id="importSessionBackup" class="quiet" type="button">恢复文件</button><button id="loadSharedSession" class="quiet" type="button">使用已同步配置</button></div><input id="sessionBackupFile" type="file" accept=".json,application/json" hidden><div id="sessionRestoreConfirm" hidden><p id="sessionRestoreSummary"></p><button id="applySessionRestore" class="primary" type="button">确认恢复</button><button id="cancelSessionRestore" class="quiet" type="button">取消</button></div><details><summary>查看备份内容</summary><textarea id="sessionBackupText" aria-label="项目与经营存档备份内容" readonly spellcheck="false"></textarea></details>`;
  document.querySelector('main').append(dialog);
  const $=id=>dialog.querySelector('#'+id);let current=null,pending=null;
  function error(message=''){$('sessionBackupError').hidden=!message;$('sessionBackupError').textContent=message;}
  async function refresh(){
    pending=null;$('sessionRestoreConfirm').hidden=true;error();current=null;
    $('saveSessionBackup').disabled=true;$('sessionBackupSummary').textContent='正在读取配置与计算缓存…';$('sessionBackupText').value='';
    try{const p=api.getProject();if(p){current=createSessionSnapshot(p,localStorage);current.computeCache=await captureComputeCache(p,localStorage);}}
    catch(e){current=null;error(e.message);}
    const cache=current?.computeCache;
    $('sessionBackupSummary').textContent=current?`${current.project.base.products.length} 商品 · ${Object.keys(current.project.configs).length} 级配置 · 普通拟合缓存 ${cache.ordinary.length} 级 · 牧场排程缓存 ${cache.ranch.length} 级 · ${current.gameSaves.length} 份经营存档`:'可恢复已有备份，或先导入项目。';
    $('sessionBackupText').value='';dialog.querySelector('details').open=false;$('saveSessionBackup').disabled=!current;
  }
  function preview(value){pending=validateSessionSnapshot(value);$('sessionRestoreSummary').textContent=`恢复「${pending.project.filename}」的 ${Object.keys(pending.project.configs).length} 级配置和 ${pending.gameSaves.length} 份经营存档。当前数据会先备份。`;$('sessionRestoreConfirm').hidden=false;error();}
  dialog.querySelector('details').ontoggle=()=>{if(dialog.querySelector('details').open&&current)$('sessionBackupText').value=JSON.stringify(current);else $('sessionBackupText').value='';};
  button.onclick=()=>{dialog.showModal();void refresh();};$('closeSessionBackup').onclick=()=>dialog.close();
  $('saveSessionBackup').onclick=()=>{if(current)api.download(JSON.stringify(current),'订单项目与经营存档.json','application/json');};
  $('importSessionBackup').onclick=()=>$('sessionBackupFile').click();
  $('sessionBackupFile').onchange=async()=>{try{const file=$('sessionBackupFile').files[0];if(!file)return;if(file.size>256*1024*1024)throw Error('备份文件过大。');preview(JSON.parse(await file.text()));}catch(e){error(e.message);}finally{$('sessionBackupFile').value='';}};
  $('loadSharedSession').onclick=async()=>{try{const value=await fetchSharedSession();if(!value)throw Error('尚无已同步配置。');preview(value);}catch(e){error(e.message);}};
  $('cancelSessionRestore').onclick=()=>{pending=null;$('sessionRestoreConfirm').hidden=true;};
  $('applySessionRestore').onclick=async()=>{
    if(!pending)return;$('applySessionRestore').disabled=true;
    try{await api.restore(pending);dialog.close();}catch(e){error(e.message);}finally{$('applySessionRestore').disabled=false;}
  };
  return {refresh};
}
