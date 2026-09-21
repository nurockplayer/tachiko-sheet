# Reproduce and inspect FES45 v3

## Verify delivered files first

```sh
cd docs/design/fes45-v2
python verify_bundle.py
```

This checks manifest identity, every included input/output hash, 26 PNGs and their
raster dimensions, ordered evidence aggregate and recorded two-pass comparison.
Verification uses the Python standard library. It does not connect to GitHub or Drive.

## Browser preview

Open `preview.html` in a browser supporting `DecompressionStream`, or use its uncompressed
`preview-source.html`. Both are self-contained; no remote assets, tracking or fonts.
A separate 64px review toolbar switches normal/editing/copy-failure/unknown specimens.
It is outside the product and not present in the PNG evidence. The workbook adapts to
available width. These are fixed illustrative states, not connected runtime operations.

An ordinary local server is also suitable:

```sh
python -m http.server 8090 --bind 127.0.0.1
# Open http://127.0.0.1:8090/preview.html
# Exact entry: http://127.0.0.1:8090/index.html?scene=macbook-retina
```

The packed page and specimen switching were tested by in-memory Chromium loading;
this environment blocks file-URL navigation. The renderer itself never needs network
navigation. With missing exact fonts, only the portable preview explicitly announces
its system-font rendering. That fallback is not used for evidence.

## Pinned evidence environment

Linux x86_64; Python 3.13.5; Playwright 1.57.0; Pillow 12.3.0;
Chromium 144.0.7559.96. Chromium arguments:
`--no-sandbox --disable-gpu --font-render-hinting=none`.
The no-sandbox flag is for this isolated rendering environment; do not use it to browse
untrusted content. All outbound browser requests are aborted during evidence rendering.

Install isolated dependencies, not repository-root dependencies:

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
```

Use the same installed Chromium via `--chromium /path/to/chromium`. The bundle contains
no browser or font binaries. Required local PostScript faces:

- Inter-Regular, Inter-Medium, Inter-SemiBold, Inter-Italic.
- InterDisplay-SemiBold.
- NotoSansCJKjp-Regular, NotoSansCJKjp-Bold.
- NotoSansCJKtc-Regular, NotoSansCJKtc-Bold.

Noto JP/TC Medium is used when locally present; no synthetic weight is enabled.
Actual glyph faces are captured using the Chromium DevTools protocol and recorded
in `render-results.json`. Missing required local faces fail the exact renderer.
The authored v3 font policy explicitly admits TC rather than masking it as an older
v2 family. No fonts are downloaded by these scripts.

## Exact render and checks

```sh
python renderer.py --chromium /usr/bin/chromium --out renders
python renderer.py --chromium /usr/bin/chromium --out /tmp/fes45-v3-pass-b --compare renders
python checks.py
```

`--only fhd macbook-retina state-mac-unknownretaineddraft` permits quick design
iterations but never qualifies as the complete evidence set. The default captures
26 files in the required order. Main/board captures are 1×; detail regions are 2×.
Narrow viewport and full-layout files are distinct even when a future layout happens
to have matching height. No screenshots are resampled to pretend to be 2×.

Aggregate is SHA-256 of UTF-8 `${filename} ${sha256}\n`, one LF per entry in manifest
export order. Manifest SHA-256 is external in `MANIFEST.sha256`; no self-hash cycle.
Determinism is limited to the recorded environment, not cross-OS/font equivalence.
Changing any source/asset/evidence requires refreshed manifest, hashes and applicable review.

`python build_preview.py` rebuilds the optional packed portable viewer from local source.
`publish_bundle.py` is an opt-in full-source GitHub publisher; without `--publish` it
only verifies. It never obtains credentials, changes main, force-pushes, merges or approves.
