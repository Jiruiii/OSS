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

**現況（2026-09-05 更新）**：BLE GATT 傳輸層已驗證通過（`transport/BleGattTransport.kt`）。乙交付 Kotlin 版 `PeerSync`（`computeDiff`/`buildRequest`）後，甲已把協定邏輯接上真傳輸層並在 Pixel 7 + Pixel 8a 上跑通完整的 HELLO→DIFF→REQUEST→TRANSFER→VERIFY/APPLY（`transport/PeerSyncMilestoneActivity.kt`），並接上跨接觸續傳——**3a 里程碑已達成**，細節見下方。過程中在真機上抓到並修好三個 `BleGattTransport` 的真 bug（MTU 協商 race、`connect()`/`send()` 缺少序列化保護、**續傳會把多餘的 4-byte header 誤插進資料中間，靠 chunk_hash 驗證失敗才抓到**——這代表 Stage 0 spike 當時「驗證通過」的續傳測試其實從未真的比對過收到的位元組是否跟原始資料一致），修法與根因記錄在程式碼註解裡。

**待辦（依序）**

- [x] **接觸窗量測**：harness 已完成（`transport/BleGattMeasurementActivity.kt`），Pixel 7 + Pixel 8a 實測 30 秒窗口 = 122,880 bytes acked（4105 B/s），與 ADR-001 既有 3–6 KB/s 量級吻合——**尚需**：多輪次數據 + 正式回填 ADR-001／`pipeline/lib/bundle.mjs` 的 `targetSizeBytes` 決策段落
- [ ] **跨機型相容性測試**：本輪只用了兩台 Pixel，尚未拿 Samsung SM-S731B 重跑
- [x] 把乙交付的 Kotlin 協定邏輯接上 `BleGattTransport`（`transport/PeerSyncMilestoneActivity.kt`），取代 spike activity 裡的隨機測試 payload
- [x] 兩機交換**一個**真的簽章 chunk，接進 `MeshRepository.ingestChunk()`（新增）→ `ChunkVerifier`（新增，chunk_hash + chunk 級 Ed25519 簽章）→ `EventVerifier`/`EventIngestor` → Room —— **3a 里程碑，2026-09-05 在 Pixel 7 ↔ Pixel 8a 上通過**，直接讀出裝置上 Room 的 `.db-wal` 檔案確認 event 真的寫入（`applyState=CURRENT`），不只是信 log。chunk fixture 由 `pipeline/tools/generate-peer-sync-chunk-fixture.mjs` 產生（真實 Ed25519 簽章，key_id `peer-sync-demo-2026`）
- [x] 接上跨接觸續傳：Node B 故意在傳送中途模擬「接觸窗關閉」中斷（真機重現在 508/1735 bytes），透過新增的 CONTROL characteristic（獨立於 DATA，避免中斷通知被誤判成前一則訊息的延續字節——真機上實測撞到這個問題）告知 Node A 中斷位置，A 帶著正確 `offset_bytes` 重新送 REQUEST，B 用 `transport.resume()` 續傳，chunk_hash 驗證通過，證明續傳後的資料位元組完全正確。過程中修好 `transfer()` 一個資料損毀 bug（見上）
- [ ] Peer 上限與 critical-first 排程的實機驗證
- [x] Emergency Mode foreground service 的背景／鎖屏實機驗證：乙的 Service 骨架尚未交付，甲照 `docs/jia-task-sequence.md` Phase 0.5 的說法自己先寫最小版本（`emergency/EmergencyModeService.kt`，5 秒心跳 + 前景通知，`MainActivity` 啟動時一併啟動）——Pixel 7 上鎖屏 **176 秒不間斷心跳**（遠超 `C_BLEbroadcast.md` 先前只驗證過 15 秒），背景/鎖屏存活證實。乙的真版本交付後可直接替換這個類別的內容，不影響已證明的存活結論
- [x] **Connection success rate**：Pixel 7 → Pixel 8a 正式跑滿 20 次（皆亮屏），**17/20 成功（85%）**，成功案例 latency p50=289ms／p95=566ms。最後 3 次連續失敗（`service discovery failed`，各逾時 10 秒）——懷疑是連續高頻重連 20 次後 BLE stack／對端 GATT server 需要更長恢復時間，值得後續追蹤，但非本次 harness 的 bug。**尚需**：鎖屏情境、跨機型重跑
- [x] **Energy Cost**：60 秒 scan-only baseline 平均 **22.35 mW**；60 秒 scan+持續傳輸平均 **26.78 mW**（已扣除連線瞬間的尖峰）——傳輸本身增加約 4.4 mW。原始 CSV 存在 `experiments/results/energy-raw/`，**交給乙分析**補進 `experiments/results/report.md`


