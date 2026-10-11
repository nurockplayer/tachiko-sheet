"""Independent standard-library oracle for the Sheet #150 8,406 x 3 Text lifecycle.

It never imports Tachiko parsers or writers. Values are invented synthetic data
(same recipe as Work #495's producer fixtures), never founder/private data.

  python3 oracle.py generate DIR
  python3 oracle.py verify FILE.csv|FILE.xlsx
"""

import csv
import io
import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROWS = 8406
HEADERS = ["account_id", "profile_url", "unix_timestamp"]
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
# Single-line values typed through the normal cell editor: first/middle/last.
EDITS = [
    [0, 0, '000-edited-雪,"first"'],
    [ROWS // 2, 1, "https://example.invalid/edited-middle?x=0007"],
    [ROWS - 1, 2, "0001700008405999"],
]


def values(count=ROWS):
    result = []
    for i in range(count):
        identifier = f"invented_{i:05}"
        if i % 1024 == 0:
            identifier += ',雪"quote"\nLF\r\nCRLF'
        result.append(
            [
                identifier,
                f"https://example.invalid/account/{i:05}",
                ("000" if i % 97 == 0 else "") + str(1700000000000 + i),
            ]
        )
    return result


def edited():
    rows = values()
    for r, c, value in EDITS:
        rows[r][c] = value
    return rows


def escaped(value):
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\r", "&#13;")
    )


def xlsx(rows):
    sheet = f'<worksheet xmlns="{MAIN}"><sheetData>'
    for r, row in enumerate([HEADERS, *rows], 1):
        cells = "".join(
            f'<c r="{chr(65 + c)}{r}" t="str"><v>{escaped(value)}</v></c>'
            for c, value in enumerate(row)
        )
        sheet += f'<row r="{r}">{cells}</row>'
    sheet += "</sheetData></worksheet>"
    parts = {
        "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        "_rels/.rels": f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<workbook xmlns="{MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": sheet,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, text in sorted(parts.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, text.encode())
    return buffer.getvalue()


def csv_bytes(rows):
    output = io.StringIO(newline="")
    csv.writer(output, lineterminator="\r\n", quoting=csv.QUOTE_ALL).writerows(
        [HEADERS, *rows]
    )
    return output.getvalue().encode()


def parse_csv(path):
    data = Path(path).read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    return list(csv.reader(io.StringIO(data.decode("utf-8"), newline="")))


def parse_xlsx(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)), "duplicate archive member"
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheets = workbook.findall(f"{{{MAIN}}}sheets/{{{MAIN}}}sheet")
        assert len(sheets) == 1, "unexpected worksheet count"
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        relationship_id = sheets[0].attrib[
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        ]
        target = next(
            r.attrib["Target"] for r in relationships if r.attrib["Id"] == relationship_id
        )
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        sheet = ET.fromstring(archive.read(target))
        shared = []
        if "xl/sharedStrings.xml" in names:
            shared = [
                "".join(si.itertext())
                for si in ET.fromstring(archive.read("xl/sharedStrings.xml"))
            ]
        rows = []
        for r, row in enumerate(sheet.findall(f"{{{MAIN}}}sheetData/{{{MAIN}}}row"), 1):
            assert row.attrib["r"] == str(r), "row order"
            cells = list(row)
            assert len(cells) == 3, f"column count at row {r}"
            out = []
            for c, cell in enumerate(cells):
                assert cell.attrib["r"] == f"{chr(65 + c)}{r}", "cell order"
                assert cell.find(f"{{{MAIN}}}f") is None, "unexpected formula"
                kind = cell.attrib.get("t")
                assert kind in ("str", "inlineStr", "s"), f"Text type lost at {cell.attrib['r']}"
                value = cell.findtext(f"{{{MAIN}}}v", "")
                if kind == "s":
                    value = shared[int(value)]
                elif kind == "inlineStr":
                    value = "".join(cell.find(f"{{{MAIN}}}is").itertext())
                out.append(value)
            rows.append(out)
        return rows


def generate(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    for count in [ROWS, ROWS + 1]:
        (directory / f"source-{count}.csv").write_bytes(csv_bytes(values(count)))
        (directory / f"source-{count}.xlsx").write_bytes(xlsx(values(count)))
    (directory / "malformed.csv").write_bytes(b'account_id,profile_url,unix_timestamp\r\n"unclosed')
    (directory / "malformed.xlsx").write_bytes(b"PK\x03\x04truncated")
    for extension, parse in [("csv", parse_csv), ("xlsx", parse_xlsx)]:
        assert parse(directory / f"source-{ROWS}.{extension}") == [HEADERS, *values()], extension
    (directory / "expected.json").write_text(
        json.dumps({"rows": ROWS, "headers": HEADERS, "edits": EDITS}, ensure_ascii=False)
    )


def verify(path):
    path = Path(path)
    actual = parse_csv(path) if path.suffix == ".csv" else parse_xlsx(path)
    expected = [HEADERS, *edited()]
    assert len(actual) == len(expected), f"row count {len(actual) - 1} != {ROWS}"
    mismatches = [
        (r, c, actual[r][c] if c < len(actual[r]) else None, expected[r][c])
        for r in range(len(expected))
        for c in range(3)
        if c >= len(actual[r]) or actual[r][c] != expected[r][c]
    ]
    assert all(len(row) == 3 for row in actual), "column count"
    assert not mismatches, f"{len(mismatches)} mismatches, first: {mismatches[:3]}"
    print(json.dumps({"verified": path.name, "rows": ROWS, "cells": ROWS * 3, "mismatches": 0}))


if __name__ == "__main__":
    action, target = sys.argv[1:3]
    {"generate": generate, "verify": verify}[action](target)
