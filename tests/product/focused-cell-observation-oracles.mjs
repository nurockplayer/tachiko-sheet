// Browser-compatible fixed assertions. Every state validates the preserved raw
// observation first; ambiguous or hidden DOM never becomes genuine absence.
function requireObservation(condition,message) {if(!condition)throw new Error(message);}
const keys=['location','table','column','row','type','value','value-heading','source','diagnostic'];
export function assertObservationIntegrity(actual,{root='open'}={}) {
  requireObservation(root==='open'||root==='home','explicit admitted root scenario');
  requireObservation(actual.rootCount===(root==='open'?1:0),'context root count must match scenario');
  if(root==='open')requireObservation(actual.connected&&actual.exposed&&actual.name==='Cell context'&&['region','group'].includes(actual.role),'unique context root is connected, exposed and named');
  else requireObservation(!actual.context&&!actual.connected,'Home has no context root');
  requireObservation(Array.isArray(actual.observationErrors)&&actual.observationErrors.length===0,'raw observation errors cannot be absence');
  for(const key of keys) {
    const node=actual.fields?.[key];
    requireObservation(node&&(node.count===0||node.count===1),'ambiguous semantic node: '+key);
    requireObservation(node.count===0?node.text===null&&!node.exposed:node.exposed&&typeof node.text==='string','unexposed/invalid semantic node: '+key);
    const prop=key==='value-heading'?'valueHeading':key;
    const raw=node.count===1?node.text:null;
    const expected=['location','table','column','row','type','value-heading'].includes(key)?raw?.replace(/\s+/g,' ').trim()??'':raw;
    requireObservation(actual[prop]===expected,'normalized observation must retain raw evidence: '+key);
  }
  requireObservation(actual.selectedRowCount===0,'row is not exposed as selected');
}
export function assertNeutralContext(actual,scenario) {
  assertObservationIntegrity(actual,scenario);
  requireObservation(actual.selected.length===0,'neutral has no selected cell');
  if(actual.rootCount===1)requireObservation(actual.fields.value.count===1,'neutral reserved strip has visible value/placeholder');
  requireObservation(actual.fields.source.count===0&&actual.source===null,'neutral has no prior source');
  for(const key of ['location','table','column','row','type'])requireObservation(actual[key]==='','neutral withholds prior '+key);
  requireObservation([null,'','No field selected'].includes(actual.value),'neutral has no successful prior value');
  requireObservation(!actual.context?.entity&&!actual.context?.field,'neutral has no prior target identity');
}
export function assertWithheldContext(actual,prior,scenario) {
  assertObservationIntegrity(actual,scenario);
  if(actual.rootCount===1)requireObservation(actual.fields.value.count===1,'unknown reserved strip has visible status');
  requireObservation(actual.fields.source.count===0&&actual.source===null,'unknown withholds source');
  requireObservation([null,'','Awaiting confirmation','Unavailable','Refresh to confirm current values'].includes(actual.value),'unknown has no stale successful value');
  for(const key of ['location','table','column','row','type'])requireObservation(actual[key]==='','unknown withholds prior '+key);
  requireObservation(!actual.context?.entity&&!actual.context?.field,'unknown withholds prior target identity');
  requireObservation(!actual.context||actual.context.currentness!=='current','unknown cannot look current');
  requireObservation(!actual.allContextText.includes(prior.source),'unknown cannot show prior source');
}
