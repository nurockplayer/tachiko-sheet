# Composable Application Platform Deep Research brief

Status: preserved final research brief. This records the deliberately shortened prompt used to investigate the platform hypothesis. It is a research question, not an architecture decision.

## Why the prompt was kept compact

An earlier draft enumerated many possible subproblems (serialization, stable IDs, plugin APIs, repository boundaries, clipboard, schema migration, output chapters, etc.). The discussion concluded that this could over-constrain Deep Research into shallow checklist completion.

The final brief therefore defined the problem, non-goal, representative evidence set and decision questions, while leaving the research model room to discover which subproblems actually mattered.

## Final brief

> 為 Tachiko Work 做一次深入產品與架構研究。
>
> 背景：
>
> 我們正在開發 `tachiko-sheet`，但 Tachiko Work 未來可能還會有：
>
> - Doc / Word-like
> - Slide / PowerPoint-like
> - CRM
> - ERP
> - Project Management
> - Dashboard 與垂直產業應用
>
> 目前正在考慮一個重要方向：
>
> **Tachiko Work 是否應該是一套 composable application platform，由官方使用共用 primitives 組裝不同完整產品？**
>
> 例如：
>
> `tachiko-sheet = Grid + Formula + Table + Chart + Commands + Toolbar + spreadsheet-specific semantics`
>
> 這裡的「composable」主要是內部產品架構。
>
> 現階段不打算讓一般使用者像 low-code builder 一樣自由組 UI；使用者拿到的是官方設計完成、有明確 UX 的產品。
>
> 請研究這種架構思想，而不是直接替 Tachiko Work 設計最終方案。
>
> 重點研究：
>
> - Notion / Coda / Airtable
> - Microsoft Office / Loop / Fluid
> - Google Workspace
> - Apple iWork
> - Figma
> - Retool / Power Apps 等 application builders
> - ProseMirror / Tiptap / Lexical 等 composable editor architecture
> - 其他具有 shared platform + multiple products 特性的成熟系統
>
> 特別回答：
>
> 1. 成功的多產品系統通常共用到哪一層？
> 2. 哪些能力適合成為 reusable primitives，哪些應維持 product-specific？
> 3. Spreadsheet、document、database、canvas 這些不同 mental model 是否真的適合共享底層模型？
> 4. 如何做到 cross-product embedding 與 shared data，而不把所有東西強迫統一成 block/table/cell？
> 5. Template system 與未來可組合應用會對現在的架構造成哪些要求？
> 6. 什麼時候 platformization 是優勢，什麼時候會變成 premature abstraction？
> 7. 有哪些真實失敗案例或 anti-pattern？
> 8. 對仍處於早期的 `tachiko-sheet`，哪些事情：
>    - 必須現在決定
>    - 只需要保留 architectural seam
>    - 可以延後
>    - 現在不應該做
>
> 優先使用官方文件、engineering blog、conference talks、原始 repository 與其他一手資料。
>
> 不要因為產品 UI 類似就推測內部架構；無法確認的部分標示為 unknown。
>
> 這輪的目標不是產生 implementation plan，而是取得足夠證據，供下一輪制定 Tachiko Work 的 Product Constitution、Architecture Principles 與 ADR。

## Prompt-design principle retained from the discussion

> **A Deep Research prompt should define the problem and evidence boundary, not pre-solve the entire research tree.**

The report produced from this brief is digested in [`2026-09-12-composable-platform-report.md`](2026-09-12-composable-platform-report.md).