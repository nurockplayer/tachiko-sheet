# Tachiko Sheet

Excel-like spreadsheet client for [Tachiko Work](https://github.com/nurockplayer/tachiko-work), with one Web/Desktop product and a shared Rust semantic runtime.

Sheet makes Tachiko's [mission](https://github.com/nurockplayer/tachiko-work/blob/main/docs/vision/mission.md)
practical: help people move beyond Office/OOXML dependence through a better,
open, user-owned product. Everyday spreadsheet usability and Work's semantic
capabilities must reinforce each other; an engine demo is not enough. See the
[founder clarification](https://github.com/nurockplayer/tachiko-work/issues/486).

**Status: implemented Web and macOS preview paths; product qualification continues.**
The [live handoff](https://github.com/nurockplayer/tachiko-sheet/issues/2) records
exact candidate, platform, signing and test evidence. This is not a claim of
full Driver certification, completed human acceptance or general availability.

## Download

Installers for macOS, Windows and Linux are on the
[Releases page](https://github.com/nurockplayer/tachiko-sheet/releases).

**macOS 13 or later (Apple Silicon or Intel):** open the DMG and drag Tachiko Sheet to Applications. Try to open it once, then go to System Settings > Privacy & Security and choose Open Anyway. With Homebrew: `brew install --cask nurockplayer/tap/tachiko-sheet`.

**Windows 10 or 11 (x64):** run the installer. When SmartScreen says it protected your PC, choose More info, then Run anyway.

**Linux (x64, Ubuntu 24.04 or later):** install the deb with `sudo apt install ./Tachiko-Sheet-*.deb`. Or make the AppImage executable with `chmod +x` and run it; the AppImage needs FUSE 2, which Ubuntu leaves out by default: `sudo apt install libfuse2t64`.

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

The current implementation uses React/TypeScript/Vite and pnpm, with a resident
Worker/WASM runtime on Web and a thin Tauri host over native Work Rust on macOS.
Exact upstream dependencies and consumer qualification are recorded in #2 and
[`docs/DESKTOP.md`](docs/DESKTOP.md). These are implementation choices, not a
stable SDK or a new semantic/file format.

Resume from the current handoff and owning Issue/PR, not the historical bootstrap
seed or its first implementation ticket. Seed self-tests, a packaged app and
individual green checks do not by themselves complete the product Mission.

The founder created this public repository. Public visibility is not a completed release, compatibility certification, licensing decision or invitation to bypass Tachiko Work's current contribution gates. No new licensing policy is introduced by this bootstrap.