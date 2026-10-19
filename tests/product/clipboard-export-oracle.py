"""Stdlib export oracle for the imported Text/Number/Number clipboard fixture."""
import csv
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

file = Path(sys.argv[1])
expected = json.loads(sys.argv[2])
if file.suffix == '.csv':
    with file.open(encoding='utf-8-sig', newline='') as stream:
        actual = list(csv.reader(stream))
else:
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(file) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = workbook.findall('s:sheets/s:sheet', ns)
        assert len(sheets) == 1, 'one exported table'
        rid = sheets[0].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        relations = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target = next(r.attrib['Target'] for r in relations if r.attrib['Id'] == rid).lstrip('/')
        if not target.startswith('xl/'):
            target = 'xl/' + target
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(si.itertext()) for si in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        actual = []
        for r, row in enumerate(ET.fromstring(archive.read(target)).findall('s:sheetData/s:row', ns)):
            assert row.attrib['r'] == str(r + 1), 'row order'
            assert len(row) == 3, 'three exported columns'
            values = []
            for c, cell in enumerate(row):
                assert cell.attrib['r'] == f'{chr(65 + c)}{r + 1}', 'cell order'
                assert cell.find('s:f', ns) is None, 'no formula transfer'
                kind = cell.attrib.get('t', 'n')
                assert kind in ('str', 's', 'inlineStr') if r == 0 or c == 0 else kind == 'n', 'scalar type'
                value = cell.findtext('s:v', '', ns)
                if kind == 's':
                    value = shared[int(value)]
                elif kind == 'inlineStr':
                    value = ''.join(cell.find('s:is', ns).itertext())
                values.append(value)
            actual.append(values)
assert actual == expected, 'every exported cell, including untouched row'
print(json.dumps({'status': 'PASS', 'export': str(file), 'data_cells': 9}))
