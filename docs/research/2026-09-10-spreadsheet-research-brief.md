# Spreadsheet / table product research brief

Status: preserved research brief, **not a research result**. This records the question agreed before major Tachiko Sheet product decisions. The full Deep Research report is not currently present in the available repository/source set, so no absent findings are asserted here.

## Why research came before design

The project explicitly rejected starting from “clone Excel” or from the current Tachiko Work UI. The intended sequence was:

1. study mature spreadsheet/table products and their actual interaction models;
2. identify what is fundamental, what is historical baggage, and what has become non-negotiable user habit;
3. only then decide Tachiko Sheet's product and interaction model.

The research was also intended to keep **spreadsheet product research** separate from the later **Composable Application Platform** question. The former asks what a spreadsheet should be; the latter asks what should be shared underneath several official products.

## Products in scope

Primary:

- Microsoft Excel — Windows, macOS, Web, iPad
- Apple Numbers — macOS, iPad
- Google Sheets
- LibreOffice Calc
- Notion Database

Secondary / comparative:

- Airtable
- Coda
- Rows

## Questions to investigate

For each product, research:

- core mental model;
- cell / range / table / record / view data model;
- selection, editing, navigation and keyboard interaction;
- formatting, formula, fill, copy/paste;
- structured table / record behavior;
- collaboration and version history;
- desktop, web and touch differences;
- strong product decisions;
- historical baggage and failed/awkward behavior;
- behaviors that have become deeply learned user expectations.

The final comparison should explain the design philosophy behind the products rather than merely count features.

## Research constraints

- Do not design the final Tachiko Sheet in this research round.
- Do not assume Tachiko Sheet should clone Excel.
- Prefer official documentation, observable product behavior, first-party material and other reliable evidence.
- Distinguish a UI resemblance from a shared underlying model.
- Treat Notion/Airtable/Coda as useful contrasts for structured-data mental models, not as proof that spreadsheets should become databases.

## Why this still matters

The later platform research concluded that product-native semantic models should not be sacrificed for a hypothetical universal app model. That makes this spreadsheet research even more important: the platform should not decide what “spreadsheet-native” means on Tachiko Sheet's behalf.

However, because the full spreadsheet research output is not currently available here, this repository must not cite this brief as evidence for concrete interaction choices. Those choices require either the original report or fresh evidence.