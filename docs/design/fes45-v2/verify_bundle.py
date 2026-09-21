#!/usr/bin/env python3
"""Verify this complete design bundle offline; no browser or external dependency."""
from __future__ import annotations
import hashlib
import json
import struct
from pathlib import Path

ROOT=Path(__file__).resolve().parent
MANIFEST='fes45-v3-manifest.json'

def digest(raw:bytes)->str:return hashlib.sha256(raw).hexdigest()

def verify()->dict:
    manifest_path=ROOT/MANIFEST
    expected=(ROOT/'MANIFEST.sha256').read_text().split()[0]
    actual=digest(manifest_path.read_bytes())
    if actual!=expected:raise ValueError('Manifest identity mismatch')
    m=json.loads(manifest_path.read_text())
    if m['implementationAuthority'] is not False or m['independentReviewStatus']!='PENDING':
        raise ValueError('Unexpected candidate disposition')
    for f in m['files']:
        rel=Path(f['path'])
        if rel.is_absolute() or '..' in rel.parts:raise ValueError('Unsafe manifest path')
        p=ROOT/rel
        if not p.is_file() or p.is_symlink():raise ValueError(f'Missing/unsafe file: {rel}')
        raw=p.read_bytes()
        if len(raw)!=f['bytes'] or digest(raw)!=f['sha256']:raise ValueError(f'File mismatch: {rel}')
    exports=m['exports']
    if len(exports)!=26 or len({x['filename'] for x in exports})!=26:raise ValueError('Wrong evidence inventory')
    lines=''
    for e in exports:
        p=ROOT/'renders'/e['filename'];raw=p.read_bytes()
        if raw[:8]!=b'\x89PNG\r\n\x1a\n':raise ValueError('Non-PNG evidence')
        size=struct.unpack('>II',raw[16:24]);dim=e['pixelDimensions']
        if size!=(dim['width'],dim['height']):raise ValueError(f'Wrong image size: {p.name}')
        if digest(raw)!=e['sha256']:raise ValueError(f'Wrong image hash: {p.name}')
        lines+=f"{e['filename']} {e['sha256']}\n"
    agg=digest(lines.encode('utf-8'))
    if agg!=m['evidenceAggregateSha256']:raise ValueError('Ordered aggregate mismatch')
    if (ROOT/'EVIDENCE.sha256').read_bytes()!=lines.encode():raise ValueError('Evidence ledger differs')
    comparison=json.loads((ROOT/'verification/determinism.json').read_text())
    if comparison['filesCompared']!=26 or not comparison['allMatch']:raise ValueError('Incomplete two-pass receipt')
    for a,b in zip(exports,comparison['comparisons']):
        if a['filename']!=b['filename'] or not b['match'] or a['sha256']!=b['passASha256'] or a['sha256']!=b['passBSha256']:
            raise ValueError('Second-pass receipt mismatch')
    return {'status':'PASS','verifiedFiles':len(m['files']),'requiredPngs':26,'evidenceAggregateSha256':agg,'manifestSha256':actual,'independentReviewStatus':'PENDING','implementationAuthority':False}

if __name__=='__main__':print(json.dumps(verify(),indent=2))
