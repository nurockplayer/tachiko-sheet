"""Test-only independent OOXML/CSV oracle; never imported by the product.

Without arguments, check corpus bytes/content only. With --export, independently
check a real export. Neither mode proves runtime, browser or host behavior.
"""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).resolve().parent
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
HEADERS = ['item', 'quantity', 'price']
RAW = [[' PEN ', '3', '200'], ['NOTE', '2', '500'], [' PEN ', '3', '200']]
CLEAN = [['PEN', 3, 200], ['NOTE', 2, 500]]
SENTINELS = ['0012', '03/04/2026']


def xlsx_cells(file, sheet='xl/worksheets/sheet1.xml'):
    with zipfile.ZipFile(file) as z:
        assert z.testzip() is None, 'Corrupt ZIP member'
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            shared = [''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        root = ET.fromstring(z.read(sheet))
        cells = {}
        for c in root.findall('.//s:sheetData/s:row/s:c', NS):
            assert c.find('s:f', NS) is None, 'This bounded oracle expects values, not formula caches'
            kind = c.get('t', 'n')
            v = c.find('s:v', NS)
            text = v.text if v is not None else None
            if kind == 's':
                value = shared[int(text)]
            elif kind == 'inlineStr':
                value = ''.join(n.text or '' for n in c.findall('s:is//s:t', NS))
            elif kind == 'str':
                value = text or ''
            elif kind == 'n' and text is not None:
                value = float(text)
                assert math.isfinite(value)
            elif text is None:
                continue
            else:
                raise AssertionError(f'Unexpected cell type {kind} at {c.get("r")}')
            cells[c.get('r')] = value
        return cells, root


def assert_matrix(cells, rows):
    expected = {f'{chr(65+c)}{r+1}': value for r, row in enumerate(rows) for c, value in enumerate(row)}
    assert cells == expected, (cells, expected)
    for address, expected_value in expected.items():
        if isinstance(expected_value, str):
            assert isinstance(cells[address], str), f'{address}: text coerced'
        else:
            assert isinstance(cells[address], (int, float)), f'{address}: number not numeric'


def check_corpus():
    manifest = json.loads((HERE / 'corpus.json').read_text())
    assert manifest['status'] == 'PREPARED_NOT_RUNTIME_QUALIFIED'
    assert manifest['headers'] == HEADERS and manifest['raw_rows'] == RAW
    assert manifest['clean_rows'] == CLEAN and manifest['text_sentinels'] == SENTINELS
    for name, expected in manifest['files'].items():
        content = (HERE / 'fixtures' / name).read_bytes()
        assert len(content) == expected['bytes'], name
        assert hashlib.sha256(content).hexdigest() == expected['sha256'], name
    with (HERE / 'fixtures/messy.csv').open(newline='') as f:
        assert list(csv.reader(f)) == [HEADERS] + RAW
    with (HERE / 'fixtures/text-sentinels.csv').open(newline='') as f:
        assert list(csv.reader(f)) == [['value']] + [[s] for s in SENTINELS]
    for name in ['messy.xlsx', 'merged-note.xlsx']:
        cells, _ = xlsx_cells(HERE / 'fixtures' / name)
        assert_matrix(cells, [HEADERS] + RAW)
    cells, root = xlsx_cells(HERE / 'fixtures/merged-note.xlsx', 'xl/worksheets/sheet2.xml')
    assert cells == {'A1': 'Preserve this merged source note'}
    assert [n.get('ref') for n in root.findall('s:mergeCells/s:mergeCell', NS)] == ['A1:B1']
    fixed = HERE.parent / 'mvp-v1/scenarios.json'
    if fixed.exists():
        j3 = next(j for j in json.loads(fixed.read_text())['journeys'] if j['id'] == 'J3')
        assert j3['raw_rows'] == RAW and j3['clean_rows'] == CLEAN
        assert j3['preserve_as_text'] == SENTINELS[0] and j3['ambiguous_date'] == SENTINELS[1]
        assert j3['total'] == 1600
    assert sum(row[1] * row[2] for row in CLEAN) == manifest['fixed_total_reference'] == 1600
    print(json.dumps({'case': 'J3 corpus integrity/content', 'status': 'PASS_PREPARATION_ONLY', 'files': 4, 'fixed_scenario_crosscheck': 'PASS' if fixed.exists() else 'NOT_AVAILABLE'}))


def check_export(file):
    if file.suffix == '.csv':
        with file.open(encoding='utf-8-sig', newline='') as f:
            assert list(csv.reader(f)) == [HEADERS] + [[str(v) for v in row] for row in CLEAN]
    elif file.suffix == '.xlsx':
        with zipfile.ZipFile(file) as z:
            workbook = ET.fromstring(z.read('xl/workbook.xml'))
            assert len(workbook.findall('s:sheets/s:sheet', NS)) == 1, 'Unexpected exported worksheets'
        cells, _ = xlsx_cells(file)
        assert_matrix(cells, [HEADERS] + CLEAN)
    else:
        raise AssertionError('Expected .csv or .xlsx')
    print(json.dumps({'case': 'J3 independent external-format values', 'status': 'PASS_FILE_CONTENT_ONLY', 'file': str(file)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export', type=Path, dest='export_file')
    args = parser.parse_args()
    check_export(args.export_file) if args.export_file else check_corpus()
