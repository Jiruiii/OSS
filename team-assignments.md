# ResilientGeo Mesh — 團隊分工（兩人）

> 對應計畫文件：`system.md`（進度更新 2026-09-05）
> 2026-09-05 調整：原本四人分工（A Data Pipeline／B Android GIS／C Peer Sync／D Experiment Harness）裡，A 的資料源接入、B 的階段 1、D 的模擬器骨架都已做到可維護狀態（見下方「已完成部分」）。剩下的工作收斂成兩人分工。
>
> **2026-09-05 再調整（依裝置持有狀況重分）**：甲手上有 3 台 Android 實機，乙沒有裝置。分工改成純粹按「這件事需不需要真的碰一台 Android 手機」切：**需要實機（BLE 配對、傳輸、背景/鎖屏行為、耗電量測）的全部給甲；不需要實機、在自己電腦上寫程式/跑 JVM 單元測試/分析數據就能完成的全部給乙**。兩邊唯一的交接點是：乙把 Peer Sync 協定邏輯寫成 Kotlin 並用 JVM 單元測試證明邏輯正確，甲拿去接上真正的藍牙傳輸層並用實機驗證。

## 分工總覽

| 負責人 | 裝置 | 角色 | 核心任務 |
| --- | --- | --- | --- |
| **甲** | 3 台 Android 實機 | 所有需要真機驗證的工作 | 把協定接上 `BleGattTransport`、兩/三機實機測試、foreground service 背景驗證、接觸窗與耗電量測 |
| **乙** | 無裝置 | 所有不需要實機的工作 | Kotlin 版協定邏輯（JVM 單元測試）、Emergency Mode UI、simulator 校準、數據分析、文件維護 |

**依賴順序**：乙先把 Peer Sync 協定邏輯（`computeDiff`／`buildRequest` 的 Kotlin 版）寫完並用 JVM 單元測試驗證（跟現有 `EventVerifierTest` 一樣，不需要裝置或模擬器，純 JVM 就能跑），甲才能把它接上 `BleGattTransport` 開始實機測試。**這是唯一的交接點，乙這項要優先做**，避免甲的實機測試卡在等協定邏輯。

---

## 甲：實機整合與量測（需要 Android 手機的一切）

**現況（2026-09-05 更新）**：BLE GATT 傳輸層已驗證通過（`transport/BleGattTransport.kt`）。乙交付 Kotlin 版 `PeerSync`（`computeDiff`/`buildRequest`）後，甲已把協定邏輯接上真傳輸層並在 Pixel 7 + Pixel 8a 上跑通完整的 HELLO→DIFF→REQUEST→TRANSFER→VERIFY/APPLY（`transport/PeerSyncMilestoneActivity.kt`），並接上跨接觸續傳與 critical-first 排程——**3a 里程碑已達成**，細節見下方「已完成」清單。過程中在真機上抓到並修好四個真 bug（`BleGattTransport` 的 MTU 協商 race、`connect()`/`send()` 缺少序列化保護、續傳誤插 header 導致資料損毀、協定層 HELLO 早到被永久丟棄的 race），修法與根因記錄在程式碼註解裡。乙的 Emergency Mode 手動開關 UI 與正式 foreground service 骨架已交付並合併進 `main`，取代了甲原本墊的 stub。

**現在剩下待辦（2026-09-05 整理，兩人分工兩邊都清空後剩下的）**

1. **跨機型相容性測試**：把 Samsung SM-S731B（`C_BLEbroadcast.md` 記錄在手的那台）拉進來，重跑 discovery／connect／transfer，把階段 0 從「條件通過」轉正
2. **Connection success rate 跨機型重跑**：用 Samsung 補一輪；另外改用乙剛交付的正式 `EmergencyModeService` 骨架重跑一次鎖屏情境，確認跟先前兩台 Pixel 上量到的 0/19（0%）結論一致，不是甲 stub 版本才有的偶然現象
3. **Emergency Mode 背景／鎖屏驗證換版重跑**：乙的正式骨架把「App 啟動就常駐」改成「開關驅動啟停」，要重跑一次背景/鎖屏驗證確認這個生命週期改動沒有打破先前 176 秒不間斷心跳的存活結論
4. **三機 Store-Carry-Forward 驗證**：正好用 Samsung 當第三台（不用跟人借），A 不直接連到 C 時，更新仍能經 B 到達 C
5. **回填 ADR-001**：把這輪所有真機數據（接觸窗多輪、connection rate 含鎖屏、energy cost）正式寫進 `docs/adr/ADR-001-transport-layer.md` 的實測記錄段落，並回填 `pipeline/lib/bundle.mjs` 的 `targetSizeBytes` 決策

