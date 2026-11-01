# Excel sample workbooks

`invoice.xlsx` is copied byte for byte from Work `packages/browser-client/runtime/tests/excel_samples/invoice.xlsx`
(Work 3041b077, generated there by `mk_xlsx.py` with openpyxl): a title row, a blank row, the header on row 3,
five items with `=B4*C4` amounts in `"$"#,##0.00`, and a `Total` row `=SUM(D4:D8)`.
