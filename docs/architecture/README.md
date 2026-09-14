# Tachiko Sheet — Clean Architecture 設計

狀態：**Proposed Sheet-local target design**。設計追蹤：[#33](https://github.com/nurockplayer/tachiko-sheet/issues/33)。依創辦人 2026-09-15 JST 的要求撰寫；經正常審查與整合前，不是已生效的新 dispatch authority。本文中的「必須／不得」是擬採用的設計約束，不表示現有程式已符合，也不豁免既有約束。

配套：[Clean Code 規範](clean-code.md) · [Terra 遷移與驗收流程](terra-playbook.md)。

## 1. 設計目標與權限

讓後續功能可以在清楚的責任邊界內開發、測試與替換；降低修改一個操作卻破壞開檔、草稿、復原、存檔的風險。採用 **單一產品、模組化單體、ports/adapters、依功能拆分 UI**，不是建立一套新的 framework。

上游 Product Constitution、Accepted semantic/storage/authorization authority，以及 Sheet [SPEC](../SPEC.md)、[DELIVERY](../DELIVERY.md)、live #1／#2／active Issue/PR 優先於本提案。本文不增加產品功能、不變更格式、不改 SCD 角色，也不把任何 child 自動提升為 Ready。

**業務語意的核心已經在 `tachiko-work` Rust runtime。不要為了湊 Clean Architecture 的 Entities 圈，在 TypeScript 再建立一套 authoritative Workbook、FormulaEngine、ValidationEngine 或 DocumentRepository。** Sheet 內層處理的是使用者操作流程與它所知道的狀態，不是重新定義表格的意義。

PR #28 的 J5 容量／既有資料相容性 P2-B 仍須由原權責處理；本文不選擇文字長度上限、截斷、附件省略、PNG 容量政策，也不解除 HOLD。未完成的真實 IME、assistive-tech、macOS 與獨立視覺驗收仍未完成。

## 2. 已檢查的基線與具體問題

原始碼檢查基線：`55d39da45f1a57825d5e1db6ef42a7b4481f3630`。另外讀取 live #1、#2、#374 及 PR #28 metadata／changed paths；PR #28 的候選是 `8121fc30a0039994f7281c235ba6fb4357529827`，不是本文已完整審查或合併的基線。執行前必須重新校準 live HEAD。

| 現有位置 | 觀察 | 設計處置 |
| --- | --- | --- |
| `src/App.tsx` | React hooks、復原政策、檔案載入、存檔與 DOM download 同處；直接依賴 session 的具體 error class | 純政策與 workflows 進 application；host effects 進 adapter；App 保留組合與畫面連接 |
| `src/ui/SheetShell.tsx` | Grid、Brief、summary、interop、dialogs、focus/editor state 集中；直接 import core-kit type | 依功能拆 component／互動邏輯；只接收 Sheet view model 與操作入口 |
| `src/contracts.ts` | 混合 kit 型別、runtime port、host record、UI props；runtime 介面包含 `FileList` | 按擁有者拆契約；application 不依賴瀏覽器或 kit |
| `src/runtime/session.ts` | 已有 resident client、串行 queue、epoch、witness、回覆一致性與 unknown outcome 保護 | 保留這些機制，封裝為 runtime adapter；不是整套重寫 |
| `src/host/local-copies.ts` | 已有 create-only、跨兩 store 同名檢查、strict transaction completion、bytes copy、legacy kind 相容 | 保留儲存行為及 schema，移動責任不等於遷移資料 |
| `src/App.test.ts` | 純復原判斷的測試必須 import TSX App | 可先抽出純政策，證明不用 React 也能驗證相同結果 |

這些是可維護性與邊界風險，不等於已證明資料損毀。檔案大小、測試數與資料夾名稱本身都不是品質判決。

## 3. 責任分配

| 擁有者 | 擁有的事實／政策 | 不得接管 |
| --- | --- | --- |
| Tachiko Work Rust runtime | 正式語意資料、stable identity、計算、validation、revision、原子 publication、proposal／approval | UI focus、IndexedDB、OS dialog |
| Sheet application | 操作 admission、工作流程、draft／pending／recovery 的協調、何時有足夠證據顯示 current／saved | 公式、語意 validation、重新編造 revision／approval |
| Sheet UI | rendering、accessibility、selection、focus、viewport、編輯器草稿輸入與 contextual controls | 開檔 admission、正式資料修改、寫檔成功的裁決 |
| Runtime adapter | 公開 kit 的載入／呼叫／回覆轉換、resident lifecycle、serialized dispatch、stale reply 防護 | 另一套計算或隱藏的重試政策 |
| Host adapters | 選定檔案與 bytes、IndexedDB／native persistence、download、lifecycle／dialogs、合法持有的 capability | 偽造 semantic success、擴大 renderer 權限 |
| Composition root | 建立實例、連接依賴、選擇已支援 host、管理整體 disposal | 放回所有產品流程 |

**Disposable projection 不等於可以丟棄使用者的工作。** 顯示 cache 可重建；尚未送出的草稿須依既有生命週期保護。使用者 authored notes／report settings 若已有獲准的持久化契約，必須保留；不能因其屬於「presentation」就刪掉。Host-private attachment 仍不是 core canonical schema。

## 4. 目標目錄與依賴方向

以下是逐步抵達的責任地圖，**不是要求先建立所有空目錄、class 或 packages**。只有承接當前工作時才建立模組。

```text
src/
  app/                         # composition root，Web／Desktop 接線
  application/
    model/                     # 純資料、workflow outcomes、witness、read models
    ports/                     # application 所需要的外部能力契約
    policies/                  # 純判斷／狀態轉移
    workflows/                 # open、edit、save-copy、recovery、interop、summary
    api.ts                     # 給 UI 的精簡入口，不是全專案 barrel
  adapters/
    runtime/                   # 唯一 production core-kit 接觸區
    host/
      web/                     # IndexedDB、FileList 正規化、download、fixture load
      # macOS adapter 由 #7 在 Ready 後加入，不預建假實作
  ui/
    workbook/                  # shell、toolbar、save/open/close dialogs
    grid/                      # grid、selection、editing、keyboard／IME
    summary/                   # current core result 的呈現
    report/                    # J5 完成正常整合後依其獲准契約整理
    interop/                   # import／cleanup preview／export consent
    shared/                    # 真正共用的小型 UI primitives／tokens
  acceptance/                  # 既有 acceptance-only wiring；不得流入正式 build
```

靜態 import 方向（包含 `import type`）如下：

| 模組 | 可依賴 | 不可依賴 |
| --- | --- | --- |
| `application/model`、`policies` | 內層純型別／純政策、標準 ECMAScript 能力 | React、DOM、host、kit、adapters、UI |
| `application/ports` | application model | kit 型別、File／FileList／IDB／Tauri |
| `application/workflows` | model、policies、ports | React、UI、具體 adapters |
| `ui` | application public API／read models、UI 自己的模組 | adapters、public/core-kit、直接 persistence |
| `adapters/runtime` | application 契約、完整且合格的 public kit | UI、直接 host persistence |
| `adapters/host` | application 契約、對應 host API | UI、私有 core ABI、公式邏輯 |
| `app` | application、UI、adapters | 不限制必要接線，但不得承擔產品流程 |

外層實作內層定義的 port。**執行時呼叫會走到 adapter，不表示 application 原始碼要 import adapter。** 依賴注入使用一般參數或小型 factory 即可，不引入 DI container、service locator、全域 event bus。

## 5. 契約設計

### 5.1 用實際 use case 定義 port

先從現有 `SheetRuntime`／`LocalCopies` 找出操作真正需要的最小介面。不同 workflows 可用具名 narrow interface 或 `Pick` 取得需求子集；不要要求 read-only summary 取得 Save／Close／Execute 權限。多個窄介面可以由**同一個 runtime adapter 實例**實作，不是多開 resident runtime。

`CoreKit`／`KitLoader`／vendor error 類別留在 adapter。application 對外回傳 Sheet 自己定義的結果；UI 不再 `instanceof` 具體 session error。Adapter 必須保留原有 error code、dispatch phase、已知 publication／unknown 的差別，不能改成猜 error message。

瀏覽器 `File`／`FileList` 在 host 邊界轉成選定來源的 data-only input。`ArrayBuffer` 可作 opaque bytes；保留相對來源名稱與 source provenance，不代表授權任意 filesystem path。UI 的 DOM 檔案選擇事件先交給被注入的 host 邊界入口，不把 DOM type 傳入 application。

Kit DTO 經 adapter 映射為目前功能需要的唯讀 read model。只保留原始語意資訊、opaque identity、revision 與必要 diagnostics；不複製整套 kit type tree、不建立可獨立修改／儲存的 JS document。SDK 仍為 experimental，Sheet 的內部 port 也不是新的 public stable API。

### 5.2 不以 boolean 偽裝多種結果

現行 App 的部分 `Promise<boolean>` 在「publication 已發生但 projection 失敗」或「結果未知」時故意回 `true`，避免 UI 提供一般重試。保護理由正確；未來應讓型別表達理由，不能機械改成 `false`。

下面只是 **Sheet-local 結果形狀示意**，不是已實作或新的 upstream ABI；實際欄位須在 bounded lane 中對應已存在的證據：

```ts
type Witness = Readonly<{ occurrence: string; revision: string }>;
type EditOutcome =
  | { kind: "blocked"; reason: string }        // 尚未 dispatch
  | { kind: "rejected"; code: string }        // trusted runtime 證明未發布
  | { kind: "published"; witness: Witness;
      observation: "current" | "unconfirmed" }
  | { kind: "unknown"; recoveryContext: string }; // 不假稱有可信新 revision
```

上例的 recoveryContext 是本地 opaque handle，不是使用者文字或權限；不得以它當 approval。Production outcome 應使用封閉 code vocabulary，訊息由 UI 對映。不要把所有錯誤硬塞進同一 outcome：Open 必須保留 `opened` 與 `unknown`；Refresh 失敗不是之前 edit 沒有發布；晚到的回覆被丟棄也不證明 runtime 拒絕。

對 unknown 的處置是依既有 recovery contract 重新觀察，**不是重送 mutation**。query 可依既有有限重讀策略處理；不能把 query retry 與 command replay 混為一談。

## 6. 狀態、生命週期與資料安全

### 6.1 狀態有單一擁有者，但不同事實不能混成一個旗標

Application 維持一份可觀察的 workflow snapshot，更新走明確 transition；UI 訂閱它，而不是同時維護彼此同步的 authoritative `useState`／`useRef` 副本。Selection、focus、viewport 可以留在 UI。不要把現有 App 原封不動搬成一個巨大的 hook 或 controller。

以下維度彼此不同，應分別建模，再由 pure selectors 推導 controls 與 labels：

- resident lifecycle／occurrence；是否正在 replacement 或 recovery；
- operation outcome：未送出、trusted rejection、已發布、未知；
- observation：某個 witness／query 的 projection 是否 current；
- pending draft／draft generation；
- host persistence receipt 與其 snapshot identity；
- source／report attachment 的 binding 與 provenance。

不可把 `busy`、`dirty`、`saved`、`current` 當四個可任意組合的 boolean；也不必建立包含所有 UI 互動的巨型狀態機。Pure policies 應清楚指出哪些組合可成立。

### 6.2 不可破壞的不變條件

| ID | 必須保留的行為 |
| --- | --- |
| INV-01 | 一個 interactive occurrence 只有一個 authoritative Rust runtime；JS 不計算正式 formula／validation／group total |
| INV-02 | revision 視為 opaque；witness 必須同時包含 occurrence 與 revision，座標／顯示名稱不是 stable semantic identity |
| INV-03 | Close／replacement 後的 reply 不得使舊資料再次 current；adapter 必須在相關 await 後檢查生命週期 |
| INV-04 | 已發布但未取得 coherent projection，與結果未知都不得宣告 current／saved，也不得 blind replay |
| INV-05 | Save receipt 只證明指定 host 上指定 snapshot 的寫入；較舊 receipt 不得把較新的工作或草稿標成已儲存 |
| INV-06 | 開檔／import admission 失敗不得破壞既有有效工作；unknown Open 與已知 Open 後的 observation failure 不得互相錯標 |
| INV-07 | source bytes、loss／unsupported ledger、獲准附件不能因 extraction 遺失；typed summary definition 不得因選錯 canonical／opaque export 路徑遺失 |
| INV-08 | private transfer／host record 不冒充公開檔案格式；create-only 不變成 overwrite；legacy record admission 不因搬檔案而變更 |
| INV-09 | 延遲的 commit 回覆不能清掉之後建立的新 draft；用 occurrence、target 與本地 edit generation 識別實際被確認的草稿 |
| INV-10 | synthetic IME／DOM snapshot 不冒充真實 IME／accessibility／macOS 證據；release build 不包含 acceptance-only hooks |

INV-09 的具體事件順序須由特定 lane 的 characterization／acceptance 確認；若發現目前行為有缺陷，另列 repair，不得假裝成無行為變更的搬移。

### 6.3 分開三種效果

`semantic publication`、`durable Save`、`external delivery` 不是同一個 success。

編輯：UI draft → application admission → runtime adapter → Rust publication → coherent projection → UI。不能依輸入值自行補出 authoritative formula result。

存副本：capture witness → core export → host 以既有原子契約寫入 snapshot 與獲准附件 → transaction completion receipt → application 比對 witness／pending draft → 顯示真正的儲存狀態。若 presentation 有自身已獲准的 dirty/version identity，也必須比對；本文不新增 persisted revision 欄位或改寫 J5 schema。失敗不得清 dirty 或遺失原資料。

下載：prepare actual export → 顯示 ledger／取得既有 consent → host 請求 download。瀏覽器 `anchor.click()` 只能證明已請求交付，不能證明使用者已永久存妥；不能拿它更新 durable Save receipt。

保留 runtime adapter 現有 serialization queue。Application admission 決定工作流程能否開始；adapter queue 保護 resident call ordering；這兩者職責不同。不要新增第二個會重排／重送 commands 的 queue，也不建 SCD scheduler。

## 7. 效能與 UI 設計邊界

遵循 [#19](https://github.com/nurockplayer/tachiko-sheet/issues/19)：完整 semantic state 不等於完整 DOM／JS materialization。讓 grid 的 viewport／overscan 與 projection request 分離；cache 依 occurrence、revision、query／definition 等必要 identity 管理。新 revision 不應依 array index 沿用舊值；失效範圍以實際契約為準，不隨意把 sibling summary 全部作廢。

不得用「不在畫面」決定公式是否需要計算。Runtime selective API 尚未提供的能力，沿 upstream owner 補足，不自行在前端建立 workbook mirror。Virtualization、prefetch、downsampling 的實際策略與 budgets 仍由 #19 的證據決定；本文不選新 library、不編造 Excel-scale benchmark。

UI feature boundary 必須保留 keyboard navigation、CJK composition、focus restoration、穩定選取 identity 與 [UI quality contract](../design/ui-quality-contract.md)。Theme／design tokens 不應與 workflow policy 綁在一起。既有 summary 名稱中的 J4 是 journey evidence，不應繼續成為所有新產品 API 的主要命名。

## 8. 安全與可替換性

只透過完整合格 public kit，禁止 sibling repo source、raw WASM ABI 或修改 vendored artifact。資料 validation 應分層：host 檢查 host record／bytes envelope；adapter 檢查回覆結構與 witness；語意 admission／validation 交由 Rust；UI 僅提供非權威輸入提示。

不同 host 實作相同 port 時，必須保留 port 承諾的效果與失敗分類。沒有相同能力就明確回報 unavailable／capability difference，不以空函式假裝成功。Native filesystem／Tauri 與 credential 權限留在 host，renderer 不取得任意 path／network authority；AI 仍 optional 且不能走捷徑修改資料或執行 host effects。

禁止在這次架構整理順便加入 autosave、in-place overwrite、collaboration、new undo stack、provider 呼叫、telemetry、remote fonts、plugin framework 或 repo 合併。可替換邊界不等於現在就實作所有替代方案。

## 9. 為何採用這個設計

依賴反轉的目的，是讓「何時算存好／如何從未知結果復原」不被 React、IndexedDB 或 kit 的實作細節綁住；不是增加轉呼叫層數。原則取自 Clean Architecture 的 Dependency Rule，實作採適合 TypeScript 的函式、data types 與小型 port。

不採全專案 rewrite：目前已有重要安全行為，先以 characterization 保護，再沿 feature seam 漸進抽取。不強制每個函式一個 class，不要求純函式包裝所有局部變數，不為未來 Office 套件做抽象。維護成本應以改一個能力要理解多少責任、能否隔離測試，以及是否減少回歸來評估。

## 10. 來源與後續閱讀

方法來源只支持原則；本文目錄、outcome 形狀與遷移方案是 Sheet-specific 設計，不宣稱為書中原文。

- [Clean Architecture / Dependency Rule](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [React: Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure)
- [Fowler: preparatory refactoring](https://martinfowler.com/articles/preparatory-refactoring-example.html)
- [Tachiko Work Product Constitution](https://github.com/nurockplayer/tachiko-work/blob/main/docs/vision/product-constitution.md)
- [Upstream frontend/backend boundary](https://github.com/nurockplayer/tachiko-work/blob/main/docs/architecture/frontend-backend-boundary.md)
- [Sheet authority routing](../UPSTREAM.md) 與 [SCD delivery policy](../DELIVERY.md)
- [Inspected App](https://github.com/nurockplayer/tachiko-sheet/blob/55d39da45f1a57825d5e1db6ef42a7b4481f3630/src/App.tsx)、[contracts](https://github.com/nurockplayer/tachiko-sheet/blob/55d39da45f1a57825d5e1db6ef42a7b4481f3630/src/contracts.ts)、[runtime session](https://github.com/nurockplayer/tachiko-sheet/blob/55d39da45f1a57825d5e1db6ef42a7b4481f3630/src/runtime/session.ts)、[local copies](https://github.com/nurockplayer/tachiko-sheet/blob/55d39da45f1a57825d5e1db6ef42a7b4481f3630/src/host/local-copies.ts)、[SheetShell](https://github.com/nurockplayer/tachiko-sheet/blob/55d39da45f1a57825d5e1db6ef42a7b4481f3630/src/ui/SheetShell.tsx)

本次僅做 repository source／authority inspection 與文件撰寫；沒有執行產品測試、actual Astra consultation 或 independent final review。
