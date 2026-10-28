import {ranchSource} from './ranch-workspace.js';
const view=document.body.dataset.ranchView,header=document.getElementById('ranchShell');
const types=`<nav class="order-system-switch" aria-label="订单系统"><a href="./">普通订单</a><a href="ranch-distribution.html" aria-current="page">牧场订单</a></nav>`;
if(header&&!header.children.length)header.innerHTML=`<div class="brand"><span class="brand-icon">牧</span><div><strong>牧场订单</strong><small id="shellProjectName">尚未导入项目</small></div></div>${types}<div class="header-actions"><a class="shell-action" href="ranch.html?import=1">导入 Excel</a><a class="shell-action" href="ranch.html?settings=1">订单规则</a></div>`;
else if(header&&!header.querySelector('.order-system-switch'))header.querySelector('.brand')?.insertAdjacentHTML('afterend',types);
const tabs=[['dashboard','全部等级面板','ranch-distribution.html'],['config','全部等级配置','ranch-config.html'],['analysis','单等级分析','ranch.html']];
if(header&&!document.getElementById('ranchNavigation'))header.insertAdjacentHTML('afterend',`<nav id="ranchNavigation" class="ranch-navigation" aria-label="牧场工作区">${tabs.map(([id,label,path])=>`<a href="${path}" ${id===view?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`);
function sourceLabel(detail){const label=document.getElementById('shellProjectName');if(label){label.textContent=detail.filename??'尚未导入项目';label.title=detail.filename??'';}}
try{const source=ranchSource();sourceLabel({filename:source?.filename??source?.base?.filename});}catch{}
window.addEventListener('ranch:source',event=>sourceLabel(event.detail??{}));
// Flush in-memory edits before leaving the detail view for another workspace tab.
document.addEventListener('click',async event=>{
  const link=event.target.closest?.('a'),href=link?.getAttribute('href');if(!href||href.startsWith('#')||link.hasAttribute('download')||link.target==='_blank'||event.ctrlKey||event.metaKey||event.shiftKey||event.button>0||!window.ranchBeforeNavigate)return;
  const target=new URL(href,window.location.href);if(target.origin!==window.location.origin)return;
  event.preventDefault();try{await window.ranchBeforeNavigate();window.location.href=target.href;}catch(error){const message=document.getElementById('message')??document.getElementById('ranchConfigError')??document.getElementById('distributionError');if(message){message.hidden=false;message.textContent=error.message;}}
});
