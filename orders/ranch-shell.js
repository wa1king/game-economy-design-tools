import {readChainExcel} from './excel-import.js';
import {prepareRanch} from './ranch-engine.js';
import {writeSharedChainSource} from './shared-chain-source.js';
import {downloadRanchWorkbook} from './ranch-export.js';
import {setupRanchRulesDialog} from './ranch-rules-dialog.js';
import {ranchSource} from './ranch-workspace.js';
const view=document.body.dataset.ranchView,header=document.getElementById('ranchShell'),main=document.querySelector('main');
const types=`<nav class="order-system-switch" aria-label="订单系统"><a href="./">普通订单</a><a href="ranch-distribution.html" aria-current="page">牧场订单</a></nav>`;
if(header&&!header.children.length)header.innerHTML=`<div class="brand"><span class="brand-icon">牧</span><div><strong>牧场订单</strong><small id="shellProjectName">尚未导入项目</small></div></div>${types}`;
else if(header&&!header.querySelector('.order-system-switch'))header.querySelector('.brand')?.insertAdjacentHTML('afterend',types);
if(header&&!document.getElementById('importButton'))header.insertAdjacentHTML('beforeend',`<div class="shared-data-actions"><button id="importButton" class="shell-action" type="button">导入 Excel</button><input id="importFile" type="file" accept=".xlsx" hidden><button id="exportRanchExcel" class="shell-action" type="button">导出 Excel</button></div>`);
const globalActions=header?.querySelector('.shared-data-actions');
globalActions?.insertAdjacentHTML('afterbegin','<span id="sharedActionStatus" class="shared-action-status" role="status"></span>');
const actionMessage=text=>{const status=document.getElementById('sharedActionStatus');if(status){status.textContent=text;status.title=text;}};
const importButton=document.getElementById('importButton'),importFile=document.getElementById('importFile'),exportButton=document.getElementById('exportRanchExcel');
if(importButton)importButton.onclick=()=>importFile.click();
if(importFile)importFile.onchange=async()=>{
  const file=importFile.files[0];if(!file)return;
  importButton.disabled=exportButton.disabled=true;
  try{
    if(file.size>60*1024*1024)throw Error('文件超过60 MB，请缩小导入数据。');
    actionMessage('正在导入…');const base=await readChainExcel(file);prepareRanch(base);
    await window.ranchBeforeNavigate?.({leaving:false});writeSharedChainSource(base,file.name);
    window.location.reload();
  }catch(error){actionMessage(error.message);}finally{importButton.disabled=exportButton.disabled=false;importFile.value='';}
};
if(exportButton)exportButton.onclick=async()=>{
  importButton.disabled=exportButton.disabled=true;
  try{actionMessage('正在导出全部等级…');await downloadRanchWorkbook({beforeExport:()=>window.ranchBeforeNavigate?.({leaving:false})});actionMessage('已导出全部等级订单明细');}
  catch(error){actionMessage(error.message);}finally{importButton.disabled=exportButton.disabled=false;}
};
const tabs=[['dashboard','全部等级面板','ranch-distribution.html'],['config','全部等级配置','ranch-config.html'],['analysis','单等级分析','ranch.html']];
if(main&&!document.getElementById('ranchNavigation')){
  const actions=main.querySelector('.workspace-actionbar')?'':`<section class="workspace-actionbar" aria-label="牧场订单操作"><span id="shellSourceMeta" class="workspace-meta"></span><div class="workspace-actions"><button id="openSettings" class="shell-action" type="button" aria-haspopup="dialog" aria-controls="ranchRulesDialog">订单规则</button></div></section>`;
  main.insertAdjacentHTML('afterbegin',`<nav id="ranchNavigation" class="ranch-navigation" aria-label="牧场工作区">${tabs.map(([id,label,path])=>`<a href="${path}" ${id===view?'aria-current="page"':''}>${label}</a>`).join('')}</nav>${actions}`);
}
const rulesDialog=setupRanchRulesDialog();
if(new URLSearchParams(window.location.search??'').get('settings')==='1')window.addEventListener('DOMContentLoaded',()=>rulesDialog.open(),{once:true});
window.addEventListener('ranch:rules-applied',()=>{if(view!=='analysis')window.location.reload();});
function sourceLabel(detail){const label=document.getElementById('shellProjectName');if(label){label.textContent=detail.filename??'尚未导入项目';label.title=detail.filename??'';}}
try{const source=ranchSource();const meta=document.getElementById('shellSourceMeta');if(meta&&source?.base)meta.textContent=`${source.base.products.length} 商品 · ${source.base.products.filter(p=>p.coinValue!=null).length} 个已定价`;sourceLabel({filename:source?.filename??source?.base?.filename});}catch{}
window.addEventListener('ranch:source',event=>sourceLabel(event.detail??{}));
// Flush in-memory edits before leaving the detail view for another workspace tab.
document.addEventListener('click',async event=>{
  const link=event.target.closest?.('a'),href=link?.getAttribute('href');if(!href||href.startsWith('#')||link.hasAttribute('download')||link.target==='_blank'||event.ctrlKey||event.metaKey||event.shiftKey||event.button>0||!window.ranchBeforeNavigate)return;
  const target=new URL(href,window.location.href);if(target.origin!==window.location.origin)return;
  event.preventDefault();try{await window.ranchBeforeNavigate();window.location.href=target.href;}catch(error){const message=document.getElementById('message')??document.getElementById('ranchConfigError')??document.getElementById('distributionError');if(message){message.hidden=false;message.textContent=error.message;}}
});
