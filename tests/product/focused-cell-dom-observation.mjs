// Browser-realm observation of a connected, actually rendered component.
// No application state or projection is modified here. Scroll-clipped text is
// retained: reachability is a separate real-input/layout gate.
export function observeCellContext(root) {
  const doc = root?.ownerDocument ?? document;
  root ??= doc.querySelector('[data-testid="cell-context"]');
  const win = doc.defaultView;
  const exposed = element => {
    if (!element?.isConnected) return false;
    for (let e = element; e; e = e.parentElement) {
      const style = win.getComputedStyle(e);
      if (e.hidden || e.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) ||
          style.opacity === '0' || style.contentVisibility === 'hidden' || e.inert) return false;
    }
    return true;
  };
  // Visual evidence includes aria-hidden text: screen-reader hiding is not paint hiding.
  const paintStyle = element => {
    if (!element?.isConnected) return false;
    let opacity=1;
    for(let e=element;e;e=e.parentElement){
      const css=win.getComputedStyle(e);opacity*=Number(css.opacity);
      if(e.hidden||css.display==='none'||['hidden','collapse'].includes(css.visibility)||css.contentVisibility==='hidden'||opacity<0.05)return false;
    }
    const css=win.getComputedStyle(element);
    const transparent=color=>color==='transparent'||/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color);
    return Number.parseFloat(css.fontSize)>0&&!transparent(css.color)&&!transparent(css.webkitTextFillColor);
  };
  const fragmentVisible=(rect,element,full=false)=>{
    let left=Math.max(0,rect.left),right=Math.min(win.innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(win.innerHeight,rect.bottom);
    for(let e=element;e;e=e.parentElement){
      const css=win.getComputedStyle(e),r=e.getBoundingClientRect();
      if(/hidden|clip|auto|scroll/.test(css.overflowX)){left=Math.max(left,r.left+e.clientLeft);right=Math.min(right,r.left+e.clientLeft+e.clientWidth);}
      if(/hidden|clip|auto|scroll/.test(css.overflowY)){top=Math.max(top,r.top+e.clientTop);bottom=Math.min(bottom,r.top+e.clientTop+e.clientHeight);}
    }
    if(right-left<0.5||bottom-top<0.5)return false;
    if(full&&(left>rect.left+1||right<rect.right-1||top>rect.top+1||bottom<rect.bottom-1))return false;
    return [0.25,0.5,0.75][full?'every':'some'](f=>{
      const hit=doc.elementFromPoint(left+(right-left)*f,top+(bottom-top)/2);
      return hit&&(hit===element||element.contains(hit));
    });
  };
  const paintedTextNode=node=>{
    if(!paintStyle(node.parentElement))return false;
    const range=doc.createRange();range.selectNodeContents(node);
    return [...range.getClientRects()].some(r=>fragmentVisible(r,node.parentElement));
  };
  const leaves=element=>{
    const result=[];
    if(!element)return result;
    const walker=doc.createTreeWalker(element,win.NodeFilter.SHOW_TEXT);
    while(walker.nextNode())if(!walker.currentNode.parentElement.closest('script,style,template,noscript'))result.push(walker.currentNode);
    return result;
  };
  const visual=element=>!!element&&leaves(element).some(n=>n.textContent.trim()&&paintedTextNode(n));
  const visibleText=element=>leaves(element).filter(n=>paintStyle(n.parentElement)).map(n=>n.textContent).join('');
  const semanticKeys=new Set(['location','table','column','row','type','value','value-heading','source','diagnostic']);
  const unclaimedText=leaves(root).filter(n=>{
    if(!paintStyle(n.parentElement))return false;
    for(let e=n.parentElement;e&&e!==root;e=e.parentElement)if(semanticKeys.has(e.dataset.testid?.replace(/^cell-context-/,'')))return false;
    return true;
  }).map(n=>n.textContent).join('');
  const fieldVisual=element=>{
    const nodes=leaves(element).filter(n=>n.textContent.trim()&&paintStyle(n.parentElement));
    if(!nodes.length)return visibleText(element)==='';
    return nodes.every(node=>{
      const range=doc.createRange();range.selectNodeContents(node);const rects=[...range.getClientRects()];
      if(rects.length&&rects.every(r=>fragmentVisible(r,node.parentElement,true)))return true;
      // Full bytes may extend inside an admitted, visible scroll viewport.
      // Actual end/exit input proof is a separate fail-closed layout gate.
      for(let e=node.parentElement;e;e=e.parentElement){
        const css=win.getComputedStyle(e),hint=e.getAttribute('aria-describedby');
        const overflow=(e.scrollWidth>e.clientWidth+1&&/auto|scroll/.test(css.overflowX))||(e.scrollHeight>e.clientHeight+1&&/auto|scroll/.test(css.overflowY));
        if(overflow&&e.tabIndex===0&&hint&&hint.split(/\s+/).every(id=>doc.getElementById(id)?.textContent.trim())&&visual(e))return true;
        if(e===root)break;
      }
      return false;
    });
  };
  const norm = text => text.replace(/\s+/g, ' ').trim();
  const read = key => {
    const nodes = root ? [...root.querySelectorAll(`[data-testid="cell-context-${key}"]`)] : [];
    return {count:nodes.length, exposed:nodes.length === 1 && exposed(nodes[0]), visual:nodes.length===1&&fieldVisual(nodes[0]),
      accessibleText:nodes.length===1?leaves(nodes[0]).filter(n=>exposed(n.parentElement)).map(n=>n.textContent).join(''):null,
      text:nodes.length === 1 ? visibleText(nodes[0]) : null};
  };
  // Region/group accessible-name computation for the two admitted author
  // naming mechanisms. aria-labelledby takes precedence over aria-label.
  const labelledBy = root?.getAttribute('aria-labelledby')?.trim();
  const name = labelledBy ? labelledBy.split(/\s+/).map(id => doc.getElementById(id)?.textContent ?? '').join(' ') : root?.getAttribute('aria-label') ?? '';
  const source = root?.querySelector('[data-testid="cell-context-source"]');
  const isEditing = element => {
    if (element.matches('input,textarea,select,[role="textbox"]') || element.isContentEditable) return true;
    for (let e = element; e; e = e.parentElement) {
      const setting = e.getAttribute('contenteditable');
      if (setting === 'false') return false;
      if (setting === '' || setting === 'true' || setting === 'plaintext-only') return true;
    }
    return false;
  };
  const editableSourceCount = source ? [source,...source.querySelectorAll('*')].filter(isEditing).length : 0;
  const fields = Object.fromEntries(['location','table','column','row','type','value','value-heading','source','diagnostic'].map(key => [key,read(key)]));
  const selected = [...doc.querySelectorAll('[data-testid^="cell:"][aria-selected="true"]')].map(e => {
    const [,entity,field]=e.dataset.testid.split(':'); const r=e.getBoundingClientRect();
    return {entity,field,occurrence:e.dataset.workOccurrence,revision:e.dataset.workRevision,focused:e===doc.activeElement,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
  });
  const selectedRowCount=doc.querySelectorAll('.ts-grid tr[aria-selected="true"],.ts-grid [role="row"][aria-selected="true"]').length;
  const g=doc.querySelector('.ts-grid')?.getBoundingClientRect();
  return {rootCount:doc.querySelectorAll('[data-testid="cell-context"]').length,
    connected:!!root?.isConnected, exposed:exposed(root), visual:visual(root), name:norm(name), role:root?.getAttribute('role') ?? '',
    context:root ? {occurrence:root.dataset.workOccurrence,revision:root.dataset.workRevision,currentness:root.dataset.workCurrentness,entity:root.dataset.workEntity,field:root.dataset.workField}:null,
    fields, allVisibleText:visibleText(root), unclaimedText, surfaceVisibleText:visibleText(doc.body).replace(/Saved \d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2}/g,'[saved-time]'), editableSourceCount,selected,selectedRowCount,
    activeElement:{tag:doc.activeElement?.tagName,text:doc.activeElement?.textContent?.trim()},
    grid:g?{x:g.x,y:g.y,width:g.width,height:g.height}:null};
}

export function contextSnapshotFromObservation(observed) {
  const text=key=>observed.fields[key].count===1&&observed.fields[key].exposed?observed.fields[key].text:null;
  const normalization=key=>text(key)?.replace(/\s+/g,' ').trim()??'';
  // Preserve raw fields and all ambiguity, regardless of target metadata.
  const observationErrors=Object.entries(observed.fields).filter(([,node])=>node.count>1||node.count===1&&!node.exposed).map(([key])=>key);
  return {...observed,location:normalization('location'),table:normalization('table'),column:normalization('column'),row:normalization('row'),type:normalization('type'),
    value:text('value'),valueHeading:normalization('value-heading'),source:text('source'),diagnostic:text('diagnostic'),allContextText:observed.allVisibleText,observationErrors};
}
