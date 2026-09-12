# Tachiko Sheet

Excel-like spreadsheet client for [Tachiko Work](https://github.com/nurockplayer/tachiko-work), with one Web/Desktop product and a shared Rust semantic runtime.

**Status: Mission and acceptance preparation; no working product is claimed.**

Start with the live [Mission #1](https://github.com/nurockplayer/tachiko-sheet/issues/1), [current handoff #2](https://github.com/nurockplayer/tachiko-sheet/issues/2), and [AGENTS.md](AGENTS.md).

- [Product scope and first slice](docs/SPEC.md)
- [Continuous delivery and merge authority](docs/DELIVERY.md)
- [Full spreadsheet acceptance](docs/PRODUCT-ACCEPTANCE.md)
- [Prepared executable tests](docs/ACCEPTANCE.md)
- [Upstream authority and issue routing](docs/UPSTREAM.md)
- [Sheet product / architecture principles](docs/PRODUCT-PRINCIPLES.md)
- [Research index and decision provenance](docs/research/README.md)

Sheet is one client, not the container for every future Tachiko client. Full document editing, slides, ERP and CRM are separate product/solution decisions. Notes, reports and contextual assistance support spreadsheet work here.

The current architecture stance is **product-native semantics, platform-ready boundaries**: build a real spreadsheet against Tachiko Work's existing semantic authority, preserve explicit seams for future cross-product resources and validated reusable engines, and do not pre-build a universal block/node model or end-user App Builder. The evidence and limits behind that stance are preserved under [`docs/research/`](docs/research/).

The initial technical direction is React/TypeScript/Vite, pnpm, resident Rust/WASM and later a thin Tauri macOS host. These are provisional implementation choices, not a stable SDK or a new semantic/file format.

The executable seed lives on `acceptance/sheet-foundation`; exact refs and actual checks are recorded in #2. Its oracle self-tests are not product acceptance. The first implementer starts at #3 and follows the Mission rather than stopping after a demo.

The founder created this public repository. Public visibility is not a completed release, compatibility certification, licensing decision or invitation to bypass Tachiko Work's current contribution gates. No new licensing policy is introduced by this bootstrap.