- [ ] 三機 Store-Carry-Forward 驗證：A 不直接連到 C 時，更新仍能經 B 到達 C（正好用自己的 3 台，不用跟人借）

**通過條件**：兩台測試機重複完成 HELLO→DIFF→REQUEST→TRANSFER→VERIFY/APPLY，且只交換缺少的分片並通過簽章驗證；三機情境下 A 不連 C 也能經 B 同步到最新資料；階段 0 相容性轉正。

---

## 乙：協定邏輯、UI 與量測分析（不需要 Android 手機的一切）

## 乙：協定邏輯、UI 與量測分析（不需要 Android 手機的一切）

**現況**：真實資料源（TDX／CWA／NCDR／醫療／避難所）與 `simulator/` 四指標報告都已完成到可維護狀態。Kotlin 版 Peer Sync 協定邏輯已完成並通過 JVM 單元測試（見下方），甲可以開始接上 `BleGattTransport`。接下來的工作全部可以在自己電腦上完成，不需要實機也不需要模擬器。

**待辦（依序）**

- [x] **把 `pipeline/lib/peer-sync.mjs` 的 `computeDiff`／`buildRequest` 邏輯搬成 Kotlin**，對應 `schemas/peer-summary-v0.schema.json`；比照 `android/app/src/test/.../trust/EventVerifierTest.kt` 的作法，用 JVM 單元測試對著 `fixtures/protocol-exchange-v0.json` 跟 `pipeline/test/peer-sync.test.mjs` 裡新增的跨 manifest_id 案例驗證邏輯一致——**已完成，2026-09-05**
  - 新增 `android/app/src/main/java/com/resilientgeo/mesh/protocol/{PeerSummary,PeerSync}.kt`
  - 新增 `android/app/src/test/java/com/resilientgeo/mesh/protocol/{PeerSyncTest,PeerSyncTestFixtures}.kt`
  - `PeerSyncTest`：6 個案例全過（`./gradlew testDebugUnitTest --tests "com.resilientgeo.mesh.protocol.PeerSyncTest"`），對照 JS 版 `pipeline/test/peer-sync.test.mjs` 逐項核對，包含跨 manifest_id 的 DTN supersession 情境
  - **交給甲**：`PeerSync.computeDiff()`／`PeerSync.buildRequest()` 可直接呼叫，取代 `BleGattTransport` spike activity 裡目前寫死的 `randomPayload()`
- [ ] 把 Emergency Mode 從目前寫死的「Emergency Mode: ON」label 改成使用者手動開關的 UI（純狀態切換，不涉及 BLE，可以用 emulator 或純程式碼審查驗證）
- [ ] 撰寫 Emergency Mode foreground service 的程式骨架（Service 類別、通知欄、生命週期），背景存活的實機驗證交給甲
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
| 立刻（並行） | 接觸窗量測、跨機型相容性測試 | 甲 |
| 第 3–4 週 | Stage 3a：兩機交換一個真 chunk，驗證後寫進 Room | 甲 |
| 第 3–4 週 | Stage 3b：續傳、Peer 上限、foreground service 實機驗證 | 甲（乙先交付 Emergency Mode UI + Service 骨架） |
| 第 3–4 週 | Stage 3c：三機 Store-Carry-Forward | 甲 |
| 第 5 週 | Energy Cost 補上、simulator 用實機數據重新校準 | 乙 |

---

## 已完成部分（原四人分工遺留，供追溯）

- **A（Data Pipeline & Trust）**：`schemas/`、`pipeline/` 正規化、Ed25519 簽章與驗證、竄改／重播／TTL 測試皆已完成；`pipeline/sources/` 已接入 TDX、CWA、NCDR、醫療、避難所等可重播資料源。
- **B（Android GIS & 本機資料庫）**：階段 1 四項待辦（離線地圖、Room 資料庫、事件套用規則、Android 端 Ed25519 驗簽 adapter）皆已完成並在 Pixel 8a 實機驗證通過；`merge/android-b-into-c-skeleton` 已合併回 `main`。
- **C（Peer Sync & 傳輸層，階段 0）**：Nearby Connections／原生 Wi-Fi Direct／BLE GATT 三個候選皆實測，BLE GATT 勝出並定案 ADR-001；discovery、連線、KB 級傳輸、位元組級斷點續傳皆在兩台 Pixel 實機上驗證通過。
- **D（Experiment Harness & 量測）**：`simulator/` 決定性模擬 10／20／50／100 節點 × 三策略 × 地理過濾已完成；`experiments/` 四指標報告（Coverage／Freshness／Cellular Savings／Transfer Efficiency）可重現，`matrix --check` 通過。
