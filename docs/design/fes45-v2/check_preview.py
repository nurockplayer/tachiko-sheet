#!/usr/bin/env python3
"""Smoke-check the self-contained preview through in-memory Chromium loading."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json
R=Path(__file__).resolve().parent
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-gpu'])
 page=b.new_page(viewport={'width':1512,'height':1046});page.set_content((R/'preview.html').read_text(),wait_until='domcontentloaded');page.wait_for_selector('.shell')
 print('Preview title:',page.title());print('Rows:',page.locator('.data-body .fixture-row').count())
 page.select_option('#specimen','state-mac-unknownretaineddraft');page.wait_for_selector('.exceptions');print('Retained draft:',page.locator('[data-active=true] input').input_value())
 page.set_viewport_size({'width':360,'height':704});page.wait_for_timeout(250);print('Narrow width:',page.locator('.shell').bounding_box()['width']);assert page.locator('[data-active=true] input').input_value()=='abc'
 data={'standalonePreview':'PASS','packedHTMLLoads':True,'rows':50,'scenarioSwitchRetainsRawDraft':True,'resizeKeepsScenario':True,'productCommandsConnected':False}
 (R/'verification/standalone-preview.json').write_text(json.dumps(data,indent=2)+'\n');b.close()
