'use strict';
/* FES45 v3 deterministic HTML design harness. Fixed illustrative states only.
 * No product code imports, network data, persistence, calculations, or commands.
 * Shared factories below construct source candidates AND every board instance.
 */
(() => {
 const C=FES_COLORS, TYPES=FES_TYPES, PREFIX='FES45/v3/';
 let serial=0;
 const allComponents=[];
 function component(el,family,state='Default'){
   el.dataset.component=PREFIX+'Components/'+family;el.dataset.variant=state;el.dataset.instance=String(++serial);
   allComponents.push({key:PREFIX+'Components/'+family,state});return el;
 }
 function node(tag='div',cls='',parent=null){const e=document.createElement(tag);e.className=cls;if(parent)parent.append(e);return e;}
 function rect(e,x,y,w,h){Object.assign(e.style,{position:'absolute',left:x+'px',top:y+'px',width:w+'px',height:h+'px'});return e;}
 function box(parent,cls,x,y,w,h,fill){const e=rect(node('div','box '+cls,parent),x,y,w,h);if(fill)e.style.background=fill;return e;}
 function rich(e,s){
   // Known fixture-language runs, never transliteration or changed number formatting.
   const re=/(東京オフィス|確認後に更新します。|決算資料を確認中です。|佐藤美咲|台北辦公室|待核對下一批資料。|林怡君)/g;
   let at=0;for(const m of s.matchAll(re)){e.append(document.createTextNode(s.slice(at,m.index)));const t=node('span',/台北|待核|林怡/.test(m[0])?'tc':'jp',e);t.lang=t.className==='tc'?'zh-Hant':'ja';t.textContent=m[0];at=m.index+m[0].length;}e.append(document.createTextNode(s.slice(at)));
 }
 function text(p,s,x,y,w,h,type='Body',ink='text/primary',opts={}){
   const e=rect(node('div','text'+(opts.single?' single':''),p),x,y,w,h);const [size,line,weight]=TYPES[type];
   Object.assign(e.style,{fontSize:size+'px',lineHeight:line+'px',fontWeight:String(weight),color:C[ink]||ink,textAlign:opts.align||'left'});
   if(opts.italic)e.style.fontStyle='italic';if(opts.lang){e.lang=opts.lang;e.style.fontFamily=opts.lang==='ja'?"'FES Japanese'":"'FES Traditional Chinese'";}
   rich(e,String(s));e.dataset.textStyle=type;e.dataset.fullText=String(s);e.dataset.inkRole=ink;
   if(opts.single){e.title=String(s);e.setAttribute('aria-label',String(s));}
   return e;
 }
 function measure(s,w,type='Body',opts={}){
   const el=text(document.body,s,-100000,0,Math.max(1,w),0,type,'text/primary',opts);el.style.height='auto';el.style.visibility='hidden';
   const lines=Math.max(1,Math.round(el.getBoundingClientRect().height/TYPES[type][1]));el.remove();return lines;
 }
 function advance(s,type='Label'){
   const e=text(document.body,s,-100000,0,1000,TYPES[type][1],type);e.style.width='max-content';e.style.whiteSpace='nowrap';e.style.visibility='hidden';const n=Math.ceil(e.getBoundingClientRect().width);e.remove();return n;
 }
 const ICONS={
  Copy:'<rect x="6" y="5" width="7.5" height="8.5" rx="1.5"/><path d="M10.5 5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9A1.5 1.5 0 0 0 3.5 10.5H6"/>',
  Table:'<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M2.5 6.5H13.5M6.5 6.5V13.5"/>',
  Summary:'<path d="M3 2.5V13.5H13.5M6 10V7M9 10V4M12 10V6"/>',
  Brief:'<path d="M9.5 2.5H4A1.5 1.5 0 0 0 2.5 4V12A1.5 1.5 0 0 0 4 13.5H12A1.5 1.5 0 0 0 13.5 12V6.5L9.5 2.5ZM9.5 2.5V6.5H13.5M5.5 9.5H10.5"/>',
  Exchange:'<path d="M2 5H13M10 2L13 5L10 8M14 11H3M6 8L3 11L6 14"/>',
  Hash:'<path d="M6.5 2L4.5 14M11.5 2L9.5 14M2.5 6H14M2 10H13.5"/>',
  Edit:'<path d="M10.5 2.5A1.8 1.8 0 0 1 13 5L6 12L2.5 13.5L4 10L10.5 2.5ZM9 4L12 7"/>',
  Refresh:'<path d="M13 5.5A5.3 5.3 0 1 0 13 10.5"/><path d="M13 2.5V5.5H10"/>',
  ChevronDown:'<path d="M4 6L8 10L12 6"/>',
  More:'<circle cx="4" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>',
  Clock:'<circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8L10.5 9.5"/>',
  Check:'<path d="M3.5 8L6.5 11L12.5 4.5"/>',
  Warning:'<path d="M8 2L14 13H2Z"/><path d="M8 6V9"/><circle cx="8" cy="11" r=".65" fill="currentColor" stroke="none"/>',
  Unknown:'<circle cx="8" cy="8" r="5.5"/><path d="M6.2 6A1.8 1.8 0 0 1 9.8 6C9.8 7.2 8 7.2 8 8.8"/><circle cx="8" cy="11" r=".65" fill="currentColor" stroke="none"/>',
  Lock:'<rect x="3.5" y="7" width="9" height="7" rx="1.5"/><path d="M5.5 7V4.5A2.5 2.5 0 0 1 10.5 4.5V7"/>'
 };
 function icon(p,name,x,y,ink='text/primary'){
   const e=box(p,'icon',x,y,16,16);e.style.color=C[ink]||ink;e.setAttribute('aria-hidden','true');e.innerHTML=`<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;e.dataset.icon=name;return e;
 }
 function button(p,label,x,y,w,kind='Secondary',state='Default',glyph=null){
   const e=rect(node('button','control '+kind.toLowerCase()+(glyph?' icon-button':''),p),x,y,w,32);e.type='button';e.dataset.state=state;e.dataset.command=label;e.setAttribute('aria-label',label);
   e.disabled=state==='Disabled'||state==='Busy';if(state==='Busy')e.setAttribute('aria-busy','true');
   if(glyph){icon(e,state==='Busy'?'Clock':glyph,8,8,state==='Disabled'?'text/disabled':state==='Busy'?'warning/ink':'currentColor');component(e,'IconButton',state);}
   else if(state==='Busy'){icon(e,'Clock',10,8,'warning/ink');text(e,label==='Save a copy'?'Saving…':'Working…',34,6,w-42,20,'Body','warning/ink',{single:true});component(e,'Button/'+kind,state);}
   else {if(label==='Save a copy'||label==='Refresh'){const group=node('span','button-content',e);const i=icon(group,label==='Save a copy'?'Copy':'Refresh',0,0,'currentColor');i.style.position='relative';const span=node('span','button-label',group);span.textContent=label;}else{const span=node('span','button-label',e);span.textContent=label;}component(e,'Button/'+kind,state);}
   return e;
 }
 function selector(p,x,y,w=200,state='Default'){
   const e=button(p,'Table',x,y,w,'Secondary',state);e.classList.add('select');e.dataset.command='CollectionSelect';e.replaceChildren();e.setAttribute('aria-label','Table: Operations');e.setAttribute('aria-haspopup','listbox');e.setAttribute('aria-expanded',String(state==='Open'));
   icon(e,'Table',10,8,state==='Disabled'?'text/disabled':'accent/ink');text(e,'Operations',34,6,w-62,20,'Body',state==='Disabled'?'text/disabled':'text/primary',{single:true});icon(e,'ChevronDown',w-24,8,state==='Disabled'?'text/disabled':'text/secondary');component(e,'CollectionSelect',state);
   if(state==='Open')collectionMenu(p,x,y+40);return e;
 }
 function collectionMenu(p,x,y){const e=component(box(p,'menu',x,y,228,44),'CollectionMenu','Open');e.setAttribute('role','listbox');e.setAttribute('aria-label','Table');const r=rect(node('button','menu-item',e),5,5,216,32);r.type='button';r.dataset.selected='true';r.setAttribute('role','option');r.setAttribute('aria-selected','true');icon(r,'Check',8,8,'accent/ink');text(r,'Operations',32,6,176,20,'Body','accent/ink');return e;}
 function overflowMenu(p,x,y,state='Default',disabled=false){const e=component(box(p,'menu',x,y,228,44),'OverflowMenu',disabled?'Disabled':state);e.setAttribute('role','menu');const r=rect(node('button','menu-item',e),5,5,216,32);r.type='button';r.dataset.state=state;r.dataset.command='Close project';r.disabled=disabled;r.setAttribute('role','menuitem');text(r,'Close project',10,6,196,20,'Body',disabled?'text/disabled':'text/primary');return e;}
 function textField(p,x,y,state='Default'){
   const e=rect(node('input','control text-field',p),x,y,240,32);e.value='September review';e.readOnly=true;e.setAttribute('aria-label','Copy name — illustrative field');e.dataset.state=state;e.disabled=state==='Disabled';component(e,'TextField/Copy name',state);
   if(state.startsWith('Invalid')){e.setAttribute('aria-invalid','true');text(p,'This name cannot be used. Choose another name.',x,y+38,240,40,'Body','error/ink');}return e;
 }
 const saveTexts={idle:'Not saved yet',saving:'Saving…',saved:'Copy saved on this device',failed:'Save failed'};
 function saveInfo(B,state='idle'){
   const main=saveTexts[state]||saveTexts.idle,location='Copies: this browser on this device';const m=measure(main,B-24,'Status'),s=measure(location,B-24,'Meta');
   return {width:B,height:Math.max(40,20*m+2+16*s),main,location,mainLines:m,locationLines:s,state};
 }
 function saveIndicator(p,x,y,B=288,state='idle'){
   const q=saveInfo(B,state),e=component(box(p,'save-indicator',x,y,B,q.height),'SaveIndicator',state);e.dataset.metrics=JSON.stringify(q);e.setAttribute('role','status');
   const ink=state==='saving'?'warning/ink':state==='saved'?'success/ink':state==='failed'?'error/ink':'text/primary';const g={saving:'Clock',saved:'Check',failed:'Warning'}[state];if(g)icon(e,g,0,2,ink);else{const dot=box(e,'unsaved-ring',4,6,8,8);dot.setAttribute('aria-hidden','true');}
   text(e,q.main,24,0,B-24,20*q.mainLines,'Status',ink);text(e,q.location,24,20*q.mainLines+2,B-24,16*q.locationLines,'Meta','text/secondary');return e;
 }
 const rejection='The work did not accept this value. The draft was kept so you can correct it.';
 const noticeText={rejected:rejection,failed:'The copy was not saved. Your open work and drafts are still here.',pending:'These values are being updated; wait for confirmation before editing.',unknown:'These values could not be confirmed. Refresh before editing.',outcomeUnknown:'Outcome needs review',applying:'Applying changes…',busy:'An operation is in progress; editing is disabled until it finishes.',draft:'Edited — not saved; draft kept'};
 const normal=Object.freeze({busy:false,commitPending:false,dirty:false,currentness:'current',outcome:'idle',saveStatus:'idle',cellDraftActive:false,cellDraft:null,anyNotesDraft:false,copyNameDraft:false,errorMessage:null,readOnly:false});
 function stateFor(name){
   if(name.includes('unknownretaineddraft'))return {...normal,dirty:true,currentness:'unknown',outcome:'unknown',saveStatus:'saved',cellDraftActive:true,cellDraft:'abc',errorMessage:rejection};
   if(name.includes('savefailed'))return {...normal,dirty:true,saveStatus:'failed'};
   if(name.includes('editing'))return {...normal,cellDraftActive:true,cellDraft:'21'};
   return {...normal};
 }
 function messages(s,W){const out=[];const push=(channel,message,severity,glyph)=>out.push({channel,message,severity,glyph});
  if(s.errorMessage)push('errorMessage',s.errorMessage,'error','Warning');
  if(s.saveStatus==='failed'&&s.errorMessage!==noticeText.failed)push('saveStatus',noticeText.failed,'error','Warning');
  if(s.currentness==='pending')push('currentness',noticeText.pending,'warning','Clock');
  if(s.currentness==='unknown')push('currentness',noticeText.unknown,'warning','Unknown');
  if(s.outcome==='unknown')push('outcome',noticeText.outcomeUnknown,'warning','Unknown');
  if(s.outcome==='pending'&&s.currentness!=='pending')push('outcome',noticeText.applying,'warning','Clock');
  if((s.busy||s.commitPending)&&!out.some(q=>q.glyph==='Clock'))push('operation',noticeText.busy,'warning','Clock');
  if(W<400&&s.dirty&&(s.cellDraftActive||s.anyNotesDraft))push('workDraft',noticeText.draft,'warning','Warning');
  return out;
 }
 function exceptionMetrics(msgs,W){let y=6;return {rows:msgs.map(m=>{const lines=measure(m.message,W-60,'Body'),height=Math.max(32,8+20*lines);const r={...m,lines,height,y};y+=height+4;return r;}),height:msgs.length ? y+2 : 0};}
 function exceptions(p,x,y,W,msgs){const a=exceptionMetrics(msgs,W),e=component(box(p,'exceptions',x,y,W,a.height),'ExceptionRegion',msgs.map(m=>m.channel).join('+'));e.dataset.messages=JSON.stringify(a.rows);
   a.rows.forEach(r=>{const row=box(e,'exception-row',0,r.y,W,r.height);row.dataset.channel=r.channel;row.dataset.severity=r.severity;row.setAttribute('role',r.severity==='error'?'alert':'status');const top=(r.height-20*r.lines)/2;const well=box(row,'icon-well',12,top-2,24,24,C[r.severity+'/background']);icon(well,r.glyph,4,4,r.severity+'/ink');text(row,r.message,48,top,W-60,20*r.lines,'Body','text/primary');});return e;
 }
 function selectionDetail(p,x,y,w,mode='wide',state='Selected',height=null){
   const narrow=mode==='narrow',compact=mode==='compact',e=component(box(p,'selection-detail',x,y,w,height||(narrow?48:40)),'SelectionDetail/'+mode,state);
   const empty=state==='Empty',readonly=state==='ReadOnly';
   const row=empty?'No row':'Row 8',key='Units';const value='18';e.setAttribute('aria-label',empty?'Selection: No row; No cell selected':`Selection: Row 8; Units; committed value 18${state==='Unconfirmed'?'; values need confirmation':''}`);
   if(narrow){
     text(e,'Selection',12,6,52,16,'Meta','text/secondary');const rw=Math.min(64,advance(row));text(e,row,76,4,rw,20,'Label','text/secondary',{single:true});
     if(empty)text(e,'No cell selected',12,24,w-24,20,'Body');
     else {text(e,'·',76+rw+8,4,8,20,'Body','text/secondary');text(e,key,76+rw+24,4,w-(76+rw+24)-12,20,'Label','text/primary',{single:true});text(e,'Value',12,26,32,16,'Meta','text/secondary');text(e,(readonly?'Read-only: ':'')+value,52,24,w-64,20,'Body','text/primary',{single:true});}
     return e;
   }
   let at=0;
   if(!compact){text(e,'Selection',0,12,52,16,'Meta','text/secondary');at=64;}
   const rw=Math.min(compact?64:80,advance(row));text(e,row,at,10,rw,20,'Label','text/secondary',{single:true});at+=rw;
   if(empty){text(e,'No cell selected',at+16,10,w-at-16,20,'Body');return e;}
   at+=8;text(e,'·',at,10,8,20,'Body','text/secondary');at+=16;const kw=Math.min(compact?96:160,advance(key));text(e,key,at,10,kw,20,'Label','text/primary',{single:true});at+=kw+16;
   text(e,'Value',at,12,32,16,'Meta','text/secondary');at+=40;
   const vw=w-at-(compact?0:200);text(e,(readonly&&compact?'Read-only: ':'')+value,at,10,vw,20,'Body','text/primary',{single:true});
   if(!compact){const hx=w-184;const hints={Selected:'F2 / Enter: edit in cell',Editing:'Draft in cell — not applied',Unconfirmed:'Values need confirmation',ReadOnly:'Read-only value'};
     if(readonly){icon(e,'Lock',hx,12,'text/secondary');text(e,hints[state],hx+24,12,160,16,'Meta','text/secondary',{align:'right'});}else {const h=text(e,hints[state]||hints.Selected,hx,12,184,16,'Meta','text/secondary',{align:'right'});if(state==='Selected'){h.classList.add('key-hint');h.setAttribute('aria-label',hints.Selected);h.replaceChildren();const a=node('kbd','',h);a.textContent='F2';h.append(' / ');const b=node('kbd','',h);b.textContent='Enter';h.append(': edit in cell');}}
   }
   return e;
 }
 function viewTab(p,label,x,y,w,state='Default'){
  const e=rect(node('button','view-tab',p),x,y,w,32);e.type='button';e.dataset.state=state;e.tabIndex=(state==='Selected'||state==='SelectedFocus')?0:-1;e.setAttribute('role','tab');e.setAttribute('aria-label',label);e.setAttribute('aria-selected',String(state==='Selected'||state==='SelectedFocus'));
  const glyph={Table:'Table','Cross-table summary':'Summary',Brief:'Brief','Import & export':'Exchange'}[label];
  const group=node('span','view-label',e);if(glyph){const i=icon(group,glyph,0,0,'currentColor');i.style.position='relative';}const t=node('span','',group);t.textContent=label;return component(e,'ViewTab',state);
 }
 function views(p,x,y,W,selected='Table'){
   const e=component(box(p,'views top-rule',x,y,W,36),'Foundation/Views',selected);
   // Five-pixel pan clearance and an extended cross-axis window preserve focus outgrowth.
   const clip=box(e,'view-pan',0,-3,W,42),content=box(clip,'view-content',0,3,Math.max(616,W),36);clip.dataset.pan='views';
   text(content,'Views',12,8,44,20,'Label','text/secondary');content.setAttribute('role','tablist');content.setAttribute('aria-label','Views');const labels=['Table','Cross-table summary','Brief','Import & export'],xs=[68,162,364,452],ws=[86,194,80,152];
   labels.forEach((l,i)=>viewTab(content,l,xs[i],2,ws[i],l===selected?'Selected':'Default'));clip.addEventListener('focusin',event=>{if(!event.target.classList.contains('view-tab'))return;const a=event.target.getBoundingClientRect(),b=clip.getBoundingClientRect();if(a.left<b.left+5)clip.scrollLeft-=b.left+5-a.left;else if(a.right>b.right-5)clip.scrollLeft+=a.right-(b.right-5);});return e;
 }
 function workString(s,W){const draft=s.cellDraftActive||s.anyNotesDraft;if(s.dirty&&draft)return W<400?'Edited; draft kept':noticeText.draft;return draft?'Unapplied draft':s.dirty?'Edited — not saved':'Unchanged';}
 function footerInfo(s,W){const narrow=W<600,work=workString(s,W),current={current:'Up to date',pending:'Updating…',unknown:'Needs refresh'}[s.currentness],count=W>=1024?'50 rows · 8 columns':'50 rows';
   const workW=narrow?W-160:232,curW=narrow?W-76:W>=1024?140:112,countW=W>=1024?200:80;
   const workLines=measure(work,workW,'Status'),currentnessLines=measure(current,curW,'Status'),countLines=measure(count,countW,'Label');
   return {work,current,count,workW,curW,countW,workLines,currentnessLines,countLines,height:narrow?4+20*(Math.max(workLines,countLines)+currentnessLines):8+20*Math.max(workLines,currentnessLines,countLines)};
 }
 function footer(p,y,W,s){const f=footerInfo(s,W),n=W<600,e=component(box(p,'status',0,y,W,f.height),'Foundation/Status',s.currentness);e.dataset.metrics=JSON.stringify(f);
   const wy=n?2:4,cy=n?2+20*Math.max(f.workLines,f.countLines):4;
   text(e,'Work:',12,wy,36,20,'Label','text/secondary');text(e,f.work,56,wy,f.workW,20*f.workLines,'Status',f.work==='Unchanged'?'text/secondary':'warning/ink');
   text(e,'Values:',n?12:312,cy,44,20,'Label','text/secondary');text(e,f.current,n?64:364,cy,f.curW,20*f.currentnessLines,'Status',s.currentness==='current'?'text/secondary':'warning/ink');
   text(e,f.count,W-(W>=1024?212:92),wy,f.countW,20*f.countLines,'Label','text/secondary',{align:'right'});return e;
 }
 const columns=[['Name','text'],['Market','text'],['Units','number'],['Unit price','number'],['Active','boolean'],['Due date','date'],['Owner','text'],['Notes','text']];
 const longNote='決算資料を確認中です。 / Checking the original records before updating the quarterly operations review; retain the full note when the cell is truncated.';
 function fixture(){return Array.from({length:50},(_,n)=>{const i=n+1,k=n%4;return [(['東京オフィス','台北辦公室','Osaka workspace','Quarterly operations'][k])+' '+String(i).padStart(2,'0'),['Tokyo','Taipei','Osaka','Tokyo'][k],String(10+i),String((1200+25*i)/100),String(i%3!==0),'2026-10-'+String(1+n%28).padStart(2,'0'),['林怡君','佐藤美咲','Alex Chen','Jamie Park'][k],i===13?longNote:['','確認後に更新します。','待核對下一批資料。','Follow up after review.'][k]];});}
 function columnWidths(W){const S=Math.max(0,W-60-1432),A=Math.floor(S*.25),B=Math.floor(S*.15);return [240+A,144,104,128,112,144,160+B,400+S-A-B];}
 function cell(p,x,y,w,value,interaction='Default',tone='plain',opts={}){
   const e=component(box(p,'cell',x,y,w,28),'Cell/'+tone,interaction);e.dataset.interaction=interaction;e.dataset.tone=tone;e.dataset.committedValue=opts.committed??value;e.setAttribute('role','gridcell');
   const editor=['Editing','Pending','InvalidDraft'].includes(interaction);const active=['Active','FocusVisible','Editing','InvalidDraft'].includes(interaction);const focus=interaction==='FocusVisible'||!!opts.invalidFocus;
   let v;
   if(editor){v=rect(node('input','value editor'+(opts.numeric?' numeric':''),e),10,4,w-20-(interaction==='Pending'?24:0),20);v.value=value;v.readOnly=true;v.disabled=!!opts.locked||interaction==='Pending';v.setAttribute('aria-label',`Illustrative retained draft ${value}; committed value ${opts.committed||'18'}`);if(interaction==='InvalidDraft')v.setAttribute('aria-invalid','true');}
   else {v=node('div','value tone-'+tone+(opts.numeric?' numeric':''),e);rich(v,value);v.title=value;v.setAttribute('aria-label',value);}
   if(opts.lang){v.lang=opts.lang;v.style.fontFamily=opts.lang==='ja'?"'FES Japanese'":"'FES Traditional Chinese'";}
   if(active)node('div','cell-perimeter'+(interaction==='InvalidDraft'?' invalid':''),e);
   if(focus&&!opts.locked)node('div','cell-focus'+(interaction==='InvalidDraft'?' invalid-focus':''),e);
   if(interaction==='Editing'&&!opts.locked){const caret=box(e,'caret',opts.numeric?w-10:10+advance(value,'Body'),5,1,18);caret.setAttribute('aria-hidden','true');}
   if(interaction==='Pending')icon(e,'Clock',w-24,6,'warning/ink');
   if(focus&&!opts.locked)e.tabIndex=0;if(interaction==='ReadOnly')e.setAttribute('aria-readonly','true');if(interaction==='Pending')e.setAttribute('aria-busy','true');return e;
 }
 function columnHeader(p,x,y,w,label,focused=false,numeric=false){const e=component(box(p,'grid-header'+(focused?' focused':''),x,y,w,28),'ColumnHeader',focused?'FocusedField':'Default');e.setAttribute('role','columnheader');text(e,label,10,4,w-20,20,'Label',focused?'accent/ink':'text/on-tint',{align:numeric?'right':'left',single:true});return e;}
 function rowHeader(p,x,y,value,selected=false){const e=component(box(p,'row-header'+(selected?' selected':''),x,y,48,28),'RowHeader',selected?'Selected':'Default');e.setAttribute('role','rowheader');text(e,String(value),6,4,34,20,'Label',selected?'surface/canvas':'text/on-tint',{align:'right'});return e;}
 function corner(p,x,y){const e=component(box(p,'corner',x,y,48,28),'Corner','Default');text(e,'Row',6,4,34,20,'Label','text/on-tint',{align:'right'});return e;}
 function grid(p,y,W,GH,s,scroll=[0,0],menuOwnsFocus=false){
   const e=component(box(p,'grid',0,y,W,GH),'Grid','Default');e.setAttribute('role','grid');e.setAttribute('aria-rowcount','51');e.setAttribute('aria-colcount','8');e.setAttribute('aria-label','Operations — illustrative projection');
   const widths=columnWidths(W),DW=widths.reduce((a,b)=>a+b,0),BH=GH-40,clip=box(e,'grid-clip',48,28,W-60,BH);clip.tabIndex=-1;clip.dataset.pan='grid';
   const data=box(clip,'data-body',0,0,DW,1400),hClip=box(e,'clip',48,0,W-60,28),headers=box(hClip,'column-headers',0,0,DW,28),rClip=box(e,'clip',0,28,48,BH),rows=box(rClip,'row-headers',0,0,48,1400);
   corner(e,0,0).setAttribute('aria-hidden','true');rows.setAttribute('aria-hidden','true');data.setAttribute('role','rowgroup');headers.setAttribute('role','row');headers.setAttribute('aria-rowindex','1');let x=0;columns.forEach(([key,kind],j)=>{const h=columnHeader(headers,x,0,widths[j],key,j===2,kind==='number');h.dataset.column=j;h.dataset.columnX=x;x+=widths[j];});
   const values=fixture();values.forEach((r,i)=>{rowHeader(rows,0,i*28,i+1,i===7);const row=node('div','fixture-row',data);row.setAttribute('role','row');row.setAttribute('aria-rowindex',String(i+2));row.setAttribute('aria-label','Row '+(i+1));let cx=0;r.forEach((raw,j)=>{const active=i===7&&j===2;let inter=i===7?'RowSelected':'Default',shown=raw===''?'Empty':raw,tone=raw===''?'muted':'plain';
    if(active){inter=s.cellDraftActive?(s.cellDraft==='abc'?'InvalidDraft':s.commitPending?'Pending':'Editing'):menuOwnsFocus?'Active':'FocusVisible';if(s.cellDraftActive)shown=s.cellDraft;}
    const c=cell(row,cx,i*28,widths[j],shown,inter,tone,{numeric:columns[j][1]==='number',committed:raw,locked:s.busy||s.commitPending||s.currentness==='unknown'});c.dataset.row=String(i+1);c.dataset.column=String(j);c.dataset.field=columns[j][0];c.setAttribute('aria-colindex',String(j+1));c.setAttribute('aria-rowindex',String(i+2));if(i===7)c.setAttribute('aria-selected','true');if(active)c.dataset.active='true';cx+=widths[j];});});
   const vt=box(e,'scroll-track',W-12,28,12,BH),ht=box(e,'scroll-track',48,GH-12,W-60,12);box(e,'scroll-track',W-12,GH-12,12,12);box(e,'scroll-track',W-12,0,12,28);
   const vl=Math.min(BH,Math.max(40,Math.floor(BH*Math.min(1,BH/1400)))),hl=Math.min(W-60,Math.max(40,Math.floor((W-60)*Math.min(1,(W-60)/DW))));
   const vthumb=BH<1400?box(vt,'scroll-thumb',3,0,6,vl):null,hthumb=DW>W-60?box(ht,'scroll-thumb',0,3,hl,6):null;
   function sync(){headers.style.transform=`translateX(${-clip.scrollLeft}px)`;rows.style.transform=`translateY(${-clip.scrollTop}px)`;if(vthumb)vthumb.style.top=((BH-vl)*clip.scrollTop/(1400-BH))+'px';if(hthumb)hthumb.style.left=(((W-60)-hl)*clip.scrollLeft/(DW-(W-60)))+'px';e.dataset.scroll=JSON.stringify([clip.scrollLeft,clip.scrollTop]);}
   clip.addEventListener('scroll',sync);clip.scrollLeft=scroll[0];clip.scrollTop=scroll[1];sync();
   e._syncScroll=sync;e.dataset.widths=JSON.stringify(widths);e.dataset.dataClip=JSON.stringify({x:48,y:28,width:W-60,height:BH});return e;
 }
 const longTitle='Quarterly operations — 東京オフィス・台北辦公室 — regional review and reconciliation — September 2026';
 const scenarios=[
 ['fhd',1920,1080,'Shell/FHD'],['qhd',2048,1152,'Shell/QHD'],['4k-effective',2560,1440,'Shell/4K-effective'],['macbook-retina',1512,982,'Shell/MacBook-Retina'],
 ['stress-1440x900',1440,900,'Stress/1440x900'],['stress-1280x800',1280,800,'Stress/1280x800'],['stress-1024x768',1024,768,'Stress/1024x768'],['stress-720x450',720,450,'Stress/720x450'],['stress-360x640',360,640,'Stress/360x640'],
 ['state-mac-editing',1512,982,'State/Mac-Editing'],['state-mac-savefailed',1512,982,'State/Mac-SaveFailed'],['state-mac-unknownretaineddraft',1512,982,'State/Mac-UnknownRetainedDraft'],
 ['stress-boundary-1023x768',1023,768,'Stress/Boundary-1023x768'],['stress-boundary-320x640',320,640,'Stress/Boundary-320x640'],['stress-longtitle-1024x768',1024,768,'Stress/LongTitle-1024x768'],['stress-longtitle-360x640',360,640,'Stress/LongTitle-360x640'],
 ['state-360-unknownretaineddraft',360,640,'State/360-UnknownRetainedDraft'],['state-720-overflowopen',720,450,'State/720-OverflowOpen']
 ].map(([name,W,H,key])=>({name,W,H,key:PREFIX+key}));
 function shell(p,scenario,overrides={}){
   const {W,H,name,key}=scenario,s={...stateFor(name),...overrides},wide=W>=1024,narrow=W<600,compact=!wide&&!narrow,mode=wide?'wide':compact?'compact':'narrow',si=saveInfo(narrow?W-24:wide?256:288,s.saveStatus),R=Math.max(60,si.height+20),D=wide?R:compact?36+R:76+R,CY=narrow?88:40,ms=messages(s,W),em=exceptionMetrics(ms,W),N=em.height,F=footerInfo(s,W).height,V=36,P=D+CY+N+V+F,L=Math.max(H,P+168),GH=L-P;
   const e=node('section','shell',p);Object.assign(e.style,{width:W+'px',height:L+'px'});e.dataset.scene=name;e.dataset.key=key;e.setAttribute('aria-label','FES45 v3 design candidate: '+name);
   const header=component(box(e,'document-header',0,0,W,D),'DocumentHeader',mode);const mark=rect(node('img','mark',header),16,wide?(D-32)/2:2,32,32);mark.src=window.FES_ASSETS?.['tachiko-sheet-mark.svg']||'assets/tachiko-sheet-mark.svg';mark.alt='';mark.setAttribute('aria-hidden','true');
   if(wide){text(header,'Tachiko Sheet',60,8,200,16,'Meta','text/secondary').classList.add('wordmark');}
   const title=name.includes('longtitle')?longTitle:'Quarterly operations';text(header,title,wide?60:56,wide?26:6,wide?W-714:W-72,24,'Title','text/primary',{single:true}).dataset.workbookTitle='true';
   const locked=s.busy||s.commitPending||s.currentness==='unknown',saveState=locked?'Disabled':s.saveStatus==='saving'?'Busy':'Default';let more=null;
   if(wide){button(header,'Refresh',W-632,(D-32)/2,88,'Ghost',locked?'Disabled':'Default');const cg=component(box(header,'copy-group',W-528,0,400,D),'CopyGroup',s.saveStatus);saveIndicator(cg,0,(D-si.height)/2,256,s.saveStatus);button(cg,'Save a copy',268,(D-32)/2,132,'Primary',saveState);button(header,'Close project',W-116,(D-32)/2,100,'Ghost',s.busy?'Disabled':'Default');}
   else if(compact){const cy=36+(R-32)/2;button(header,'Refresh',W-524,cy,32,'Ghost',locked?'Disabled':'Default','Refresh');const cg=component(box(header,'copy-group',W-476,36,420,R),'CopyGroup',s.saveStatus);saveIndicator(cg,0,(R-si.height)/2,288,s.saveStatus);button(cg,'Save a copy',300,(R-32)/2,120,'Primary',saveState);more=button(header,'More',W-44,cy,32,'Ghost','Default','More');}
   else{saveIndicator(header,12,36+(R-si.height)/2,W-24,s.saveStatus);const cy=36+R+4;button(header,'Refresh',12,cy,88,'Secondary',locked?'Disabled':'Default');button(header,'Save a copy',112,cy,120,'Primary',saveState);more=button(header,'More',W-44,cy,32,'Ghost','Default','More');}
   const context=component(box(e,'work-context'+(!N?' bottom-rule':''),0,D,W,CY),'WorkContext',mode);text(context,'Table',12,10,40,20,'Label','text/secondary');selector(context,60,4,wide?200:compact?160:W-72,locked||s.cellDraftActive?'Disabled':'Default');
   const selection=s.currentness==='unknown'?'Unconfirmed':s.cellDraftActive?'Editing':s.readOnly?'ReadOnly':'Selected';selectionDetail(context,wide?284:compact?244:0,narrow?40:0,wide?W-296:compact?W-256:W,mode,selection);
   if(N)exceptions(e,0,D+CY,W,ms);
   const scroll=name==='state-360-unknownretaineddraft'?[336,168]:[0,0],menuOpen=name==='state-720-overflowopen';const g=grid(e,D+CY+N,W,GH,s,scroll,menuOpen);views(e,0,L-V-F,W);footer(e,L-F,W,s);
   if(more){more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded',String(menuOpen));if(menuOpen){const my=parseFloat(more.style.top)+32+8;overflowMenu(e,W-240,my,'KeyboardFocus',s.busy);}}
   e._metrics={key,name,viewport:{width:W,height:H},effective:{width:W,height:H},logical:{width:W,height:L},tier:mode,title,state:s,predicates:{controlsLocked:locked,selectorDisabled:locked||s.cellDraftActive,refreshDisabled:locked,saveDisabled:locked||s.saveStatus==='saving',closeDisabled:s.busy},save:si,footer:footerInfo(s,W),exceptions:em.rows,scrollOffset:scroll,columns:columnWidths(W),regions:{DocumentHeader:{x:0,y:0,width:W,height:D},WorkContext:{x:0,y:D,width:W,height:CY},ExceptionRegion:{x:0,y:D+CY,width:W,height:N},Grid:{x:0,y:D+CY+N,width:W,height:GH},Views:{x:0,y:L-V-F,width:W,height:V},Status:{x:0,y:L-F,width:W,height:F}},dataClip:{x:48,y:28,width:W-60,height:GH-40},completeVisibleRows:Math.floor((GH-40)/28),gridPercent:Math.round(GH/H*10000)/100,menuOwnsFocus:menuOpen};
   requestAnimationFrame(()=>{g.querySelector('.grid-clip').scrollLeft=scroll[0];g.querySelector('.grid-clip').scrollTop=scroll[1];g._syncScroll();});return e;
 }
 window.FES={C,TYPES,PREFIX,allComponents,node,rect,box,text,measure,advance,component,icon,button,selector,collectionMenu,overflowMenu,textField,saveInfo,saveIndicator,normal,stateFor,messages,noticeText,rejection,exceptions,exceptionMetrics,selectionDetail,viewTab,views,footer,footerInfo,workString,columns,longNote,fixture,columnWidths,cell,columnHeader,rowHeader,corner,scenarios,shell};
 window.renderScene=(name,p)=>{
  const mount=document.getElementById('mount'),candidate=scenarios.find(s=>s.name===name);mount.replaceChildren();allComponents.length=0;serial=0;
  if(candidate)shell(mount,candidate);
  else if(name==='wrap160'){const q=saveInfo(160,'saved');mount.style.width='160px';mount.style.height=q.height+'px';saveIndicator(mount,0,0,160,'saved');}
  else if(window.FES_BOARDS?.[name])window.FES_BOARDS[name](mount);
  else throw new Error('Unknown deterministic scene: '+name);
  if(candidate){const app=mount.querySelector('.shell');requestAnimationFrame(()=>{const item=app.querySelector('.menu-item[data-state=KeyboardFocus]');const editor=app.querySelector('.editor:not(:disabled)');const cell=app.querySelector('[data-active=true][tabindex="0"]');(item||editor||cell)?.focus({preventScroll:true});});}
  window.FES_METADATA={...FES_AUTHORITY,proposal:window.FES_PROPOSAL||null,scene:name,fontResolution:window.FES_FONT_RESOLUTION,candidates:[...mount.querySelectorAll('.shell')].map(e=>e._metrics),componentKeys:[...new Set(allComponents.map(c=>c.key+'/'+c.state))].sort(),colors:C,aliases:FES_ALIASES};
 };
})();
