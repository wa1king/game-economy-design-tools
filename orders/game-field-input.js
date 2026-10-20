// Sample the entire pointer path so fast drags cannot skip narrow plots.
export function fieldPath(from,to,spacing=8){
  const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/spacing));
  return Array.from({length:steps},(_,i)=>({x:from.x+(to.x-from.x)*(i+1)/steps,y:from.y+(to.y-from.y)*(i+1)/steps}));
}

export function createFieldStroke(onVisit){
  let stroke=null;
  function visit(index){
    if(index==null||stroke.seen.has(index))return;
    if(!stroke.anchorReached&&index!==stroke.anchorIndex)return;
    stroke.seen.add(index);
    if(onVisit(index,stroke.mode,stroke.productId)===false)return;
    stroke.hasAction=true;
    if(index===stroke.anchorIndex)stroke.anchorReached=true;
  }
  return {
    get active(){return stroke!==null;},
    get mode(){return stroke?.mode??null;},
    get hasAction(){return stroke?.hasAction??false;},
    get anchorReached(){return stroke?.anchorReached??false;},
    begin({pointerId,mode,productId,point,index,anchorIndex}){stroke={pointerId,mode,productId,last:point,seen:new Set(),anchorIndex,anchorReached:anchorIndex==null,hasAction:false};visit(index);},
    move(pointerId,point,hitTest){if(!stroke||stroke.pointerId!==pointerId)return;for(const p of fieldPath(stroke.last,point)){visit(hitTest(p));}stroke.last=point;},
    end(pointerId){if(stroke&&stroke.pointerId===pointerId){stroke=null;return true;}return false;},
    cancel(){stroke=null;}
  };
}
