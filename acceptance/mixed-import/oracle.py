"""Independent stdlib fixture/export oracle for Sheet #160; no Tachiko codecs.
CSV checks canonical text. XLSX checks coordinates, order and scalar types.
"""
import csv
import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
TEXT_TYPES = ('str', 's', 'inlineStr')


def headers(cols):
    return [f'identifier_{c}' if c % 2 == 0 else f'amount_{c}' for c in range(cols)]


def values(rows, cols, edited=False):
    data = [[f'00{r:05}-雪-{c}' if c % 2 == 0 else str(r * 16 + c) for c in range(cols)] for r in range(rows)]
    if edited:
        data[rows // 2][1] = '424242'
    return [headers(cols), *data]


def csv_bytes(data):
    output = io.StringIO(newline='')
    csv.writer(output, lineterminator='\r\n').writerows(data)
    return output.getvalue().encode()


def xlsx_bytes(data):
    sheet = ET.Element('worksheet', xmlns=MAIN)
    body = ET.SubElement(sheet, 'sheetData')
    for r, row in enumerate(data, 1):
        node = ET.SubElement(body, 'row', r=str(r))
        for c, value in enumerate(row):
            cell = ET.SubElement(node, 'c', r=f'{chr(65+c)}{r}', t='str' if r == 1 or c % 2 == 0 else 'n')
            ET.SubElement(cell, 'v').text = value
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': f'<workbook xmlns="{MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Mixed" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': ET.tostring(sheet, encoding='unicode'),
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, text in sorted(parts.items()):
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, text.encode())
    return buffer.getvalue()


def parse(file, cols):
    if file.suffix == '.csv':
        return list(csv.reader(io.StringIO(file.read_text(encoding='utf-8-sig'), newline='')))
    with zipfile.ZipFile(file) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)), 'duplicate ZIP entries'
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = workbook.findall(f'{{{MAIN}}}sheets/{{{MAIN}}}sheet')
        assert len(sheets) == 1, 'sheet count'
        rid = sheets[0].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        relations = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target = next(r.attrib['Target'] for r in relations if r.attrib['Id'] == rid).lstrip('/')
        if not target.startswith('xl/'):
            target = 'xl/' + target
        shared = []
        if 'xl/sharedStrings.xml' in names:
            shared = [''.join(si.itertext()) for si in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        data = []
        for r, node in enumerate(ET.fromstring(archive.read(target)).findall(f'{{{MAIN}}}sheetData/{{{MAIN}}}row'), 1):
            assert node.attrib['r'] == str(r), 'row order'
            assert len(node) == cols, 'column count'
            row = []
            for c, cell in enumerate(node):
                assert cell.attrib['r'] == f'{chr(65+c)}{r}', 'cell order'
                assert cell.find(f'{{{MAIN}}}f') is None, 'unexpected formula'
                kind = cell.attrib.get('t', 'n')
                assert kind in TEXT_TYPES if r == 1 or c % 2 == 0 else kind == 'n', f'scalar type at {cell.attrib["r"]}'
                value = cell.findtext(f'{{{MAIN}}}v', '')
                if kind == 's': value = shared[int(value)]
                elif kind == 'inlineStr': value = ''.join(cell.find(f'{{{MAIN}}}is').itertext())
                row.append(value)
            data.append(row)
        return data


def generate(directory):
    folder = Path(directory)
    folder.mkdir()
    # Main journeys plus accepted row/cell edges and each dimension just beyond.
    for rows, cols in [(320, 2), (1000, 16), (1576, 16), (8406, 1), (320, 17), (8407, 2), (1577, 16)]:
        data = values(rows, cols)
        for suffix, encode in [('csv', csv_bytes), ('xlsx', xlsx_bytes)]:
            file = folder / f'source-{rows}x{cols}.{suffix}'
            file.write_bytes(encode(data))
            assert parse(file, cols) == data
    (folder / 'malformed.csv').write_bytes(b'a,b\r\n"unclosed')
    (folder / 'malformed.xlsx').write_bytes(b'PK\x03\x04truncated')
    nonfinite = values(320, 2)
    nonfinite[200][1] = '1e999'
    (folder / 'nonfinite.csv').write_bytes(csv_bytes(nonfinite))
    (folder / 'nonfinite.xlsx').write_bytes(xlsx_bytes(nonfinite))
    (folder / 'expected.json').write_text(json.dumps({f'{r}x{c}': values(r, c) for r, c in [(320, 2), (1000, 16), (1576, 16), (8406, 1)]}, ensure_ascii=False))


def verify(file, rows, cols, edited):
    actual = parse(Path(file), cols)
    expected = values(rows, cols, edited)
    assert actual == expected, 'all-row/all-cell canonical value equality'
    print(json.dumps({'verified': str(file), 'rows': rows, 'cells': rows * cols, 'types': 'Text/Number' if str(file).endswith('.xlsx') else 'canonical text', 'mismatches': 0}))


if __name__ == '__main__':
    if sys.argv[1] == 'generate': generate(sys.argv[2])
    else: verify(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5] == 'edited')
