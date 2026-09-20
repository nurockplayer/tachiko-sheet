# Terra — 架構遷移與驗收流程

狀態：與 [架構設計](README.md) 同為 Proposed；追蹤 [#33](https://github.com/nurockplayer/tachiko-sheet/issues/33)。本文提供 adoption 與 implementation preparation，不是 blanket Ready、actual Oracle consultation 或 final review。

## 1. 先確認現在允許做什麼

既有 [DELIVERY](../DELIVERY.md)、live #1、#2、active Issue/PR 與 [UPSTREAM](../UPSTREAM.md) 維持權威。Oracle consultation/review 使用 DELIVERY 所引用的 qualified `tachiko-conductor#79` contract；本文不複製一份可獨立修改的 SCD 政策。

Terra 仍是唯一 delivery owner；新 discretionary choice 必須先取得 actual Oracle read-only disposition。架構文件已描述的方向，不等於作者代替 Oracle 做過 consultation；後續新的資料型別、拆分取捨、gate tool、行為／相容性決策也不能推定已被批准。已獲准的機械執行不需要每行／每 commit 重新問。

原始提案由 ChatGPT 撰寫；先前 actual Astra consultation 已在 [#33 comment 5667955026](https://github.com/nurockplayer/tachiko-sheet/issues/33#issuecomment-5667955026) 記錄為 `revise`，並作為歷史證據保留。現行工程路由不再要求 Astra/Sol；穩定 Final Candidate 由未參與 solution direction 的 fresh independent Oracle session 進行 exact-HEAD final review。文件作者、Oracle consultant、設計／實作／acceptance／evidence 的參與者不能取得同一 material head 的 independent-final-review credit。

目前 inspection baseline 上，PR #28 正在修改 App、contracts、local-copies、SheetShell 等共享位置。**不要和它同時做這些檔案的架構重構。** 不碰使用者 root checkout 的 untracked files，不接管 active worktree，不重寫 #2 來宣告 takeover。新 docs lane 與將來 source lane 分開。

J5 P2-B、真實 IME／assistive-tech／macOS／independent visual 證據不因本文件而解除。需要原權責決策的項目仍回原 owner；有真正獨立且合格的工作才繼續。

## 2. 採用順序：先保護，再抽取

每一階段是一個可獨立審查的 coherent boundary，不是一串為了好看的微型 PR。實際 child 規格、Ready、ownership、acceptance adequacy 與 consultation 必須先依 live policy 合格；以下順序不是對目前源碼的立即 dispatch。

| 階段 | 有限工作 | 完成證據 | 不在範圍 |
| --- | --- | --- | --- |
| A：文件採用 | 審查 #33 三份文件與 AGENTS 入口，解決設計 finding，走正常 reviewed PR | 清楚的 status／authority、source mapping、依賴規則、遷移 acceptance；精確 diff 與獨立審查 | 不改 src、tests、kit、lock、CI，不宣稱產品符合新架構 |
| B：第一個可測 seam | 在不與 active writer 重疊時，為目前復原 helpers 補／確認 characterization；抽出 plain-TS policies 與必要 outcome contracts；建立最小 architecture checks 與正確 test discovery | 原 App.test outcomes 保留；純政策不用 React／DOM；新違規 checker negative cases 會失敗；測試確實被 runner 收集 | 不重寫全部 App、不改 Open／Save UX、不遷移 storage schema |
| C：一條完整 workflow | 依 live queue 選一條已獲准的 open／recovery 或 save-copy 流程；用 application port 連到原有安全 adapter，再讓 App 訂閱結果 | happy path、rejection、unknown、late reply、draft／receipt 全部守住；同一 real runtime／host journey 通過 | 不在一次 PR 抽完所有 workflows；不把 bug repair 隱藏在搬移 |
| D：逐功能整理 | 後續沿 interop、summary、workbook／grid 的實際需求拆 UI 與 workflows，收斂 legacy contracts／direct imports | 每個新增 feature 在正確層；跨功能回歸、focus／IME、provenance 保留；legacy edge inventory 減少 | 不設全功能完成前必須重構完的總停工令 |
| E：平台／效能擴充 | #7 合格後加入 macOS host adapter；#19 合格後加入 viewport／selective projection 工作 | 真實 host／workload 證據、正確語意與能力宣告 | 不以架構 doc 取代 #7／#19 acceptance，不搶 upstream core 工作 |

B 與 C 的來源檔案可能和 live J5 重疊；必須在其合法 closeout／ownership transfer 後重新定 baseline，或另選真正獨立 seam。不能只因 timestamp 很舊就認定 writer 消失。

需要修正既有 bug 時，先指出不變條件／reproduction 與 acceptance owner；必要時分開 repair 與 extraction，讓 reviewer 看得出行為差異。重大 user-visible／compatibility 取捨交回 Steward，不以「只是 clean code」繞過。

## 3. 現有程式如何搬，不只是改名字

| 舊責任 | 目標 | 保留方式 |
| --- | --- | --- |
| App 中 `openRecoveryRestoreDecision`、`recoveryDraftAfterBoundary` 等 | `application/policies` 與純測試 | 原 outcome／guard 不變；移除測試對 TSX 的依賴 |
| App 多種 workflow state／mirrored refs | 每條 workflow 的 plain-TS owner＋pure transition／selector | 先列 facts／合法轉移，逐條替換；不是換成另一個巨大 hook |
| App 中 DOM download／fixture fetch | `adapters/host/web`，由 composition 注入 | 保留 consent、source bytes、URL cleanup；download request 不變 durable receipt |
| `SheetRuntime`／`LocalCopies` 的使用端契約 | `application/ports`／model | 按 consumer 縮小介面；先有必要契約，再轉換 boundary；不任意新增 stable public API |
| session 的 vendor error／projection mapping | `adapters/runtime` | 保留 known rejected／known published／unknown／stale 分類與一個 serialization owner |
| `local-copies` IndexedDB 機制 | `adapters/host/web` | DB identity、stores、version、strict transaction、legacy format、create-only／byte-copy 不變 |
| SheetShell 的 feature UI | `ui/grid`、`ui/workbook`、`ui/summary`、`ui/interop`；J5 在合法整合後處理 | 保留 focus、selection identity、draft lifetime、IME、disabled reason 與 product journeys |
| `main.tsx` 的實例建立／掛載 | `app` composition root | 保留 acceptance-only 隔離及清理；不把 application 流程搬回 root |

暫時維持舊 import facade 可以降低每個 PR 的風險，但要留下精確的 migration debt，不新增依賴。結案時移除該 slice 已不需要的 facade。不能僅把檔案搬到新目錄，卻讓原依賴圈完整留下。

## 4. 將架構變成可執行規則

下面是 **待實作的 gate specification**，不是目前已存在或本次已跑過的指令。

### ARCH-01：依賴圖與循環依賴

建議 entry name：`pnpm check:architecture`，實際工具／版本選擇仍需對應 live decision。Checker 必須解析 resolved imports，不只 grep 檔案字串；遵循專案的 `.js` specifier → TS resolution、relative paths、alias、re-export 與 type-only imports。檢查靜態及可解析的 dynamic import；新不透明 dynamic loading 需具名例外，不能成為繞過邊界的方法。

至少拒絕：application → UI／React／adapter／public-kit；UI → adapter／public-kit；adapter → UI；production dependency cycle；production import acceptance-only module（既有受 build mode 隔離的入口須精確處理，不能一刀刪掉測試能力）。用小型負例測試 checker：相對 import、alias、type-only、re-export、dynamic literal 和 cycle 都應被抓到。

### ARCH-02：內層不靠 host globals

對 application 的 typecheck／lint 應排除 DOM／Node ambient globals，並檢查 `window`、`document`、`File`／`FileList`、`indexedDB`、`fetch`、`Worker`、`localStorage`、Tauri／Node I/O 等不可出現在內層。保留正常 ECMAScript types／opaque bytes。Clock／ID 等副作用只有真的需要時才由 port 提供；不得引入新的 semantic revision generator。

不要只靠 `lib` 選項卻仍透過全域 type packages 把 host globals 引入；以負例證明配置有效。Typecheck 本身不取代語意／state review。

### ARCH-03：漸進消除，不默認全體合格

現有 direct kit imports／混層依賴在第一次 inventory 中逐一記錄 importer、resolved target、原因、owner Issue 與 removal checkpoint。允許 grandfather 的只是**具體既有 edge**；新檔案、新 edge、新 cycle 不可沿用整包豁免。

未知 baseline 檔案／edge 應使檢查失敗；已不再存在的豁免要刪除。禁止根目錄 wildcard、全域 lint-disable、加新 dependency 後自動重算 baseline、將例外視為永久政策。Adopted boundary 的新違規阻擋當前 lane；舊 debt 不等於每個無關功能都必須停工重寫。

### ARCH-04：測試真的有被收集

目前 `package.json` 的 `test:unit` 明確列出 `src/runtime`、`src/ui`、`src/App.test.ts`、`tests/product`，另跑 host 的 Node tests。**新增 `src/application`／`src/adapters` 並不會自動證明新測試有跑到。** 修改路徑時同步更新 runner/filter，確認執行輸出確實包含新測試，以及舊 runtime／host／product tests 沒有消失。

Architecture checker 本身也要被正式 test／CI entry 收集。單獨執行一個新測試通過，不能代替 CI discovery 的證據。

### ARCH-05：正式產物與原始 artifact 邊界

保留 core-kit checksum／provenance qualification、production `check-dist` test-hook exclusion，以及 real product build。Acceptance build 與 production build 的檢查分開；正式 bundle 不能因 refactor import chain 帶入測試 helper、secret 或 debug control。

CI 的架構 gate 只在 checker 與 negative cases 被審查後加入；本次 docs PR 不改 workflow。不要為了 docs-only diff 無限制重跑產品／平台測試，也不能把 docs CI 的成功當新架構已合格。

## 5. 必須證明的行為情境

下面是後續 migration lane 的**擬議 verification scenarios**，尚不是 executable tests、Steward-authored acceptance 或 Ready 證據。每個實際 slice 都必須先映射既有 live Steward acceptance／accepted outcomes，並由獨立角色評估 adequacy；implementation 作者自行補 unit test 不能冒充獨立 acceptance。若既有 acceptance 缺漏，或需實質更改任何 outcome，必須回 Steward。現有 hashes／oracles 不被這份表取代。

| ID | 情境 | 必須觀察到的結果 | 證據層 |
| --- | --- | --- | --- |
| AT-01 | 合法 cell edit 與公式相依更新 | 正式結果來自 actual core；沒有 JS evaluator；不改 canary 的意義 | real kit＋browser journey |
| AT-02 | runtime 明確拒絕 edit | 正式資料不變、draft 依既有流程保留，可見診斷不偽裝 success | workflow＋real integration |
| AT-03 | 已知 publication 後 projection 失敗 | 顯示需復原／未確認；不得提供一般 semantic replay；不宣告 current／saved | fault injection＋product recovery |
| AT-04 | dispatched mutation 回覆遺失／unknown | 不假稱未發布、不自動重送；保留可用 recovery context，依 contract reobserve | scripted port＋actual adapter fault boundary |
| AT-05 | 舊 occurrence／revision 的 reply 晚到 | Close／replacement 後不恢復舊 view，不接受錯誤 receipt；ordinal string 不被當 rev 大小 | lifecycle／integration |
| AT-06 | 同 revision spelling、不同 occurrence 的 Save receipt | 不把另一個工作標成已存；receipt、exported revision、draft 狀態均正確 | pure policy＋host journey |
| AT-07 | Save conflict、quota／transaction abort | 原 copy／source 不變、無 partial success、dirty 不被清除；request success 不早於 transaction completion 被當成完成 | 真實 IndexedDB boundary |
| AT-08 | canonical／opaque legacy copy 與獲准附件 round-trip | DB identity／schema 不變；summary definitions、import source／metadata／ledger 不遺失；fresh process reopen 仍成立 | host＋real kit＋browser |
| AT-09 | invalid／unsupported／unknown Open | admission failure 保留有效舊工作；已知 Open 但 observation failure 不錯標成 unknown Open；依既有 contract recovery | workflow＋product |
| AT-10 | IME composition Enter、Escape、Tab、focus restoration | 不提前 commit，cancel／commit 與 focus／selection 符合既有 acceptance | browser＋另列真實 IME evidence |
| AT-11 | 舊 commit 回覆遇到新 draft／view switch | 不清掉不屬於它的草稿；僅測既有允許的互動或純政策事件，不趁機開放新並行 UX | policy＋UI regression |
| AT-12 | export 尚未 consent／prepared result 已過期 | 不做未授權 delivery，不把 requestDownload 當 Save success；失效範圍符合原契約 | workflow＋host boundary |
| AT-13 | acceptance-only module 與 production build | 測試入口仍可用，但正式 bundle 無 hook；core kit byte／provenance 不被改寫 | build＋artifact checks |
| AT-14 | summary／report binding 與 sibling refresh | result 只配對正確 occurrence／revision／definition；局部失敗不憑空清掉無關 current sibling；J5 依最終獲准 acceptance，不解除 P2-B | owning J4／J5 integration |

當 refactor 沒有觸及某 boundary，可依 live policy 識別其不適用理由；不能把表內所有平台證據都自動宣告通過，也不能要求每個 CSS 搬移重做不相干硬體驗收。新失敗或未決 finding 保持可見。

## 6. 測試分工與現有命令

Pure tests 驗證 state transition、receipt admission、stale／draft identity；fake port 僅提供明確已知的結果，不證明 core 計算正確。Adapter tests 使用 intact qualified kit，驗證 public boundary、ordering、lifecycle／error translation。Host tests 驗證實際 transaction 與 source preservation；UI tests 驗證操作／focus／IME；product journeys 串起使用者結果。

以下命令在 inspected main 已存在，**列出不代表本次已執行**：

```sh
pnpm typecheck
pnpm test:unit
pnpm verify:core-kit
pnpm qualification:core-kit
pnpm qualification:j3-public-composition
pnpm qualification:j4-public-composition
pnpm build
pnpm build:acceptance
pnpm acceptance:product
```

依實際 slice 選 applicable checks，檢查 fixture／artifact prerequisites 及 runner 確實跑哪個 boundary。Setup failure 不是 behavioral RED；`pnpm build:acceptance` 成功不是實際 browser PASS；unit tests 不能代替真實 macOS 或獨立產品驗收。將來新增 scripts 時同步更新本節，避免文件指向不存在的命令。

遵循現有 inner loop → repair-batch checkpoint → Final Candidate；WIP 跑 focused checks，穩定 candidate 才跑完整 applicable hosted gates 和 fresh independent review。新 material commit 使相關 exact-head 證據失效；不得重複套用舊 PASS。

## 7. 每條 Issue／PR 最少留下的資訊

在既有 owning Issue／PR handoff 補以下內容，不創建第二個可編輯的任務中樞或新的 machine schema：

```text
Requirement / journey:
Exact base / candidate HEAD / qualified kit:
Changed responsibility and dependency edges:
State owner / effects / invariants (INV-xx, AT-xx):
Allowed files / shared-file owner / excluded behavior:
Actual Oracle decision link and remaining choices:
Steward acceptance + independent adequacy evidence:
Actual commands, environment and results / NOT RUN:
Compatibility and rollback / remaining migration debt:
Unresolved findings and exact next action:
```

Reviewer 必須能回答：UI 不依賴哪個細節了？哪條規則現在可以不用 React 測？source bytes／receipt／unknown 是否仍忠實？有沒有順便改產品行為？新增 tests 是否真的跑過？分層帶來的價值不是僅僅檔案數增加。

最終結果區分：docs adopted、slice migrated、boundary gate enforced、product verified。這四件事不是同一個完成狀態。

## 8. Rollback 與停止條件

預設 architecture extraction 不改 persisted schema／core pin，rollback 是還原 bounded code commit，不能回滾使用者資料、刪 database 或 rewrite history。若為維持相容必須做 schema／public contract 變更，停止把它當 refactor，回到原 owner 的 migration／compatibility 流程。

碰到同一 defect family 反覆修兩輪仍未收斂，沿 DELIVERY 做 root-cause checkpoint；不要用更多 wrapper 或重試掩蓋問題。發現 authority gap／新產品限制／未解 Oracle disposition 時暫停受影響 mutation；不是中止所有獨立合格工作。

本文不新增 heartbeat、cron、worker router、command bus 或 SCD engine，也不把 Sheet 重構移交給 tachiko-conductor 以外的新排程器。

## 9. 可給 Terra 的短 prompt

```text
在 nurockplayer/tachiko-sheet 讀 live #1/#2、#33、AGENTS、DELIVERY，
以及 docs/architecture/ 三份文件。先處理 #33 文件提案的審查與採用；
不要把 draft 視為已生效規則或立即重構授權。保留 active writer、J5 HOLD、
上游語意／格式與所有驗收。新取捨先取得 actual Oracle consultation。
採用後只挑一條 genuinely Ready、non-overlapping migration slice，
由 worker-router 執行有界實作／測試 package，Terra 保留 integration ownership；
先確認 characterization／test discovery，再做行為保持的 bounded extraction；
穩定 Final Candidate 才取得適用 exact-head gates 與 fresh independent Oracle review。
只回報實際執行的結果，詳細證據留 owning Issue/PR，不重寫 #2 的任務所有權。
```

Terra High/Medium 依 live #2 與 task complexity 選擇；Oracle consultation 與 final review 必須由彼此具備獨立性的 session 執行，且 Oracle 全程 read-only。實際 worker-router/model mapping 與 effort 依當時安裝設定，不藉此文件替換；merge 仍由 Terra/Conductor 在 exact-head gates 通過後執行。