**已完成（依序，細節與數據）**

- [x] **接觸窗量測**：harness 已完成（`transport/BleGattMeasurementActivity.kt`），Pixel 7 + Pixel 8a 多輪實測：10s=36,864B（3819 B/s）、30s 兩輪=122,880B/126,976B（4105/4281 B/s）、60s=262,144B（4419 B/s，另一輪傳輸中途 GATT write 逾時失敗，真實存在的不穩定現象一併記錄）——量級穩定在 3.8–4.4 KB/s，與 ADR-001 既有 3–6 KB/s 吻合（回填 ADR-001 見上方待辦 5）
- [x] 把乙交付的 Kotlin 協定邏輯接上 `BleGattTransport`（`transport/PeerSyncMilestoneActivity.kt`），取代 spike activity 裡的隨機測試 payload
- [x] 兩機交換**一個**真的簽章 chunk，接進 `MeshRepository.ingestChunk()`（新增）→ `ChunkVerifier`（新增，chunk_hash + chunk 級 Ed25519 簽章）→ `EventVerifier`/`EventIngestor` → Room —— **3a 里程碑，2026-09-05 在 Pixel 7 ↔ Pixel 8a 上通過**，直接讀出裝置上 Room 的 `.db-wal` 檔案確認 event 真的寫入（`applyState=CURRENT`），不只是信 log。chunk fixture 由 `pipeline/tools/generate-peer-sync-chunk-fixture.mjs` 產生（真實 Ed25519 簽章，key_id `peer-sync-demo-2026`）
- [x] 接上跨接觸續傳：Node B 故意在傳送中途模擬「接觸窗關閉」中斷（真機重現在 508/1735 bytes），透過新增的 CONTROL characteristic（獨立於 DATA，避免中斷通知被誤判成前一則訊息的延續字節——真機上實測撞到這個問題）告知 Node A 中斷位置，A 帶著正確 `offset_bytes` 重新送 REQUEST，B 用 `transport.resume()` 續傳，chunk_hash 驗證通過，證明續傳後的資料位元組完全正確。過程中修好 `transfer()` 一個資料損毀 bug（見上）
- [x] **Critical-first 排程的實機驗證**（Peer 上限那半需要 3+ 裝置，見上方待辦 4）：造 3 個不同優先度的真簽章 chunk（`pipeline/tools/generate-peer-sync-priority-chunks-fixture.mjs`，CRITICAL/HIGH/LOW），連同既有的 shelter chunk 一次全部 REQUEST，Pixel 7 送出的 REQUEST 順序實測為 `shelter(CRITICAL,1147B) → flood(CRITICAL,1148B) → road(HIGH,1163B) → medical(LOW,1165B)`——跨優先度排序正確，**同優先度內按 size 的 tie-break 也正確**。過程中修好一個真的協定 race：**B 只送一次 HELLO、不會重試，如果 HELLO 在 A 選定角色之前就抵達會被永久丟棄、卡死整個交握**（`PeerSyncMilestoneActivity.pendingRemoteSummaryJson` 機制修正）。另外發現一個**未修的深層限制**：把「跨接觸續傳」跟「critical-first」疊在同一次 REQUEST 裡測時（4 個 chunk 一次請求，其中一個故意中斷），A 在同時處理「中斷通知＋送 resume REQUEST」與「B 連續傳送後續 chunk」時收到過一次解析失敗的雜訊 payload，後續兩個 chunk ack 逾時——`BleGattTransport` 目前「一次只處理一則邏輯訊息」的假設在這種疊加情境下站不住腳，需要真正的訊息序號機制才能根治，超出本次驗證範圍，記錄待後續處理
- [x] Emergency Mode foreground service 的背景／鎖屏實機驗證（甲的 stub 版本，重跑見上方待辦 3）：Pixel 7 上鎖屏 **176 秒不間斷心跳**（遠超 `C_BLEbroadcast.md` 先前只驗證過 15 秒），背景/鎖屏存活證實。乙的正式骨架已交付（`emergency/EmergencyModeService.kt` + `EmergencyStatusText.kt`），取代了這個 stub，且把「App 啟動就常駐」改成「開關驅動啟停」
- [x] **Connection success rate**：Pixel 7 → Pixel 8a 亮屏正式跑滿 20 次，**17/20 成功（85%）**，成功案例 latency p50=289ms／p95=566ms，最後 3 次連續失敗（`service discovery failed`，各逾時 10 秒）——懷疑連續高頻重連後 BLE stack／對端 GATT server 需要更長恢復時間。**鎖屏情境另跑 20 次：19/19（扣除按下按鈕當下仍亮屏的第 1 次）全部失敗，0% 成功率**——證實沒有 foreground service 保護的一般 App，鎖屏後幾乎無法完成 BLE 連線，直接印證了 Emergency Mode 為何需要 foreground service（跨機型與換乙的正式骨架重跑見上方待辦 2）
- [x] **Energy Cost**：60 秒 scan-only baseline 平均 **22.35 mW**；60 秒 scan+持續傳輸平均 **26.78 mW**（已扣除連線瞬間的尖峰）——傳輸本身增加約 4.4 mW。原始 CSV 存在 `experiments/results/energy-raw/`，**交給乙分析**補進 `experiments/results/report.md`

