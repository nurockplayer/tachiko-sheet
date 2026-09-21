#!/usr/bin/env python3
"""Opt-in complete GitHub publication. Default: offline verification only.

No credentials are bundled. No force update, main mutation, approval or merge.
Read/reconcile live #2/#45 and branch ownership before supplying expected refs.
"""
from __future__ import annotations
import argparse,base64,hashlib,json,os,re
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request,urlopen
from verify_bundle import ROOT,verify,MANIFEST
REPO='nurockplayer/tachiko-sheet';BRANCH='design/issue-45-fes45-v2';PREFIX='docs/design/fes45-v2/'

def publish(expected_head:str,expected_main:str)->dict:
    for sha in (expected_head,expected_main):
        if not re.fullmatch(r'[0-9a-f]{40}',sha):raise ValueError('Both expected refs must be full SHA-1 values')
    checked=verify();token=os.environ.get('GITHUB_TOKEN')
    if not token:raise RuntimeError('GITHUB_TOKEN required in this process environment; never put it in a file or chat')
    def api(method,path,data=None,missing=False):
        req=Request('https://api.github.com/repos/'+REPO+path,method=method,
          data=None if data is None else json.dumps(data).encode(),
          headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'FES45-v3-publisher'})
        try:
            with urlopen(req,timeout=90) as response:return json.load(response)
        except HTTPError as e:
            if missing and e.code==404:return None
            raise RuntimeError(f'GitHub {method} {path}: HTTP {e.code}. No automatic write retry.') from None
    ref='/git/ref/heads/'+quote(BRANCH,safe='/')
    main=api('GET','/git/ref/heads/main')['object']['sha']
    if main!=expected_main:raise RuntimeError('Main moved; reconcile live authority')
    branch=api('GET',ref,missing=True)
    if branch is None:
        if expected_head!=expected_main:raise RuntimeError('New branch must start at inspected main')
        api('POST','/git/refs',{'ref':'refs/heads/'+BRANCH,'sha':expected_main})
    elif branch['object']['sha']!=expected_head:raise RuntimeError('Branch moved; verify writer ownership')
    existing=api('GET','/pulls?state=open&head='+quote('nurockplayer:'+BRANCH)+'&base=main')
    if len(existing)>1 or (existing and not existing[0]['draft']):raise RuntimeError('Unexpected PR ownership/disposition; stop')
    base_tree=api('GET','/git/commits/'+expected_head)['tree']['sha']
    m=json.loads((ROOT/MANIFEST).read_text());names=sorted([f['path'] for f in m['files']]+[MANIFEST,'MANIFEST.sha256'])
    entries=[]
    for name in names:
        raw=(ROOT/name).read_bytes();expected=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        blob=api('POST','/git/blobs',{'encoding':'base64','content':base64.b64encode(raw).decode()})
        if blob['sha']!=expected:raise RuntimeError('Uploaded blob identity differs: '+name)
        entries.append({'path':PREFIX+name,'mode':'100644','type':'blob','sha':blob['sha']})
    tree=api('POST','/git/trees',{'base_tree':base_tree,'tree':entries})['sha']
    commit=api('POST','/git/commits',{'message':'design: publish FES45 v3 visual-lead candidate (Refs #45)','tree':tree,'parents':[expected_head]})['sha']
    # Verify exact scoped diff before making this commit reachable on the design branch.
    comparison=api('GET','/compare/'+expected_head+'...'+commit)
    if not comparison.get('files') or any(not f['filename'].startswith(PREFIX) for f in comparison['files']):raise RuntimeError('Unexpected diff scope')
    if api('GET',ref)['object']['sha']!=expected_head:raise RuntimeError('Branch changed while uploading; no update performed')
    if api('GET','/git/ref/heads/main')['object']['sha']!=expected_main:raise RuntimeError('Main changed while uploading; reconcile')
    api('PATCH','/git/refs/heads/'+quote(BRANCH,safe='/'),{'sha':commit,'force':False})
    if api('GET',ref)['object']['sha']!=commit:raise RuntimeError('Post-update HEAD mismatch')
    raw='https://raw.githubusercontent.com/'+REPO+'/'+commit+'/'+PREFIX
    body='Refs #45\n\n**FES45 v3 design candidate — NOT IMPLEMENTATION AUTHORITY.**\n\n'
    body+='Latest direct founder visual-lead brief supersedes previous cosmetic decisions only. Product semantics, command gates, truth, density and accessibility remain. Author: GPT-6 Astra Pro; not an independent reviewer.\n\n'
    body+='```json\n'+json.dumps({'headSha':commit,**checked},indent=2)+'\n```\n\n'
    for label,name in [('MacBook Retina','macbook-retina'),('FHD','fhd'),('UnknownRetainedDraft','state-mac-unknownretaineddraft')]:
        body+='### '+label+'\n!['+label+']('+raw+'renders/fes45-v3-'+name+'.png)\n\n'
    body+='Complete 26-PNG evidence and source bundle. See README, AUTHORITY, DESIGN, REPRODUCE, VISUAL_REVIEW, manifest and verifier. No production/Figma changes, self-approval or merge.\n'
    if existing:
        pr=api('PATCH','/pulls/'+str(existing[0]['number']),{'title':'[Design] FES45 v3 — modern workbook candidate','body':body})
    else:
        pr=api('POST','/pulls',{'title':'[Design] FES45 v3 — modern workbook candidate','body':body,'head':BRANCH,'base':'main','draft':True,'maintainer_can_modify':False})
    return {'draftPrUrl':pr['html_url'],'headSha':commit,**checked}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--publish',action='store_true');p.add_argument('--expected-head');p.add_argument('--expected-main');a=p.parse_args()
    if a.publish and (not a.expected_head or not a.expected_main):p.error('--publish requires --expected-head and --expected-main after live ownership/authority inspection')
    print(json.dumps(publish(a.expected_head,a.expected_main) if a.publish else verify(),indent=2))
