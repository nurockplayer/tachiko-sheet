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
          style.opacity === '0' || style.contentVisibility === 'hidden') return false;
    }
    return true;
  };
  const visibleText = element => {
    if (!exposed(element)) return '';
    let text = '';
    for (const child of element.childNodes) {
      if (child.nodeType === 3) text += child.textContent;
      else if (child.nodeType === 1) text += visibleText(child);
    }
    return text;
  };
  const norm = text => text.replace(/\s+/g, ' ').trim();
  const read = key => {
    const nodes = root ? [...root.querySelectorAll(`[data-testid="cell-context-${key}"]`)] : [];
    return {count:nodes.length, exposed:nodes.length === 1 && exposed(nodes[0]),
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
  return {connected:!!root?.isConnected, exposed:exposed(root), name:norm(name), role:root?.getAttribute('role') ?? '',
    context:root ? {occurrence:root.dataset.workOccurrence,revision:root.dataset.workRevision,currentness:root.dataset.workCurrentness,entity:root.dataset.workEntity,field:root.dataset.workField}:null,
    fields, allVisibleText:visibleText(root), editableSourceCount,selected,selectedRowCount,
    activeElement:{tag:doc.activeElement?.tagName,text:doc.activeElement?.textContent?.trim()},
    grid:g?{x:g.x,y:g.y,width:g.width,height:g.height}:null};
}