**通過條件**：兩台測試機重複完成 HELLO→DIFF→REQUEST→TRANSFER→VERIFY/APPLY，且只交換缺少的分片並通過簽章驗證；三機情境下 A 不連 C 也能經 B 同步到最新資料；階段 0 相容性轉正。

---

## 乙：協定邏輯、UI 與量測分析（不需要 Android 手機的一切）

**現況（2026-09-05 更新）**：真實資料源（TDX／CWA／NCDR／醫療／避難所）與 `simulator/` 四指標報告都已完成到可維護狀態。Kotlin 版 Peer Sync 協定邏輯已完成並通過 JVM 單元測試，甲已接上 `BleGattTransport` 並完成 3a 里程碑。Emergency Mode 手動開關 UI 與 foreground service 正式骨架皆已完成（見下方），甲原本自己墊的 stub 版本可以直接被取代——**兩邊的交接點目前都已清空**。接下來剩下 simulator 校準、Energy Cost 分析、文件維護三項。

**待辦（依序）**

- [x] **把 `pipeline/lib/peer-sync.mjs` 的 `computeDiff`／`buildRequest` 邏輯搬成 Kotlin**，對應 `schemas/peer-summary-v0.schema.json`；比照 `android/app/src/test/.../trust/EventVerifierTest.kt` 的作法，用 JVM 單元測試對著 `fixtures/protocol-exchange-v0.json` 跟 `pipeline/test/peer-sync.test.mjs` 裡新增的跨 manifest_id 案例驗證邏輯一致——**已完成，2026-09-05**
  - 新增 `android/app/src/main/java/com/resilientgeo/mesh/protocol/{PeerSummary,PeerSync}.kt`
  - 新增 `android/app/src/test/java/com/resilientgeo/mesh/protocol/{PeerSyncTest,PeerSyncTestFixtures}.kt`
  - `PeerSyncTest`：6 個案例全過（`./gradlew testDebugUnitTest --tests "com.resilientgeo.mesh.protocol.PeerSyncTest"`），對照 JS 版 `pipeline/test/peer-sync.test.mjs` 逐項核對，包含跨 manifest_id 的 DTN supersession 情境
  - **交給甲**：`PeerSync.computeDiff()`／`PeerSync.buildRequest()` 可直接呼叫，取代 `BleGattTransport` spike activity 裡目前寫死的 `randomPayload()`
- [x] **把 Emergency Mode 從寫死的「Emergency Mode: ON」label 改成使用者手動開關的 UI**——已完成，2026-09-05
  - `MainActivity.kt`/`MainViewModel.kt`/`activity_main.xml`/`strings.xml`：新增 `emergencyModeEnabled: StateFlow<Boolean>`，預設 `false`，開關切換即時反映文字與顏色（ON 亮藍 / OFF 灰）
  - 額外修正：Android 15+ 對 targetSdk 35+ 強制 edge-to-edge，`setDecorFitsSystemWindows` 已失效，改用 `WindowInsets` 監聽動態加 padding，避免狀態列文字重疊
  - 已在 emulator（Pixel 9 Pro XL, API 36）驗證 ON/OFF 切換與旋轉螢幕狀態保留
