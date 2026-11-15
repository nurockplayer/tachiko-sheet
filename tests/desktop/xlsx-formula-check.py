"""Check exact sheet names and cell formulas/caches using independent XLSX XML.

Usage: python3 xlsx-formula-check.py export.xlsx '{"Sheet": {"C2": {"formula": "(A2*B2)", "value": 6}}}'
Formula text excludes Excel's leading '='. All formula cells must be specified.
"""
import json
import posixpath
import sys
import zipfile
import xml.etree.ElementTree as ET


def check(filename, expected):
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rid = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    with zipfile.ZipFile(filename) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheets = workbook.findall("s:sheets/s:sheet", ns)
        assert [sheet.get("name") for sheet in sheets] == list(expected), "sheet names/order differ"
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.get("Id"): rel.get("Target") for rel in relationships}
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(item.itertext()) for item in
                       ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", ns)]
        for sheet in sheets:
            target = targets[sheet.get(rid)]
            target = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            xml = ET.fromstring(archive.read(target))
            cells = {cell.get("r"): cell for cell in xml.findall("s:sheetData/s:row/s:c", ns)}
            wanted = expected[sheet.get("name")]
            formulas = {address for address, cell in cells.items() if cell.find("s:f", ns) is not None}
            assert formulas == {address for address, cell in wanted.items() if "formula" in cell}, "formula cell inventory differs"
            for address, spec in wanted.items():
                cell = cells[address]
                label = f"{sheet.get('name')}!{address}"
                formula = cell.findtext("s:f", namespaces=ns)
                assert formula == spec.get("formula"), f"{label}: formula {formula!r} != {spec.get('formula')!r}"
                value = cell.findtext("s:v", namespaces=ns)
                kind = cell.get("t", "n")
                if kind == "s":
                    value = strings[int(value)]
                elif kind == "inlineStr":
                    value = "".join(cell.find("s:is", ns).itertext())
                elif kind == "n":
                    assert value is not None and value != "", f"{label}: missing cached value"
                    value = float(value)
                assert value == spec["value"], f"{label}: cached value {value!r} != {spec['value']!r}"


if __name__ == "__main__":
    check(sys.argv[1], json.loads(sys.argv[2]))
