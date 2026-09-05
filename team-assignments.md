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

**現況**：BLE GATT 傳輸層已驗證通過（`transport/BleGattTransport.kt`，discovery/連線/傳輸/位元組級續傳皆成功），但完全沒有協定層接上去——`send()`/`resume()` 傳的仍是 `randomPayload()`／`SecureRandom` 產生的假資料。`EventVerifier` → `EventIngestor` → Room 這條驗證寫入路徑已經打通，但目前唯一入口是讀 App 內建 fixture 的 `MeshRepository.ingestBundledFixture()`，還沒有東西從 Peer Sync 真的傳進來。

**待辦（依序）**

- [ ] **接觸窗量測**：用兩台實機模擬 opportunistic contact（10–60 秒隨機擦身而過），實測「一次接觸平均能傳幾 bytes」，回填 `docs/adr/ADR-001-transport-layer.md` 與 `pipeline/lib/bundle.mjs` 的 `targetSizeBytes` 決策（現在是拍腦袋定的 4096）——這項可以在等乙交付協定邏輯的同時先做，不互相卡
- [ ] **跨機型相容性測試**：3 台裡若有非 Pixel／不同 API 版本的機型（`C_BLEbroadcast.md` 記錄的 Samsung SM-S731B），拿來重跑 discovery／connect／transfer，把階段 0 從「條件通過」轉正
- [ ] 把乙交付的 Kotlin 協定邏輯接上 `BleGattTransport`，取代 spike activity 裡的隨機測試 payload
- [ ] 兩機交換**一個**真的簽章 chunk，接進 `MeshRepository` → `EventVerifier` → Room（取代目前只能餵 `ingestBundledFixture()` 的呼叫路徑）— **3a 里程碑，唯一的整合風險點**
- [ ] 接上跨接觸續傳：`buildRequest()` 目前硬寫 `offset_bytes: 0`，`BleGattTransport` 已驗證的位元組級續傳要真的用上，實機測中斷後能否接續
- [ ] Peer 上限與 critical-first 排程的實機驗證
- [ ] Emergency Mode foreground service 的背景／鎖屏實機驗證（乙會先把 Service 骨架寫好，甲負責證明它在背景真的存活）
- [ ] Connection success rate（20 次，分亮屏／鎖屏）與 Energy Cost 量測，記錄 `elapsed_s,power_mw` CSV 交給乙分析
- [ ] 三機 Store-Carry-Forward 驗證：A 不直接連到 C 時，更新仍能經 B 到達 C（正好用自己的 3 台，不用跟人借）

**通過條件**：兩台測試機重複完成 HELLO→DIFF→REQUEST→TRANSFER→VERIFY/APPLY，且只交換缺少的分片並通過簽章驗證；三機情境下 A 不連 C 也能經 B 同步到最新資料；階段 0 相容性轉正。

---

## 乙：協定邏輯、UI 與量測分析（不需要 Android 手機的一切）

**現況**：真實資料源（TDX／CWA／NCDR／醫療／避難所）與 `simulator/` 四指標報告都已完成到可維護狀態。接下來的工作全部可以在自己電腦上完成，不需要實機也不需要模擬器。

**待辦（依序）**

- [ ] **把 `pipeline/lib/peer-sync.mjs` 的 `computeDiff`／`buildRequest` 邏輯搬成 Kotlin**，對應 `schemas/peer-summary-v0.schema.json`；比照 `android/app/src/test/.../trust/EventVerifierTest.kt` 的作法，用 JVM 單元測試對著 `fixtures/protocol-exchange-v0.json` 跟 `pipeline/test/peer-sync.test.mjs` 裡新增的跨 manifest_id 案例驗證邏輯一致——**這項最優先，甲在等**
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
| 立刻 | Kotlin 協定邏輯 + JVM 單元測試交付（甲要接上真傳輸層的前提） | 乙 |
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
