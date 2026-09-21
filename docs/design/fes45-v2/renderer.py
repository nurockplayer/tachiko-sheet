#!/usr/bin/env python3
"""Offline FES45 v3 evidence renderer. Does not connect to or write GitHub.

Browser navigation is unnecessary: source bytes are loaded into an in-memory
Chromium document; the exact local assets become data URLs, not network requests.
The HTML entry point remains usable from an ordinary local HTTP server.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import importlib.metadata
import json
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any
from PIL import Image
from playwright.sync_api import sync_playwright, Page

ROOT = Path(__file__).resolve().parent
DIMENSIONS: dict[str, tuple[int,int]] = {
    'fhd': (1920,1080), 'qhd':(2048,1152), '4k-effective':(2560,1440),
    'macbook-retina':(1512,982), 'stress-1440x900':(1440,900),
    'stress-1280x800':(1280,800), 'stress-1024x768':(1024,768),
    'stress-720x450':(720,450), 'stress-360x640':(360,640),
    'state-mac-editing':(1512,982), 'state-mac-savefailed':(1512,982),
    'state-mac-unknownretaineddraft':(1512,982),
    'stress-boundary-1023x768':(1023,768), 'stress-boundary-320x640':(320,640),
    'stress-longtitle-1024x768':(1024,768), 'stress-longtitle-360x640':(360,640),
    'state-360-unknownretaineddraft':(360,640), 'state-720-overflowopen':(720,450),
    'components':(3744,2080), 'review-board':(3840,5360),
    'composition-supplement':(4320,2880), 'foundations':(1600,2048),
    'desktop-authority':(4320,6400), 'wrap160':(160,120),
}
# Authority order is part of the evidence identity. Do not sort this list.
EXPORTS: list[dict[str,Any]] = [
    *[{'name':n,'scene':n,'scale':1} for n in list(DIMENSIONS)[:12]],
    {'name':'review-board','scene':'review-board','scale':1},
    {'name':'components','scene':'components','scale':1},
    {'name':'detail-fhd-top','scene':'fhd','scale':2,'detail':'top'},
    {'name':'detail-mac-editing','scene':'state-mac-editing','scale':2,'detail':'editing'},
    {'name':'detail-unknown-retained-draft','scene':'state-mac-unknownretaineddraft','scale':2,'detail':'unknown'},
    *[{'name':n,'scene':n,'scale':1} for n in list(DIMENSIONS)[12:16]],
    {'name':'state-360-unknownretaineddraft-viewport','scene':'state-360-unknownretaineddraft','scale':1},
    {'name':'state-360-unknownretaineddraft-full','scene':'state-360-unknownretaineddraft','scale':1,'full':True},
    {'name':'state-720-overflowopen','scene':'state-720-overflowopen','scale':1},
    {'name':'saveindicator-wrap160','scene':'wrap160','scale':1},
    {'name':'composition-supplement','scene':'composition-supplement','scale':1},
]
assert len(EXPORTS)==26
APP_NAMES=set(list(DIMENSIONS)[:18])
EXPECTED_COLORS = ['#FFFFFF', '#F8F8FC', '#F5F6F9', '#ECEEF4', '#252735', '#646879', '#5B6072', '#9094A1', '#DFE2EA', '#858B9C', '#ECE9FE', '#6551CE', '#6551CE', '#6350D2', '#5541C2', '#4936AB', '#F0EDFD', '#5542B5', '#4F54AD', '#5542B5', '#865015', '#FFF3DD', '#A02D42', '#FFF0F3', '#206C4E', '#E9F6F0', '#8E75E7', '#B87036', '#F6F4FE', '#F7F8FB', '#5542B5', '#E9EBF1', '#EEF0F4']
ASSET_HASH='84162ccbb6fc3ea169633df4c773ddd3bb747e063243827ddf55675b41b9177b'
REJECTION='The work did not accept this value. The draft was kept so you can correct it.'
UNKNOWN='These values could not be confirmed. Refresh before editing.'
FAILED='The copy was not saved. Your open work and drafts are still here.'


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path:Path,value:Any)->None:
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def load(page:Page,scene:str,allow_font_preview:bool=False,proposal:bool=False)->dict[str,Any]:
    """Load exactly the committed source; resolve asset transport without navigation."""
    page.set_content('<!doctype html><html lang="en"><head><meta charset="utf-8"><style>'
        +(ROOT/'styles.css').read_text()+'</style></head><body><main id="mount"></main></body></html>')
    if proposal:
        page.add_style_tag(content=(ROOT/'proposals/polish.css').read_text())
        page.evaluate('window.FES_PROPOSAL="P01-P07_PROPOSED_ONLY_NOT_AUTHORITY"')
    assets={f.name:('data:image/svg+xml;base64,' if f.suffix=='.svg' else 'data:image/png;base64,')+base64.b64encode(f.read_bytes()).decode('ascii')
            for f in sorted((ROOT/'assets').iterdir()) if f.suffix=='.svg' or (scene=='review-board' and f.suffix=='.png')}
    page.evaluate('assets=>window.FES_ASSETS=assets',assets)
    for script in ('font-policy.js','tokens.js','design.js','boards.js'):
        page.add_script_tag(content=(ROOT/script).read_text())
    page.evaluate('''async ({scene,allow}) => {
        await resolveFesFonts({allowUnqualifiedPreview:allow});
        window.renderScene(scene,new URLSearchParams());
        await document.fonts.ready;
        await Promise.all([...document.images].map(i=>i.decode()));
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    }''',{'scene':scene,'allow':allow_font_preview})
    return page.evaluate('window.FES_METADATA')


MEASURE_SCRIPT='''() => {
 const r=(e,root)=>{const a=e.getBoundingClientRect(),b=root.getBoundingClientRect();return {x:a.x-b.x,y:a.y-b.y,width:a.width,height:a.height};};
 return [...document.querySelectorAll('.shell')].map(s=>({
  scene:s.dataset.scene,overview:!!s.dataset.overviewScale,
  regions:Object.fromEntries([['DocumentHeader','.document-header'],['WorkContext','.work-context'],['Grid','.grid'],['Views','.views'],['Status','.status']].map(([k,q])=>[k,r(s.querySelector(q),s)])),
  exception:s.querySelector('.exceptions')?r(s.querySelector('.exceptions'),s):null,
  active:r(s.querySelector('[data-active=true]'),s),
  columns:[...s.querySelectorAll('.column-headers .grid-header')].map(e=>({rect:r(e,s),index:Number(e.dataset.column)})),
  cells:[...s.querySelectorAll('.data-body .cell')].map(e=>({row:Number(e.dataset.row),col:Number(e.dataset.column),x:e.offsetLeft,y:e.offsetTop,width:e.offsetWidth,height:e.offsetHeight,committed:e.dataset.committedValue,value:e.querySelector('input')?.value??e.querySelector('.value').textContent,interaction:e.dataset.interaction,fill:getComputedStyle(e).backgroundColor,editorDisabled:e.querySelector('input')?.disabled??null,caret:!!e.querySelector('.caret'),focus:!!e.querySelector('.cell-focus'),perimeter:e.querySelector('.cell-perimeter')?getComputedStyle(e.querySelector('.cell-perimeter')).borderColor:null})),
  controls:[...s.querySelectorAll('.document-header button,.work-context button,.menu-item')].map(e=>({command:e.dataset.command,disabled:e.disabled,state:e.dataset.state??null,rect:r(e,s)})),
  title:r(s.querySelector('[data-workbook-title]'),s),
  titleOverflow:getComputedStyle(s.querySelector('[data-workbook-title]')).textOverflow,
  titleFull:s.querySelector('[data-workbook-title]').textContent,
  notices:[...s.querySelectorAll('.exception-row')].map(e=>({channel:e.dataset.channel,text:e.querySelector('.text').textContent,rect:r(e,s)})),
  scroll:[s.querySelector('.grid-clip').scrollLeft,s.querySelector('.grid-clip').scrollTop],
  work:s.querySelector('.status').dataset.metrics,
  truthOverflows:[...s.querySelectorAll('.save-indicator .text,.exceptions .text,.status .text')].filter(e=>e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1).map(e=>e.textContent),
  canvasWidth:document.documentElement.clientWidth,
  documentScrollWidth:document.documentElement.scrollWidth,
  completeRows:s._metrics.completeVisibleRows
 }));
}'''


def check_shell(meta:dict[str,Any], actual:dict[str,Any]) -> dict[str,Any]:
    """Independent expected arithmetic and visible-state checks, not metadata-only."""
    W,H=meta['viewport']['width'],meta['viewport']['height']
    assert not actual['overview']
    reg=meta['regions'];D,CC,N,V,F=[reg[k]['height'] for k in ('DocumentHeader','WorkContext','ExceptionRegion','Views','Status')]
    L=max(H,D+CC+N+V+F+168);GH=L-D-CC-N-V-F
    assert meta['logical']['height']==L
    expected={'DocumentHeader':(0,0,W,D),'WorkContext':(0,D,W,CC),'Grid':(0,D+CC+N,W,GH),'Views':(0,L-V-F,W,V),'Status':(0,L-F,W,F)}
    for key,vals in expected.items():
        obs=actual['regions'][key]
        for prop,v in zip(('x','y','width','height'),vals):assert abs(obs[prop]-v)<.01,(meta['name'],key,prop,obs[prop],v)
    assert (28+(GH-40)+12)==GH
    if N:
        assert actual['exception']==reg['ExceptionRegion']
    else: assert actual['exception'] is None
    assert CC==(88 if W<600 else 40)
    assert V==36
    if meta['save']['height']==40:assert D==(60 if W>=1024 else 96 if W>=600 else 136)
    assert actual['truthOverflows']==[],actual['truthOverflows']
    assert actual['documentScrollWidth']==W,(meta['name'],'horizontal page overflow')
    assert actual['scroll']==meta['scrollOffset']
    S=max(0,W-60-1432);A=int(S*.25);B=int(S*.15)
    widths=[240+A,144,104,128,112,144,160+B,400+S-A-B]
    assert meta['columns']==widths
    x=0
    for i,(w,header) in enumerate(zip(widths,actual['columns'])):
        assert header['rect']['x']==48+x-meta['scrollOffset'][0]
        assert header['rect']['width']==w
        assert header['rect']['y']==D+CC+N
        for c in [v for v in actual['cells'] if v['col']==i]:
            assert (c['x'],c['width'],c['height'])==(x,w,28)
            assert c['y']==(c['row']-1)*28
        x+=w
    assert len(actual['cells'])==400
    for c in actual['cells']:
        i,k=c['row'],(c['row']-1)%4
        expected_row=[['東京オフィス','台北辦公室','Osaka workspace','Quarterly operations'][k]+f' {i:02}', ['Tokyo','Taipei','Osaka','Tokyo'][k],str(10+i),str((1200+25*i)/100).removesuffix('.0'),str(i%3!=0).lower(),f'2026-10-{1+(i-1)%28:02}',['林怡君','佐藤美咲','Alex Chen','Jamie Park'][k],['','確認後に更新します。','待核對下一批資料。','Follow up after review.'][k]]
        if i==13:expected_row[7]='決算資料を確認中です。 / Checking the original records before updating the quarterly operations review; retain the full note when the cell is truncated.'
        assert c['committed']==expected_row[c['col']],(meta['name'],i,c['col'])
    by_command={c['command']:c for c in actual['controls']}
    st=meta['state'];locked=st['busy'] or st['commitPending'] or st['currentness']=='unknown'
    assert by_command['Refresh']['disabled']==locked
    assert by_command['Save a copy']['disabled']==(locked or st['saveStatus']=='saving')
    assert by_command['CollectionSelect']['disabled']==(locked or st['cellDraftActive'])
    if 'Close project' in by_command:assert by_command['Close project']['disabled']==st['busy']
    for c in actual['controls']:
        assert c['command'] in {'Refresh','Save a copy','Close project','More','CollectionSelect'}
        assert c['rect']['height']==32
    assert by_command['Save a copy']['rect']['width']==(132 if W>=1024 else 120)
    assert by_command['Refresh']['rect']['width']==(32 if 600<=W<1024 else 88)
    assert actual['titleOverflow']=='ellipsis'
    if W>=1024:assert actual['title']['width']==W-714
    active=next(c for c in actual['cells'] if c['row']==8 and c['col']==2)
    assert active['committed']=='18'
    readout_value='18' # Inspected separately through DOM full-text content.
    if st['currentness']=='unknown':
        assert active['value']=='abc' and active['editorDisabled'] is True
        assert not active['focus'] and not active['caret']
        assert active['perimeter']=='rgb(160, 45, 66)'
        assert [q['text'] for q in actual['notices']]==[REJECTION,UNKNOWN,'Outcome needs review']+(['Edited — not saved; draft kept'] if W<400 else [])
        assert st['saveStatus']=='saved'
    elif st['cellDraftActive']:
        assert active['value']=='21' and active['caret'] and active['editorDisabled'] is False
    elif st['saveStatus']=='failed':
        assert [q['text'] for q in actual['notices']]==[FAILED]
    else:
        assert active['value']=='18'
    assert active['fill']=='rgb(255, 255, 255)'
    for c in [c for c in actual['cells'] if c['row']==8 and c['col']!=2]:assert c['fill']=='rgb(246, 244, 254)'
    return {'scene':meta['name'],'status':'PASS','checks':['region geometry','grid equations','shared columns','400 committed fixture cells','action gates','retained draft/value separation','exception order','truth text not clipped','scroll offsets','title and command widths','row vs active emphasis'],'completeVisibleRows':int((GH-40)//28),'GH':GH,'N':N,'L':L}


def platform_fonts(page:Page)->dict[str,Any]:
    client=page.context.new_cdp_session(page);client.send('DOM.enable');client.send('CSS.enable')
    doc=client.send('DOM.getDocument')['root']['nodeId']
    out={}
    for name,selector in {
        'latinRegular':'.data-body .cell[data-row="4"][data-column="0"] .value',
        'latinSemibold':'[data-workbook-title]',
        'latinItalic':'.data-body .cell[data-row="1"][data-column="7"] .value',
        'japanese':'.data-body .cell[data-row="1"][data-column="0"] .jp',
        'traditionalChinese':'.data-body .cell[data-row="2"][data-column="0"] .tc',
    }.items():
        n=client.send('DOM.querySelector',{'nodeId':doc,'selector':selector})['nodeId']
        out[name]=client.send('CSS.getPlatformFontsForNode',{'nodeId':n})['fonts']
    client.detach();return out


def aggregate(exports:list[dict[str,Any]])->str:
    return hashlib.sha256(''.join(f"{e['filename']} {e['sha256']}\n" for e in exports).encode('utf-8')).hexdigest()


def render(out:Path,chromium:str,only:list[str]|None=None,allow_font_preview:bool=False,proposal:bool=False)->dict[str,Any]:
    out.mkdir(parents=True,exist_ok=True)
    assert sha(ROOT/'assets/tachiko-work-icon.png')==ASSET_HASH,'Approved mark mismatch'
    exports=[];metas={};checks=[];actual_font_info=None;all_keys=set();colors=None;requests=[]
    selected=[e for e in EXPORTS if not only or e['name'] in only]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=chromium,args=['--no-sandbox','--disable-gpu','--font-render-hinting=none'])
        browser_version=browser.version
        for item in selected:
            scene,scale=item['scene'],item['scale'];W,H=DIMENSIONS[scene]
            page=browser.new_page(viewport={'width':W,'height':H},device_scale_factor=scale,
                color_scheme='light',reduced_motion='reduce',locale='en-US',timezone_id='UTC')
            # Deny external I/O even when reproducing outside this restricted sandbox.
            page.route('**/*',lambda route:route.abort())
            page.on('request',lambda req:requests.append(req.url))
            meta=load(page,scene,allow_font_preview,proposal);all_keys.update(meta['componentKeys']);colors=meta['colors']
            assert list(colors.values())==EXPECTED_COLORS
            actual=page.evaluate(MEASURE_SCRIPT)
            if scene in APP_NAMES:
                checks.append(check_shell(meta['candidates'][0],actual[0]))
                # The visible non-editor readout must retain the committed work value.
                assert page.locator('.selection-detail').inner_text().split()[-1]=='18' or scene not in APP_NAMES or W>=1024
                texts=page.locator('.selection-detail .text').all_text_contents()
                assert '18' in texts
            if scene=='fhd' and scale==1:actual_font_info=platform_fonts(page)
            clip={'x':0,'y':0,'width':W,'height':H}
            if item.get('detail'):
                regions=meta['candidates'][0]['regions'];D=regions['DocumentHeader']['height'];CC=regions['WorkContext']['height'];N=regions['ExceptionRegion']['height']
                clip={'x':0,'y':0 if item['detail']=='top' else D,'width':W,'height':D+CC if item['detail']=='top' else CC+N+28+10*28}
            elif scene=='wrap160':
                si=page.evaluate('FES.saveInfo(160,"saved")');clip['height']=si['height'];page.set_viewport_size({'width':160,'height':si['height']});meta['wrap160']=si
            elif item.get('full'):clip['height']=meta['candidates'][0]['logical']['height']
            filename='fes45-v3-'+item['name']+'.png';dest=out/filename
            page.screenshot(path=str(dest),clip=clip,full_page=bool(item.get('full')),animations='disabled',caret='hide',scale='device')
            actual_size=Image.open(dest).size;expected_size=(int(clip['width']*scale),int(clip['height']*scale));assert actual_size==expected_size,(filename,actual_size,expected_size)
            exports.append({'filename':filename,'scene':scene,'origin':'deterministic HTML design harness','scale':scale,'region':clip,'pixelDimensions':{'width':actual_size[0],'height':actual_size[1]},'sha256':sha(dest),'bytes':dest.stat().st_size})
            metas.setdefault(scene,meta)
            print(f"{len(exports):02d}/{len(selected):02d} {filename}: {actual_size[0]}x{actual_size[1]} {sha(dest)[:12]}",flush=True)
            page.context.close()
        browser.close()
    assert not requests,('Unexpected network request',requests)
    result={'candidateRevision':'FES45/v3','proposalOnly':proposal,'renderer':'Python Playwright, offline in-memory HTML, Chromium','browserVersion':browser_version,
        'pythonVersion':platform.python_version(),'playwrightVersion':importlib.metadata.version('playwright'),
        'pillowVersion':importlib.metadata.version('Pillow'),'platform':{'system':platform.system(),'machine':platform.machine()},
        'browserFlags':['--no-sandbox','--disable-gpu','--font-render-hinting=none'],
        'networkRequests':requests,'actualFonts':actual_font_info,'exports':exports,'evidenceAggregateSha256':aggregate(exports),
        'geometryChecks':checks,'scenarios':metas,'componentKeys':sorted(all_keys),'resolvedColors':colors}
    write_json(out/'render-results.json',result)
    return result


def main()->int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=ROOT/'renders')
    parser.add_argument('--chromium',default='/usr/bin/chromium')
    parser.add_argument('--only',nargs='+',help='Exact export suffixes for a visual iteration; not a complete evidence run.')
    parser.add_argument('--compare',type=Path,help='Compare all required PNGs against another rendered directory.')
    args=parser.parse_args()
    try:
        result=render(args.out,args.chromium,args.only,False,False)
        if args.compare:
            assert not args.only,'A partial render cannot satisfy determinism'
            for e in result['exports']:
                other=args.compare/e['filename'];assert other.is_file(),str(other);assert sha(other)==e['sha256'],f"Nondeterministic: {e['filename']}"
            print('BYTE DETERMINISM: PASS (26/26 PNG SHA-256 matches)')
        print('EVIDENCE AGGREGATE:',result['evidenceAggregateSha256'])
        return 0
    except Exception as exc:
        print(f'FAILED: {type(exc).__name__}: {exc}',file=sys.stderr)
        return 1
if __name__=='__main__':raise SystemExit(main())
