# #19 viewport streaming：權威、能力與驗收缺口盤點

狀態：**docs-only preparation，未採用的設計策略不是實作授權**。追蹤 [#19](https://github.com/nurockplayer/tachiko-sheet/issues/19) 與 [#36](https://github.com/nurockplayer/tachiko-sheet/issues/36)。本文只整理現有權威、已觀察能力與未證實缺口；不選 virtualization library、演算法、cache policy、API、workload、數值門檻或可接受的 LOD 行為。

## 1. 範圍與固定基線

| 項目 | 值 | 用途與限制 |
| --- | --- | --- |
| Sheet inspected main | `a8ac732e3fc127f85193786ef18f97f8f14073fb` | 本盤點的 client 原始碼／文件基線；不是效能資格證明。 |
| Sheet core pin | `518aaa55e046a4e4676b4d5e05d8189c4c6343fe` | 目前 consumer 的唯一 kit 基線；不能由 upstream newer main 自動替換。 |
| core manifest SHA-256 | `ae82d68592b73ac5da4f72fe9242833f2e9ba15e93480fac01d5d7751b86125b` | 證明本盤點所指 kit artifact；不是 public SDK 或產品 PASS。 |
| Upstream authority inspected | `tachiko-work@fb9fe34a5777ff31b5f1951941914372ae6d55ea` | 僅作 authority read；開始任何 upstream 依賴工作前必須重讀 live main/owner。 |

本盤點不改 canonical state、公式、validation、revision、storage、semantic API 或 host capability。#19 的「完整 semantic state 不等於完整 presentation/materialization」是方向，不是允許依 viewport 改變公式、validation、sort/filter、merge 或 save 結果的例外。

## 2. 已有權威與不可跨越的線

| 權威 | 已接受／已知事實 | 對 #19 的限制 |
| --- | --- | --- |
| [Sheet #1](https://github.com/nurockplayer/tachiko-sheet/issues/1) / [#19](https://github.com/nurockplayer/tachiko-sheet/issues/19) | Rust runtime 是語意、計算、validation、revision 與 publication authority；presentation working set 可被限制。 | Sheet 不得建立第二個 JS workbook，也不得以 offscreen 為理由略算語意依賴。 |
| [ADR-0022](https://github.com/nurockplayer/tachiko-work/blob/fb9fe34a5777ff31b5f1951941914372ae6d55ea/docs/decisions/ADR-0022-resident-semantic-runtime-and-host-boundary.md) | resident Rust runtime 是偏好的互動拓撲；frontend projection/cache 非權威；full snapshot 是明確邊界。 | UI cache、prefetch 與 eviction 不能成為 canonical state 或自行發布結果。 |
| [frontend/backend boundary](https://github.com/nurockplayer/tachiko-work/blob/fb9fe34a5777ff31b5f1951941914372ae6d55ea/docs/architecture/frontend-backend-boundary.md) | 原生／WASM 在重疊 capability 上需保留等價 Stable semantic observations。 | 不能用只在 Web 或只在 DOM 的 shortcut 宣稱相同語意。 |
| [semantic API](https://github.com/nurockplayer/tachiko-work/blob/fb9fe34a5777ff31b5f1951941914372ae6d55ea/docs/specs/semantic-api.md) | public transport、Worker lifecycle、projection delivery/invalidation protocol、精確 DTO 與 concurrency transport 仍屬 provisional/deferred。 | upstream 內部 selective-projection 實作不是目前 Sheet pin 已公開能力，也不是可直接依賴的 client contract。 |
| Sheet `docs/architecture/README.md` §7 | viewport/overscan 與 projection request 必須分開；cache identity 至少受 occurrence、revision、query/definition 約束。 | 本文件不能預選 overscan 數、cache key shape 或失效範圍。 |

## 3. exact-pin 現況：只記錄，不推論能力

`src/runtime/session.ts` 明確維持一個 resident public client，將 `occurrence`、`revision` 與 collection handle 視為 opaque，並以 coherent reads 檢查 `observeOccurrence()`、`bootstrap()`、`queryTable()` 的 revision 一致。`WorkbookView` 是 disposable projection；晚到或不一致結果不可以當 current。這是 revision/currentness 邊界的現有證據，不是 large-workbook 或 virtualization 證據。

在此 consumer 所使用的 public methods 中，可觀察到 `queryTable(collection)`, `queryFields(revision, targets)` 與 J4 grouped-summary queries。盤點沒有找到一個已被此 exact pin 使用、且可證明為 viewport-bounded table projection、scroll prefetch、eviction、projection patch delivery 或 DOM virtualization 的 public contract。因此這些能力一律標為 **UNVERIFIED**；不得由 method 名稱或 upstream implementation 推定它們可用。

## 4. #19 八項問題的追溯表

| #19 問題 | 既有約束／現況證據 | UNVERIFIED 缺口 | owner 與下一個安全方向 |
| --- | --- | --- | --- |
| 1. viewport/overscan working set，且座標不是 semantic identity | UI selection/focus/viewport 屬 Sheet；runtime identity/revision 不屬位置。 | grid 是否可在不破壞 keyboard、range、variable sizing、frozen/hidden semantics 下限制 DOM materialization。 | Sheet。未來 child 先取得具體 UI acceptance 與 baseline interaction evidence。 |
| 2. 向 resident core 請求 bounded projection | ADR-0022 允許非權威 projection；session 已做 revision-pinned public reads。 | pinned kit 是否公開 bounded table/field projection、其 identity、錯誤、currentness與 capability discovery。 | upstream owner（若需 capability）＋Sheet consumer qualification。不得偷用 internal/WASM ABI。 |
| 3. prefetch、eviction、revision-keyed invalidation | README 要求 identity-aware cache，且 stale reply 不得 current。 | safe eviction boundary、prefetch trigger、失效推導、memory ownership與 late-reply behavior。 | 需先由既有 acceptance 指定 user-observable behavior；可能跨 Sheet/upstream。 |
| 4. rendering virtualization、runtime selective projection、semantic evaluation 的分界 | #19 明定 offscreen dependency 仍可能必須計算；Rust 是唯一 evaluator。 | 何種 data path 可延後呈現但仍有完整 semantic equivalence；如何證明沒有 JS mirror。 | Sheet 可先驗證 rendering-only seam；任何 calculation/projection API 需求回 upstream。 |
| 5. Web/macOS representative workload、memory/performance budget | #19 要求實際 shipped architecture 的 representative evidence。 | workload corpus、hardware/environment matrix、memory/latency/scroll threshold、macOS host availability。 | workload/threshold 是產品 acceptance，回 Steward；host evidence依 #7/#16 owner。 |
| 6. chart/presentation LOD/downsampling | #19 僅允許在 accepted 時考慮 presentation LOD；J5 仍有 P2-B HOLD。 | 哪種 rendered simplification 可接受、如何標示、何時 current、與 export/share 的關係。 | Steward／J5 owner；本盤點不得為 chart 選擇 LOD。 |
| 7. keyboard、range、frozen panes、hidden rows/columns、editing、accessibility、copy/paste | architecture README 保留 keyboard、CJK composition、focus restoration與穩定選取 identity；#16 只有 partial physical QA。 | 真實 IME、assistive tech、touch、large-grid focus/range traversal與 virtualized accessibility semantics。 | Sheet acceptance/QA；沒有上述 evidence 不得宣稱 UI virtualization Ready。 |
| 8. Worker/WASM transfer cost與 JS duplicate risk | ADR-0022 禁止 frontend 成為第二權威；目前 public transport/Worker lifecycle仍 deferred。 | actual payload sizing、copy/transfer behavior、Worker lifecycle、browser/native parity、backpressure與 recovery。 | upstream transport owner＋Sheet host qualification；不建立自行猜測的 Worker protocol。 |

## 5. 將來 evidence package（不是驗收 oracle）

任何後續候選只能依已接受的 concrete outcome 選取適用證據；以下不是數值目標或 PASS 條件：

| evidence class | 必須能回答的問題 | 現在狀態 |
| --- | --- | --- |
| semantic equivalence | offscreen dependency 是否仍得到與完整 evaluation 相同的 current result與 diagnostics？ | UNVERIFIED |
| projection provenance | projection 是否綁定正確 occurrence/revision/query/definition，stale reply 是否被拒絕？ | 現有 session 的一般 coherent-read guard 有部分證據；bounded projection case UNVERIFIED |
| rendering/interaction | scroll、selection、edit、range、focus restoration、copy/paste 是否不因 materialization window 失真？ | UNVERIFIED |
| accessibility/IME | composition Enter/Escape/Tab、screen reader relation、virtualized row/column announcements 是否可用？ | UNVERIFIED |
| resource/transfer | 代表性 workload 的 DOM/JS/Rust/transfer ownership與觀察值為何？ | UNVERIFIED |
| host/platform | Web 與 macOS 需要哪些相同或明確不同的 capability/evidence？ | UNVERIFIED；#7/#16 retain ownership |
| recovery | open/close/replacement、late projection、cache eviction後是否仍 truthful current/saved？ | existing generic recovery guards exist; virtualization-specific case UNVERIFIED |

## 6. 明確停止與 routing

以下任一問題出現時，停止把工作稱為 docs-only preparation：

- 必須選擇 workload、memory/latency threshold、viewport/overscan value、LOD user-visible behavior或新的 acceptance outcome；**回 ChatGPT Steward**。
- 必須新增或改變 bounded projection、invalidation、Worker/WASM transport、semantic calculation或 public API；**回既有 upstream owner**，並重讀 live upstream authority。
- 必須改 Sheet source、tests、dependency、host persistence、core pin或任何 acceptance oracle；建立另一個具體 child，重新檢查 Ready/owner/Astra consultation/independent adequacy。
- 有任一 `UNVERIFIED` 被誤呈為 supported、current、saved、accessible、performant或 equivalent；保留為 blocking evidence gap。

完成 #36 只表示本表可追溯、缺口與 owner 已明列、且未新增承諾。它**不**關閉 #19，不使 source lane Ready，不是 benchmark PASS，也不解除 J5 P2-B、#7 或 #16 的 gate。
