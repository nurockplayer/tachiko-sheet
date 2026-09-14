# Tachiko Sheet — Clean Code 規範

狀態與採用條件同 [架構設計](README.md)；追蹤 [#33](https://github.com/nurockplayer/tachiko-sheet/issues/33)。這是對 Sheet 的具體設計要求，不是對書籍逐字照抄，也不代表本次已加上 lint 或完成重構。

## 1. 品質的判準

一段程式應讓下一位人類或 agent 能說清楚：它解決哪個使用者問題、依賴哪些事實、誰擁有狀態、何時有副作用、失敗後留下什麼。測試全綠不自動代表設計清楚；「看起來短」也不表示資料安全。

優先順序：正確性與使用者資料 → 清楚的責任／依賴 → 可驗證的行為 → 可讀性 → 經量測的最佳化。不能拿 clean-code 美感刪掉 recovery、compatibility 或 authorization guard。

## 2. SOLID 在本專案的落點

| 原則 | Sheet 的具體要求 | 不需要做的事 |
| --- | --- | --- |
| Single Responsibility | workflow 決定何時可存；host adapter 決定如何完成寫入；UI 決定如何顯示 | 不是每個函式只能一行，也不是一個檔案只能一個 export |
| Open/Closed | 增加已授權的 host 能力時，替換 port 的實作，維持既有 workflow 行為 | 不先建立所有未來平台、插件與策略物件 |
| Liskov Substitution | adapter 不可把「write requested」冒充「durable write completed」；不支援的能力明確表示 | 不把 Web 與 macOS 不同能力假裝成完全相同 |
| Interface Segregation | summary read workflow 不必依賴 save／close；view-only UI 不必拿整個 App controller | 不必為每個純函式造 interface |
| Dependency Inversion | application 定義需要的 port；kit／IndexedDB／Tauri 實作在外層 | 不引入 service locator 或 DI framework |

SOLID 不要求大量 class／繼承。TypeScript 的 plain object、函式與 factory 足以承擔多數邊界；只有具體生命週期／封裝需求才選 class。

## 3. 可在 review 指認的規則

### CC-01：名稱表達事實，不混淆不同效果

使用 `publishEdit`、`saveCopy`、`requestDownload`、`reobserveWork` 等說明效果的名稱；不要用 `processData`、`handleStuff`、`Manager` 隱藏責任。純 predicate 可用 `is...`／`can...`；有副作用的函式不能偽裝成查詢。

`revision` 不叫 `versionNumber`，因為它是 opaque。`rowIndex`／座標不叫 entity identity。`saved` 不代表已渲染，`downloaded` 不代表 anchor 已 click。Journey 代號 J4／J5 留在 acceptance／evidence；新產品模組以 cross-table-summary／report 等使用者概念命名，舊名稱不需為了整齊一次全改。

涉及單位時名稱寫清楚，例如 `timeoutMs`、`byteLength`、`cssWidthPx`。文字容量的計量單位與產品上限須有 authority；不能在這裡決定 J5 的限制。

### CC-02：函式只有一個可描述的目的、同一個抽象層次

`saveCopy` 可以協調 capture／write／receipt acceptance，但不應同時建立 DOM anchor、解析 source format、計算 summary 或排列 toolbar。低階 mapping 放在相應 adapter；可測的 receipt 判斷放在 pure policy。

優先 guard clause、明確分支與具名中間結果。不要為縮行把多個效果塞進一行、巢狀 ternary 或複雜 boolean。重複出現的是同一條規則才抽取；只是語法相似不必建共用抽象。

不設「每個函式最多 20 行／每檔最多 200 行」硬限制。函式長度、branch count、fan-out 與 props 數是審查訊號；新增不相干責任、必須理解整個 App 才能改一個功能，才是要提出的具體問題。

### CC-03：用型別限制錯誤組合

拒絕 `save(true, false, true)` 一類 mode flags；使用具名 input object 或 discriminated union。不要用 `Promise<boolean>` 同時表達 rejection、publication、unknown、UI close decision。

資料模型預設唯讀；opaque identity 不做數學、排序或從字串推論其 meaning。原始輸入先是 `unknown`，在邊界驗證。不得用 `any`、`as unknown as` 或 non-null assertion 壓掉尚未證明的契約；確有 SDK／跨 realm 相容需求時，將 assertion 限於小型 adapter helper，補測試並說明理由。

TypeScript `readonly` 不會深凍結 bytes 或跨 realm 值。必須保留現有必要 copy／防 alias 機制；不以型別標註取代 runtime ownership。

### CC-04：狀態轉移集中，但不要製造新 God Object

同一個 workflow fact 只有一個 owner。由 facts 推導出的 `canSave`、status label 不要另外存成需要同步的 state。為不同 session／draft 使用明確 identity，避免晚到回覆更新錯誤工作。

React `useRef` 可持有 DOM node、訂閱清理或必要的最新 callback，不應成為另一份可任意修改的正式 application state。React hooks 連接 lifecycle／subscription／UI interaction；不把整個 App 搬成千行 `useWorkbookController` 當作完成分層。

在 render 過程不執行 runtime mutation、write、download 或開新 resident client。Effect 必須有清楚 ownership 與 cleanup；避免因 mount／remount／dependency 變化重複送出同一 semantic command。

### CC-05：錯誤必須保留可行動資訊

預期產品分支使用明確 outcome／error code；unexpected exception 保留 cause，對使用者顯示安全且可理解的訊息。不能用 error message 字串決定 authorization、retry 或 publication meaning。

禁止 empty catch／catch 後回 success、將所有錯誤改成空陣列／零／null，或以 optimistic UI 宣稱公式已正確。必要 cleanup catch 若不能改變主要 outcome，須寫明原因；這不同於吞掉主操作錯誤。

`finally` 可以釋放本地 busy／資源，不能無條件將 dirty／unknown 改成 saved／current。`void promise` 必須已有明確的 rejection handler 與 lifecycle ownership。不要為每個 catch 建新的錯誤 framework。

### CC-06：註解交代為何不能簡化

值得保留的註解包括：未知結果不能 replay、為何要比對 occurrence、為何等待 transaction completion、為何保留 legacy discriminator、為何 copy source bytes、為何 published 但仍不能 current。

不要把原始碼用英文再說一次，不保留大段註解掉的 code，也不以註解掩蓋錯誤命名。長期設計原因放在架構文件或 owning Issue；TODO 必須指出具體 owner／Issue 與尚缺條件，不能成為永久略過契約的藉口。

### CC-07：共用模組要有語意，不設垃圾桶

不要把無關東西都塞進 `utils.ts`、`helpers.ts`、`types.ts`、`contracts.ts` 或單一全域 store。`witnessMatches`、`saveReceiptPolicy`、`fieldDisplay` 等有明確責任的名字較合適。

共享 UI primitive 不 import application workflow。Application model 不 import React。Feature 不深層 import 另一個 feature 的私有實作；跨功能協調在 application 或 UI composition 完成。避免大型 barrel 的隱性循環依賴與 public-kit 型別擴散。

### CC-08：防禦式程式不能變成隨意拒絕產品功能

沒有能力時提供明確 unavailable reason，不回傳空函式 success；但也不能為省事關閉整個工作簿、清掉所有 sibling results 或悄悄降低支援範圍。

新限制、defaults、容量、相容性或 recovery trade-off 仍走 live consultation／Steward authority。不能把最保守的方案直接宣稱為唯一安全設計。

### CC-09：效能優化從資料流開始

避免每個 render 重建完整 workbook 或為每格新建大型物件；必要的 projection／selector cache 以正確 identity 管理。不要在缺乏 profile 證據時到處加 memoization、worker、debounce 或 cache。

任何最佳化都必須保留觀察結果、offscreen dependencies、draft 與 accessibility。不得偷偷放寬資料精度，或為通過 benchmark 替換 real runtime 為 fake。具體 workload／budget 由 #19 與相關 acceptance 決定。

### CC-10：測試描述使用者結果與邊界，不模仿實作

測試名寫成 `does not mark newer work saved when an older receipt arrives`，而不是只寫 `works`。Arrange／Act／Assert 保持清楚；fixture 用明確不同的 occurrence、revision、draft generation 抓出誤用。

Pure workflow tests 可用 scripted fake port 注入已知 rejection／unknown／late reply，不在 fake 中重寫公式求值來證明 core 正確。Runtime／storage／interop 保證必須另以 real kit／host integration 驗證。只檢查 function 被呼叫或 source string 存在，不足以證明端到端安全。

回歸測試應能在缺陷被引入時失敗。不得為搬檔案刪除 oracle、改 source hash、改資料上限、忽略 failing test 或只更新 screenshot baseline。Acceptance 的實質變更維持 Steward ownership。

## 4. Review 的結論要可證偽

`bad taste` 不是充分的 blocking finding。Finding 應指出實際責任／依賴／行為問題、檔案位置、失敗情境、需要哪種證據，以及符合 scope 的處置方向。

例如：「UI import concrete session error，讓新增 runtime adapter 必須修改畫面；請將 outcome contract 放到 application 並由 adapter mapping，保留 unknown／published 區分」是具體問題。「這個檔案很長，請拆乾淨」不是完整驗收要求。

下列類別在適用的已採用規則下會阻擋 closeout：越過 semantic authority、未處理的資料安全 regression、receipt／stale／unknown 錯誤、新增 forbidden dependency、循環依賴、必要測試未被 runner 收集、以 suppression 隱藏違規。純命名美感或行數偏好不可自行升格成產品限制／無止境重構。

## 5. 自動化與人工判斷的界線

Architecture import graph、cycle、forbidden host globals、TypeScript diagnostics、test discovery 與 release hook exclusion 應自動化；詳見 [Terra playbook](terra-playbook.md)。這些工具**尚未由本次 docs PR 實作**。

需要人工／獨立 review 的是：一個抽象是否值得存在、錯誤分類是否忠實、單一責任是否合理、compatibility 是否保留、使用者是否仍能完成工作。不得以 lint 全綠、coverage 百分比或檔案變小取代判斷。

現有工具鏈不是本次升級對象。Formatting／lint 採 repository 一致設定；若需新工具或 TS config 政策，先對實際支援版本與影響取得符合 live policy 的決策，分批消除違規，不做無關 lockfile churn。

## 6. 參考

[Clean Code 官方出版資訊](https://www.informit.com/store/clean-code-a-handbook-of-agile-software-craftsmanship-9780132350884) 所列命名、函式、錯誤處理、測試與重構面向，是本文件的原則來源；具體 CC 規則為 Sheet-specific adaptation。[Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) 支持依賴方向；[React state structure](https://react.dev/learn/choosing-the-state-structure) 支持避免重複與矛盾 state。這些參考不取代本專案的語意及驗收 authority。
