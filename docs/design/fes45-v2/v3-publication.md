# FES45 v3 — published visual-design candidate

Refs #45. **Independent review: PENDING. Implementation authority: false.**

## Publication scope

This GitHub record pins the completed candidate; the **complete source, renderer, assets, manifest, verification scripts, portable browser preview and 26 PNGs are stored in the linked Drive ZIP**. This branch is a publication/index checkpoint, not a claim that all 59 bundle files or their PNG bytes have been committed to GitHub. Do not merge it as a fully imported/approved design package.

- Complete folder: https://drive.google.com/drive/folders/1zmVcHBr-6ncLzkMZDJWOMIZHrjxC4Dzn
- Complete ZIP: https://drive.google.com/file/d/1yiPaY7BYwb3g70FdqPvArEFPylriaNdH/view
- Manifest: https://drive.google.com/file/d/1vbCHZVhwINciHp3ezKO6ARmCkloRsHvU/view
- Standalone browser preview: https://drive.google.com/file/d/1Kt8E-czIELv-TyTPTIsrm22euxmhKXS1/view

The ZIP was uploaded, fetched back from Drive, and independently byte-hashed in the authoring environment: 11,222,082 bytes, 59 files, all under `docs/design/fes45-v2/`. No font binaries, caches or production files.

## Inspect the actual renders

- MacBook Retina, 1512 x 982: https://drive.google.com/file/d/170cplweaq1wvrPITFMEkFgUPl8nQoiYB/view
- FHD, 1920 x 1080: https://drive.google.com/file/d/1SGALDQTVu7kxiWbOvW35pQNgkR_9iXFP/view
- Mac UnknownRetainedDraft: https://drive.google.com/file/d/104mzMmOpqZq92lpmmtS3tZnr0a7X7Gbl/view

## Exact identities

```text
evidenceAggregateSha256: bf583416d1cd394f4b31091ad42ca6c4ab87b5c130224fb68577638c1351fd38
manifestSha256: 9e0b328f34452ac2fdfb9ae0582ccc6015356bd02f6857c8e05138571c4df4ad
zipSha256: 18d2baea8505b473c6ff7e4171c19aa20bc9f051eb88b84002e9eaab13b4cce8
independentReviewStatus: PENDING
implementationAuthority: false
```

The ordered aggregate uses UTF-8 `filename sha256\n` in manifest export order. Two complete render passes matched all 26 PNG hashes. Three detail captures are actual 2x renders. Additional author-owned browser checks: 61 passed, zero failed. These results are not independent visual review, actual-device/IME/screen-reader evidence or product acceptance.

## Authority and design

The founder's latest direct conversation brief assigns the assistant the visual-design-lead role and explicitly permits a new visual language rather than preserving v2 cosmetics. This supersedes cosmetic restrictions only; the product semantics, supported commands, state truth, accessibility, dense usability and responsive requirements remain.

Inherited references:
- https://github.com/nurockplayer/tachiko-sheet/issues/45#issuecomment-5750876616
- https://github.com/nurockplayer/tachiko-sheet/issues/45#issuecomment-5750985478
- Semantic source reference: `62e57a0af4423b0e028e862530bc7f130345da57`.
- Inspected repository base: `eabf8bc46b54422499eef81f88438b5be1ae3e4e`.

Author: GPT-6 Astra Pro, acting as the directly assigned visual design lead. Independently verifiable session ID unavailable; no separate GPT-6 Pro execution receipt or independent review is claimed.

The candidate uses a porcelain/violet document header, an optical 32px sprout, 18px document title, 14px Inter data text at unchanged 28px row pitch, coherent action/View icons, 7px controls, calmer grid borders, a single keyboard cell-focus perimeter and explicit semantic exception messages. Noto Sans CJK JP/TC are deliberately chosen v3 local faces. The exact renderer fails when required fonts are missing; the portable preview alone labels any system-font fallback.

The retained `abc` draft, committed `18`, older saved copy, unsaved work and unknown currentness/outcome remain separate and visible. No AI, sharing, cloud, search/filter, formatting ribbon or fake worksheet affordance was added.

## Reproduce / fully import

Extract the ZIP; run `python verify_bundle.py` inside `docs/design/fes45-v2/`. Follow `REPRODUCE.md` for the pinned Chromium/font environment, rendering and browser checks. `publish_bundle.py` is an optional complete-file publisher for an authenticated environment: it verifies bytes, requires explicit inspected main/branch HEADs, and permits only ordinary non-force branch updates and Draft PR publication. It never merges or approves.

Founder rendered-result approval and an eligible independent review remain mandatory. The full bundle must be imported and applicable exact-head repository gates satisfied before any design-package merge. No production implementation, Figma synchronization, hold clearance or integration-role takeover is authorized here.
