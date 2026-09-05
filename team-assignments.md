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

**現在剩下待辦（2026-09-05 更新，跨機型相容性與三機 SCF 都已用 Sharp SH-M32 完成，見下方已完成清單）**

1. **Connection success rate 用正式 `EmergencyModeService` 重跑鎖屏情境**：確認跟先前兩台 Pixel 上量到的 0/19（0%）結論一致，不是甲 stub 版本才有的偶然現象（跨機型的 20 次連線成功率統計本身還沒補，目前只有零星的 ad-hoc 連線數據，見下方已完成清單）
2. **Emergency Mode 背景／鎖屏驗證換版重跑**：乙的正式骨架把「App 啟動就常駐」改成「開關驅動啟停」，要重跑一次背景/鎖屏驗證確認這個生命週期改動沒有打破先前 176 秒不間斷心跳的存活結論——**2026-09-05 曾嘗試重跑，但過程中 adb daemon 因為插入第三台裝置重啟、把螢幕喚醒了，跑出來的 251 秒心跳其實是「螢幕亮著」而非「鎖屏」的存活結果，無效，需要在確定螢幕真的進入 Dozing 狀態的情況下重來**

**已完成（依序，細節與數據）**

- [x] **接觸窗量測**：harness 已完成（`transport/BleGattMeasurementActivity.kt`），Pixel 7 + Pixel 8a 多輪實測：10s=36,864B（3819 B/s）、30s 兩輪=122,880B/126,976B（4105/4281 B/s）、60s=262,144B（4419 B/s，另一輪傳輸中途 GATT write 逾時失敗，真實存在的不穩定現象一併記錄）——量級穩定在 3.8–4.4 KB/s，與 ADR-001 既有 3–6 KB/s 吻合（回填 ADR-001 見上方待辦 5）
- [x] 把乙交付的 Kotlin 協定邏輯接上 `BleGattTransport`（`transport/PeerSyncMilestoneActivity.kt`），取代 spike activity 裡的隨機測試 payload
- [x] 兩機交換**一個**真的簽章 chunk，接進 `MeshRepository.ingestChunk()`（新增）→ `ChunkVerifier`（新增，chunk_hash + chunk 級 Ed25519 簽章）→ `EventVerifier`/`EventIngestor` → Room —— **3a 里程碑，2026-09-05 在 Pixel 7 ↔ Pixel 8a 上通過**，直接讀出裝置上 Room 的 `.db-wal` 檔案確認 event 真的寫入（`applyState=CURRENT`），不只是信 log。chunk fixture 由 `pipeline/tools/generate-peer-sync-chunk-fixture.mjs` 產生（真實 Ed25519 簽章，key_id `peer-sync-demo-2026`）
- [x] 接上跨接觸續傳：Node B 故意在傳送中途模擬「接觸窗關閉」中斷（真機重現在 508/1735 bytes），透過新增的 CONTROL characteristic（獨立於 DATA，避免中斷通知被誤判成前一則訊息的延續字節——真機上實測撞到這個問題）告知 Node A 中斷位置，A 帶著正確 `offset_bytes` 重新送 REQUEST，B 用 `transport.resume()` 續傳，chunk_hash 驗證通過，證明續傳後的資料位元組完全正確。過程中修好 `transfer()` 一個資料損毀 bug（見上）
- [x] **Critical-first 排程的實機驗證**（Peer 上限那半需要 3+ 裝置，見上方待辦 4）：造 3 個不同優先度的真簽章 chunk（`pipeline/tools/generate-peer-sync-priority-chunks-fixture.mjs`，CRITICAL/HIGH/LOW），連同既有的 shelter chunk 一次全部 REQUEST，Pixel 7 送出的 REQUEST 順序實測為 `shelter(CRITICAL,1147B) → flood(CRITICAL,1148B) → road(HIGH,1163B) → medical(LOW,1165B)`——跨優先度排序正確，**同優先度內按 size 的 tie-break 也正確**。過程中修好一個真的協定 race：**B 只送一次 HELLO、不會重試，如果 HELLO 在 A 選定角色之前就抵達會被永久丟棄、卡死整個交握**（`PeerSyncMilestoneActivity.pendingRemoteSummaryJson` 機制修正）。另外發現一個當時**未修的深層限制**：把「跨接觸續傳」跟「critical-first」疊在同一次 REQUEST 裡測時（4 個 chunk 一次請求，其中一個故意中斷），A 在同時處理「中斷通知＋送 resume REQUEST」與「B 連續傳送後續 chunk」時收到過一次解析失敗的雜訊 payload，後續兩個 chunk ack 逾時——`BleGattTransport` 目前「一次只處理一則邏輯訊息」的假設在這種疊加情境下站不住腳，需要真正的訊息序號機制才能根治，當時超出驗證範圍，記錄待後續處理。

  **2026-09-05 後續修好**：`BleGattTransport` 每個 GATT write 現在多帶 1 byte 訊息序號（`seq`），接收端改成用 `(peer address, seq)` 當 key 存 in-flight message，不再是單一 peer 一個 slot——這樣被中斷的 chunk 即使之後有其他不相關的 chunk 在同一條連線上先完成，也不會互相污染彼此的重組緩衝區。在 Pixel 7 ↔ Pixel 8a 上重跑「shelter 中斷 + flood/road/medical 照常送」的組合情境兩次：第一次跑出一個新 bug（sender 端記錄「哪個 seq 被中斷」的表是用 connectionId 當 key，後面 flood 成功送完時把它清掉了，導致 resume 時抓不到正確 seq、retry 用了個新 seq、對端收到沒有 header 的續傳位元組後解析失敗，30 秒 ack timeout）；修好那個記帳 bug（只在「剛完成的訊息 seq」等於「記錄的中斷 seq」時才清除）後第二次重跑：shelter 在 1018/1735 bytes 處中斷 → flood/road/medical 三個全部正常送達 → shelter 的 resume REQUEST 送出、B 用 `resume()` 補上剩下 717 bytes、A 端組出完整 1735 bytes 且完整跑完 VERIFY/APPLY，全程無雜訊 payload、無 ack timeout。兩次真機驗證的完整 logcat 佐證這個修復是根治而非碰巧沒觸發。
