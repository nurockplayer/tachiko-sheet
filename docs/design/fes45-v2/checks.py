#!/usr/bin/env python3
"""Author-owned browser checks for v3; not independent review or product acceptance."""
import hashlib,json,math
from pathlib import Path
from playwright.sync_api import sync_playwright
import renderer
ROOT=Path(__file__).resolve().parent
results=[]
def check(name,condition,detail=None):
    results.append({'check':name,'status':'PASS' if condition else 'FAIL','detail':detail})
    if not condition:raise AssertionError((name,detail))
def luminance(h):
    rgb=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    lin=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in rgb]
    return sum(a*b for a,b in zip(lin,(.2126,.7152,.0722)))
def ratio(a,b):
    x,y=sorted((luminance(a),luminance(b)));return (y+.05)/(x+.05)
def main():
    with sync_playwright() as pw:
        b=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-gpu','--font-render-hinting=none'])
        p=b.new_page(viewport={'width':1512,'height':982},locale='en-US',timezone_id='UTC',reduced_motion='reduce')
        p.route('**/*',lambda r:r.abort())
        m=renderer.load(p,'macbook-retina')
        check('V3 font policy resolves locally',m['fontResolution']['qualified'])
        glyphs=renderer.platform_fonts(p)
        for key,part in [('latinRegular','Inter'),('latinSemibold','InterDisplay'),('japanese','CJKjp'),('traditionalChinese','CJKtc')]:
            check('Actual glyph face: '+key,any(part in f['postScriptName'] for f in glyphs[key]),glyphs[key])
        check('No synthesized fonts',p.locator('body').evaluate('(e)=>getComputedStyle(e).fontSynthesis')=='none')
        check('14px data text / 20px baseline',p.locator('.cell .value').first.evaluate('(e)=>[getComputedStyle(e).fontSize,getComputedStyle(e).lineHeight]')==['14px','20px'])
        check('Exactly 400 projected scalar cells',p.locator('.data-body .cell').count()==400)
        check('Numeric right alignment',p.locator('.cell .value.numeric').first.evaluate('(e)=>getComputedStyle(e).textAlign')=='right')
        check('No checkbox semantics for booleans',p.locator('input[type=checkbox]').count()==0)
        check('Selection details are readouts, not editors',p.locator('.selection-detail input,.selection-detail button,.selection-detail [tabindex]').count()==0)
        check('Four existing Views only',p.locator('.views [role=tab]').all_text_contents()==['Table','Cross-table summary','Brief','Import & export'])
        check('Selected View is Table',p.locator('.views [aria-selected=true]').inner_text()=='Table')
        check('Commands contain no unsupported controls',set(p.locator('[data-command]').evaluate_all('(es)=>es.map(e=>e.dataset.command)'))=={'Refresh','Save a copy','Close project','CollectionSelect'})
        check('Mark is decorative, not a new command',p.locator('.mark').get_attribute('aria-hidden')=='true' and p.locator('.mark').get_attribute('alt')=='')
        check('Row gutter / column count accessible',p.locator('.grid').get_attribute('aria-colcount')=='8' and p.locator('.grid').get_attribute('aria-rowcount')=='51')
        check('Committed selection remains 18',p.locator('[data-active=true]').get_attribute('data-committed-value')=='18')
        check('Normal active focus uses one 3px ring',p.locator('[data-active=true] .cell-focus').evaluate('(e)=>getComputedStyle(e).borderTopWidth')=='3px')
        p.locator('[data-command="Save a copy"]').focus()
        focus=p.locator('[data-command="Save a copy"]').evaluate('(e)=>[getComputedStyle(e).outlineWidth,getComputedStyle(e).outlineOffset]')
        check('Command focus uses 3px / 2px clearance',focus==['3px','2px'],focus)
        check('Command focus removes competing cell focus',p.locator('.cell-focus').evaluate('(e)=>getComputedStyle(e).visibility')=='hidden')
        p.locator('[data-command="Refresh"]').hover()
        check('Refresh has actual hover feedback',p.locator('[data-command="Refresh"]').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgb(245, 246, 249)')
        p.emulate_media(forced_colors='active')
        check('Forced-colors removes decorative gradient',p.locator('.document-header').evaluate('(e)=>getComputedStyle(e).backgroundImage')=='none')
        check('Forced-colors keeps real cell outline',p.locator('[data-active=true] .cell-perimeter').evaluate('(e)=>getComputedStyle(e).borderTopStyle')=='solid')
        p.emulate_media(forced_colors='none')
        renderer.load(p,'state-mac-unknownretaineddraft')
        check('Unknown retains all three messages',p.locator('.exception-row').count()==3)
        check('Retained raw draft abc',p.locator('[data-active=true] input').input_value()=='abc')
        check('Unknown editor disabled',p.locator('[data-active=true] input').is_disabled())
        check('Unknown editor has no caret or blue keyboard focus',p.locator('[data-active=true] .caret,[data-active=true] .cell-focus').count()==0)
        check('Unknown readout remains committed 18','18' in p.locator('.selection-detail .text').all_text_contents())
        for cmd in ('Refresh','Save a copy','CollectionSelect'):
            check('Unknown locks '+cmd,p.locator('[data-command="'+cmd+'"]').is_disabled())
        check('Close remains enabled when not busy',p.locator('[data-command="Close project"]').is_enabled())
        check('Saved earlier copy remains acknowledged','Copy saved on this device' in p.locator('.save-indicator').inner_text())
        check('Unsaved work remains explicit','Edited — not saved; draft kept' in p.locator('.status').inner_text())
        check('Currentness remains Needs refresh','Needs refresh' in p.locator('.status').inner_text())
        check('Rejected editor retains red perimeter',p.locator('[data-active=true] .invalid').evaluate('(e)=>getComputedStyle(e).borderColor')=='rgb(160, 45, 66)')
        p.emulate_media(forced_colors='active')
        check('Forced-colors invalid is dashed (not color-only)',p.locator('[data-active=true] .invalid').evaluate('(e)=>getComputedStyle(e).borderTopStyle')=='dashed')
        p.emulate_media(forced_colors='none')
        p.set_viewport_size({'width':360,'height':640});meta=renderer.load(p,'state-360-unknownretaineddraft')
        check('Narrow all four distinct truth messages remain visible in full layout',p.locator('.exception-row').count()==4)
        check('Narrow document may grow rather than clip',meta['candidates'][0]['logical']['height']>=640)
        check('Narrow no page-wide horizontal overflow',p.evaluate('document.documentElement.scrollWidth')==360)
        ar=p.locator('[data-active=true]').bounding_box();gr=p.locator('.grid').bounding_box()
        check('Panned narrow retained draft actually visible',ar['x']>=48 and ar['x']+ar['width']<=348 and ar['y']>=gr['y']+28 and ar['y']+ar['height']<=gr['y']+gr['height']-12,ar)
        check('Narrow no status truncation',not p.locator('.status .text,.exceptions .text,.save-indicator .text').evaluate_all('(es)=>es.some(e=>e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)'))
        p.set_viewport_size({'width':720,'height':450});renderer.load(p,'state-720-overflowopen')
        check('Only supported Close project in More',p.locator('.menu-item').count()==1 and p.locator('.menu-item').inner_text()=='Close project')
        check('Open menu owns real browser focus',p.locator('.menu-item').evaluate('(e)=>e===document.activeElement'))
        check('Cell remains Active, not FocusVisible, under menu',p.locator('[data-active=true]').get_attribute('data-interaction')=='Active')
        check('Overflow focus is visible',p.locator('.menu-item').evaluate('(e)=>getComputedStyle(e).outlineWidth')=='3px')
        p.set_viewport_size({'width':1024,'height':768});renderer.load(p,'stress-longtitle-1024x768')
        t=p.locator('[data-workbook-title]');check('Long title ellipsizes without changing identity',t.get_attribute('title')==p.evaluate('FES.scenarios.length && document.querySelector("[data-workbook-title]").dataset.fullText') and t.evaluate('(e)=>e.scrollWidth>e.clientWidth'))
        p.set_viewport_size({'width':320,'height':640});renderer.load(p,'stress-boundary-320x640')
        check('320px controls remain 32px high',all(x==32 for x in p.locator('.control').evaluate_all('(es)=>es.map(e=>e.getBoundingClientRect().height)')))
        check('320px title/actions fit document',p.evaluate('document.documentElement.scrollWidth')==320)
        check('320px Views pan, not shrink',p.locator('.view-pan').evaluate('(e)=>e.scrollWidth>e.clientWidth'))
        b.close()
    pairs=[('data / canvas','#252735','#FFFFFF',4.5),('secondary / chrome','#646879','#F8F8FC',4.5),('header / header','#5B6072','#F7F8FB',4.5),('data / selected row','#252735','#F6F4FE',4.5),('primary button label','#FFFFFF','#6350D2',4.5),('selected row number','#FFFFFF','#6350D2',4.5),('selected view label','#5542B5','#FFFFFF',4.5),('focus / white','#6551CE','#FFFFFF',3),('warning / chrome','#865015','#F8F8FC',4.5),('error perimeter / white','#A02D42','#FFFFFF',3),('saved copy / chrome','#206C4E','#F8F8FC',4.5)]
    contrasts=[]
    for name,fg,bg,minimum in pairs:
        value=round(ratio(fg,bg),3);check('Contrast: '+name,value>=minimum,{'ratio':value,'minimum':minimum});contrasts.append({'role':name,'foreground':fg,'background':bg,'ratio':value,'minimum':minimum})
    report={'scope':'Author-owned design-harness checks, not independent review or shipped product acceptance','passed':len(results),'failed':0,'checks':results,'glyphFaces':glyphs,'contrastPairs':contrasts,'independentReviewStatus':'PENDING','implementationAuthority':False}
    (ROOT/'verification/browser-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'passed':len(results),'failed':0},indent=2))
if __name__=='__main__':main()
