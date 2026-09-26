"""Deterministic standard XLSX test sources; never a product storage codec."""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZipInfo, ZIP_STORED
ROOT = Path(__file__).parent / 'fixtures'
N = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
for empty in (False, True):
    sheets = [('sales', [['product_code','quantity'],['PEN','4'],['NOTE','5']]),
              ('catalog', [['code','category','price'],['PEN','Stationery','200'],['NOTE','Paper','200']]),
              ('dates', [['event_date']] + ([] if empty else [['2026-09-26']]))]
    entries = {'[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1,4)) + '</Types>',
               '_rels/.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
               'xl/workbook.xml': f'<workbook xmlns="{N}" xmlns:r="{R}"><sheets>' + ''.join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>' for i,(name,_) in enumerate(sheets,1)) + '</sheets></workbook>',
               'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="rId{i}" Type="{R}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,4)) + '</Relationships>'}
    for i,(_,rows) in enumerate(sheets,1):
        body = ''.join(f'<row r="{r}">' + ''.join(f'<c r="{chr(65+c)}{r}" t="inlineStr"><is><t>{escape(v)}</t></is></c>' for c,v in enumerate(row)) + '</row>' for r,row in enumerate(rows,1))
        entries[f'xl/worksheets/sheet{i}.xml'] = f'<worksheet xmlns="{N}"><sheetData>{body}</sheetData></worksheet>'
    with ZipFile(ROOT / ('unrelated-date-empty.xlsx' if empty else 'unrelated-date.xlsx'),'w') as z:
        for name,body in sorted(entries.items()):
            info = ZipInfo(name,(2026,1,1,0,0,0)); info.compress_type=ZIP_STORED
            z.writestr(info,body.encode())
for rows in (64,65):
    (ROOT/f'rows-{rows}.csv').write_text('value\n'+''.join(f'row{i}\n' for i in range(rows)))
for fields in (16,17):
    (ROOT/f'fields-{fields}.csv').write_text(','.join(f'c{i}' for i in range(fields))+'\n'+','.join('x' for _ in range(fields))+'\n')