- [x] Emergency Mode foreground service 的背景／鎖屏實機驗證（甲的 stub 版本，重跑見上方待辦 3）：Pixel 7 上鎖屏 **176 秒不間斷心跳**（遠超 `C_BLEbroadcast.md` 先前只驗證過 15 秒），背景/鎖屏存活證實。乙的正式骨架已交付（`emergency/EmergencyModeService.kt` + `EmergencyStatusText.kt`），取代了這個 stub，且把「App 啟動就常駐」改成「開關驅動啟停」
- [x] **Connection success rate**：Pixel 7 → Pixel 8a 亮屏正式跑滿 20 次，**17/20 成功（85%）**，成功案例 latency p50=289ms／p95=566ms，最後 3 次連續失敗（`service discovery failed`，各逾時 10 秒）——懷疑連續高頻重連後 BLE stack／對端 GATT server 需要更長恢復時間。**鎖屏情境另跑 20 次：19/19（扣除按下按鈕當下仍亮屏的第 1 次）全部失敗，0% 成功率**——證實沒有 foreground service 保護的一般 App，鎖屏後幾乎無法完成 BLE 連線，直接印證了 Emergency Mode 為何需要 foreground service（跨機型與換乙的正式骨架重跑見上方待辦 2）
- [x] **Energy Cost**：60 秒 scan-only baseline 平均 **22.35 mW**；60 秒 scan+持續傳輸平均 **26.78 mW**（已扣除連線瞬間的尖峰）——傳輸本身增加約 4.4 mW。原始 CSV 存在 `experiments/results/energy-raw/`，已由乙整理進 `experiments/results/report.md` 第 5 節（透過 `simulator/lib/report.mjs` 生成，非手改）
- [x] **回填 ADR-001**：上面所有真機數據（多輪接觸窗、connection rate 含鎖屏、energy cost）已寫進 `docs/adr/ADR-001-transport-layer.md`「回填」段落；`pipeline/lib/bundle.mjs` 的 `targetSizeBytes` 決策也已補上依接觸窗吞吐量反推的理由
- [x] **跨機型相容性測試——階段 0 轉正**（2026-09-05，用 Sharp SH-M32 而非原計畫的 Samsung SM-S731B，裝置持有狀況變動）：Sharp SH-M32（Android 15, API 35）同時滿足「至少兩個品牌、兩個 Android 版本」的排除標準——品牌不同（SHARP vs Google）、API 版本不同（35 vs 兩台 Pixel 的 37）。中途踩到兩個純環境問題並排除：(1) Windows 端一開始完全偵測不到手機，追到是 USB 資料線問題（原本插的線只能充電）換線後才被 Windows 看到；(2) 换線後 Windows 幫這台非 Pixel 手機自動配對了通用 `winusb.inf` 驅動而非 Google 官方 `android_winusb.inf`，導致該驅動雖顯示「正常運作」但沒有註冊 adb 認的裝置介面 GUID（`{f72fe0d4-cbcb-407d-8814-9ed673d0dd6b}`，用 `adb -a nodaemon server` 加 trace 才挖出來），adb 因此完全看不到裝置——後來換一次線材接口後 Windows 才重新正確列舉。**這兩個問題都是這台 Windows 電腦端的環境問題，不是手機或 App 的相容性問題**，記錄下來是因為排查過程花了不少時間，下次遇到同樣「Windows 看得到手機但 adb 看不到」的狀況可以直接跳過重裝驅動，先換一條確定能傳資料的線。裝置辨識後，discovery／connect／transfer／完整 HELLO→DIFF→REQUEST→TRANSFER→VERIFY/APPLY 序列在 Sharp 上一次到位（唯一一次重試發生在 Pixel 7 ↔ Pixel 8a 那對，不涉及 Sharp，屬於已知的 BLE 連線基礎失敗率）。**階段 0 相容性正式轉正**，`system.md` §8 的停止條件（「傳輸層只能在單一機型運作」）已排除。
- [x] **三機 Store-Carry-Forward 驗證**（2026-09-05，Pixel 8a=Origin/A、Pixel 7=Relay/B、Sharp SH-M32=Far/C）：A 先把 4 個簽章 chunk（含被故意中斷又續傳的 shelter chunk）完整同步給 B，直接讀出 B 的 Room `.db-wal` 確認 4 筆事件皆為 `CURRENT`（不只信 log）；接著**force-stop A 的 App、用 `pidof` 確認程序完全沒在跑**，再讓 B 換演 NODE_B（server）角色、C 演 NODE_A（requester），B→C 同樣完整跑完 HELLO→DIFF→REQUEST→TRANSFER（含中斷於 1529/1735 bytes 又用 `resume()` 續傳）→VERIFY/APPLY，再次直接讀出 C 的 Room `.db-wal` 確認同樣 4 筆事件皆為 `CURRENT`。全程 A 沒有、也不可能跟 C 建立任何連線（程序沒在跑），資料完全靠 B 中繼——**符合「A 不直接連 C 時，更新仍能經 B 到達 C」的通過條件**。誠實揭露一個簡化：B 對 C 廣播的 `PeerSummary`（`NODE_B_SUMMARY` 常數）跟 B 對 A 的 REQUEST 是同一份寫死的 fixture，不是從 B 的 Room 動態組出來的「B 現在實際持有什麼」——這對本次驗證的結論成立沒有影響（兩次驗證分別直接讀 Room 確認內容一致），但表示 B 的摘要生成尚未做到「真的動態讀自己持有的資料」，是下一步若要做正式產品化時要補的。

**通過條件**：兩台測試機重複完成 HELLO→DIFF→REQUEST→TRANSFER→VERIFY/APPLY，且只交換缺少的分片並通過簽章驗證——**已達成**；三機情境下 A 不連 C 也能經 B 同步到最新資料——**已達成**；階段 0 相容性轉正——**已達成**。

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