- [x] **撰寫 Emergency Mode foreground service 的正式骨架**——已完成，2026-09-05
  - 取代甲先前為了不被卡住而寫的 `EmergencyModeService` stub（保留其心跳/通知邏輯，甲的背景存活驗證結論不受影響，因為生命週期沒有變動）
  - 新增 `emergency/EmergencyStatusText.kt`：把通知文字格式化邏輯抽成純函式，JVM 可測試（5 個測試全過），不用等機器驗證
  - **開關與 service 生命週期已串接**：`MainActivity` 現在是「開關打開才啟動 service、關掉就 `stopService()`」，不再是 App 一啟動就無條件常駐——這點跟甲同步過，因為改變了 service 的觸發時機
- [ ] 用甲交付的接觸窗與相容性數據，校準 `simulator/fixtures/sim-config.json`，重跑 `npm run sim:check` 確認位元相同
- [ ] 分析甲收集的 `elapsed_s,power_mw` Energy CSV，補進 `experiments/results/report.md` 的 Energy Cost 欄位
- [ ] 維護 demo 腳本與限制說明（`experiments/{demo,limitations}.md`），確保跟甲最新的協定行為對得上
- [ ] （選用，非 MVP 必要）真實 API 串接：目前資料源都還是可重播 fixture，時間允許可挑一個換成即時 API 呼叫

**通過條件**：Kotlin 協定邏輯的 JVM 單元測試全過，且跟 pipeline 版本行為一致；Emergency Mode UI 與 foreground service 骨架交付給甲整合；`experiments/results/report.md` 補上 Energy Cost 欄位且可重現。

---

## 里程碑檢查點

| 時序 | 檢查點 | 負責人 |
| --- | --- | --- |
| 已完成 2026-09-05 | Kotlin 協定邏輯 + JVM 單元測試交付（甲要接上真傳輸層的前提） | 乙 |
| 已完成 2026-09-05 | 接觸窗量測、3a 里程碑（兩機交換一個真 chunk）、跨接觸續傳 | 甲 |
| 已完成 2026-09-05 | Emergency Mode UI + Service 正式骨架交付（甲的 stub 可以退場） | 乙 |
| 已完成 2026-09-05 | Stage 3b：跨接觸續傳、critical-first 排程實機驗證（Peer 上限那半留給第三台裝置） | 甲 |
| 待 Samsung 到位 | 跨機型相容性轉正、跨機型 connection rate、換乙正式骨架重跑鎖屏驗證、Stage 3c 三機 Store-Carry-Forward | 甲 |
| 第 5 週 | Energy Cost 補上、simulator 用實機數據重新校準 | 乙 |

---

## 已完成部分（原四人分工遺留，供追溯）

- **A（Data Pipeline & Trust）**：`schemas/`、`pipeline/` 正規化、Ed25519 簽章與驗證、竄改／重播／TTL 測試皆已完成；`pipeline/sources/` 已接入 TDX、CWA、NCDR、醫療、避難所等可重播資料源。
- **B（Android GIS & 本機資料庫）**：階段 1 四項待辦（離線地圖、Room 資料庫、事件套用規則、Android 端 Ed25519 驗簽 adapter）皆已完成並在 Pixel 8a 實機驗證通過；`merge/android-b-into-c-skeleton` 已合併回 `main`。
- **C（Peer Sync & 傳輸層，階段 0）**：Nearby Connections／原生 Wi-Fi Direct／BLE GATT 三個候選皆實測，BLE GATT 勝出並定案 ADR-001；discovery、連線、KB 級傳輸、位元組級斷點續傳皆在兩台 Pixel 實機上驗證通過。
- **D（Experiment Harness & 量測）**：`simulator/` 決定性模擬 10／20／50／100 節點 × 三策略 × 地理過濾已完成；`experiments/` 四指標報告（Coverage／Freshness／Cellular Savings／Transfer Efficiency）可重現，`matrix --check` 通過。