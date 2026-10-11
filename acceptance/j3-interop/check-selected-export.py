"""Test-only fixed two-sheet oracle for Sheet #154's normal browser downloads.

Values come from J4's declared fixture and explicit scalar edit, never from the
app, import metadata, an earlier download or a reimport through the same core.
Passing this parser alone is FILE_CONTENT_ONLY, not runtime acceptance.
"""
import argparse
import csv
from pathlib import Path
import posixpath
import xml.etree.ElementTree as ET
import zipfile

from check import NS, assert_matrix, xlsx_cells

REL_NS = {'r': 'http://schemas.openxmlformats.org/package/2006/relationships'}
DOCUMENT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def check_selected_export(file, selected_table, sales_quantity):
    expected = {
        'Catalog': [['code', 'category', 'price'], ['PEN', 'PEN', 200], ['NOTE', 'NOTE', 500]],
        'Sales': [['product_code', 'quantity'], ['PEN ', sales_quantity], ['NOTE', 2]],
    }
    if file.suffix == '.csv':
        assert selected_table in expected, 'CSV requires the explicitly selected table'
        with file.open(encoding='utf-8-sig', newline='') as stream:
            actual = list(csv.reader(stream))
        wanted = [[str(value) for value in row] for row in expected[selected_table]]
        assert actual == wanted, (selected_table, actual, wanted)
    elif file.suffix == '.xlsx':
        assert selected_table == 'workbook', 'XLSX is a full-workbook export'
        with zipfile.ZipFile(file) as archive:
            workbook = ET.fromstring(archive.read('xl/workbook.xml'))
            sheets = workbook.findall('s:sheets/s:sheet', NS)
            assert [sheet.get('name') for sheet in sheets] == list(expected), 'All original sheets and names must survive'
            relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
            for sheet in sheets:
                relationship_id = sheet.get(f'{{{DOCUMENT_REL}}}id')
                matches = [entry for entry in relationships.findall('r:Relationship', REL_NS)
                           if entry.get('Id') == relationship_id]
                assert relationship_id and len(matches) == 1, 'Each sheet needs one unambiguous relationship'
                relationship = matches[0]
                assert relationship.get('Type') == f'{DOCUMENT_REL}/worksheet'
                assert relationship.get('TargetMode', 'Internal') == 'Internal'
                target = relationship.get('Target', '')
                assert target, 'Missing worksheet target'
                member = posixpath.normpath(target.lstrip('/') if target.startswith('/') else f'xl/{target}')
                assert member.startswith('xl/'), 'Worksheet must stay inside the workbook'
                cells, _ = xlsx_cells(file, member)
                assert_matrix(cells, expected[sheet.get('name')])
    else:
        raise AssertionError('Expected a real .csv or .xlsx download')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    parser.add_argument('--selected-table', choices=['Catalog', 'Sales', 'workbook'], required=True)
    parser.add_argument('--sales-quantity', type=int, choices=[4, 7], required=True)
    args = parser.parse_args()
    check_selected_export(args.file, args.selected_table, args.sales_quantity)
    print(f'PASS_FILE_CONTENT_ONLY: {args.selected_table}, quantity {args.sales_quantity}, {args.file}')
