# ResilientGeo Mesh — 團隊分工（四人）

> 對應計畫文件：`system.md`（進度更新 2026-09-02）
> 本檔案建議放置於 repo 的 `docs/team-assignments.md`

## 分工總覽

| 負責人 | 模組 | 核心產物 |
| --- | --- | --- |
| A | Data Pipeline & Trust | 真實資料源接入、擴充 fixture |
| B | Android GIS & 本機資料庫 | 單機離線系統（階段 1） |
| C | Peer Sync & 傳輸層 | 實機傳輸 Spike、同步協定（階段 0、3） |
| D | Experiment Harness & 量測 | 模擬情境、指標報告（階段 4） |

依賴順序：**C 的階段 0 是最優先關卡**（決定傳輸方案），A、B 可並行不受阻；D 前期工作量較輕，可先搭模擬框架雛形，待 C、B 有實機資料後再接上真實量測。

---

## A：Data Pipeline & Trust（資料與簽章）

**現況**：schemas、pipeline 正規化、簽章驗證、安全測試均已完成，唯獨真實資料源尚未開始。

**待辦**
- [ ] 接入至少一個官方即時 API（TDX／CWA／NCDR 擇一優先）
- [ ] 將 `pipeline/sources/tdx-fixture.json` 換成真實 API 回應形狀，確認正規化邏輯仍成立
- [ ] 擴充測試 fixture 至 100–1,000 筆道路／避難所事件與更新序列
- [ ] 維護 `schemas/`、`pipeline/`，確保 Node 測試持續通過

**產出**：可重播、規模化的真實測試資料集

---

## B：Android GIS & 本機資料庫（單機系統）

**現況**：階段 1 四項待辦均已實作完成，並已與 C 的專案骨架整合（分支
`merge/android-b-into-c-skeleton`），單元測試、實機 instrumented test、
手動離線驗收（強制關閉＋飛航模式＋重開）皆已在真實裝置上跑過並通過。細節見
`android/README.md`（Build status / Reconciliation notes / Known gaps）。

**待辦**（已完成 4/4，實作細節）
- [x] 顯示測試區域離線底圖（道路、避難所圖層）— `map/OfflineMapView.kt`（自繪向量圖，無需網路/底圖圖磚）
- [x] 建立本機資料庫，保存事件、版本、到期時間 — `data/EventEntity.kt` + Room
- [x] 實作事件套用規則：新版覆蓋舊版、過期標示、namespace 隔離 — `ingest/EventIngestor.kt`
- [x] 建立 Android 端簽章驗證 adapter（銜接 A 的 platform-neutral verifier）— `trust/Canonical.kt`、`trust/EventVerifier.kt` 等，Ed25519（Bouncy Castle）

**通過條件**：關閉網路後重啟 App，地圖與最後資料仍可讀；舊事件不能覆蓋新事件。**已在 Pixel 8a 實機驗證通過。**

**剩餘待辦（合併/整合相關，非階段 1 核心功能）**
- [x] 確認「BLE Spike (Stage 0)」按鈕導向 `BleSpikeActivity` 後行為仍正常 — 已在 Pixel 8a 實測，權限請求正常、`advertise started ok`，符合 `C_BLEbroadcast.md` 預期
- [x] Launcher activity 判斷：維持 `MainActivity` 為 launcher（`BleSpikeActivity` 是 Stage 0 的臨時測試用途，非最終產品畫面，見 `android/README.md` 的 Reconciliation notes 說明理由）
- [x] `merge/android-b-into-c-skeleton` 已通過所有驗證，準備合併回 `main` / push
- [ ] 階段 2：Android 驗簽 adapter 已建立，待與 A 確認是否需要進一步對接（見里程碑表）

---

## C：Peer Sync & 傳輸層（連線與協定）

**現況**：尚未開始，是階段 0 的關鍵路徑，需優先完成。

**待辦**
- [x] 兩台 Android 實機（Pixel 7 + Pixel 8a）驗證 BLE 雙向 discovery — 過程中修正了 `BleDiscovery` 掃描未過濾 `SERVICE_UUID` 的 bug（原本量到的是環境雜訊，不是彼此廣播）；修正後 discovery latency p50/p95 已記錄於 ADR-001。**尚缺**：Nearby Connections／Wi-Fi Direct 比較未開始，且兩台測試機都是 Pixel／同 API 版本，未滿足「至少兩個品牌」
- [ ] 記錄 1 MB、10 MB 的連線時間、傳輸速度、斷線恢復結果（需要 `NearbyConnectionsTransport` 實作，尚未開始）
- [ ] 定稿 ADR-001（傳輸層選擇與未選方案原因）— discovery 部分數據已補上，狀態仍是 `Proposed`，等 connect/transfer/resume 數據到齊才能定稿
- [ ] 實作 Peer Sync 協定：HELLO → DIFF → REQUEST → TRANSFER → VERIFY/APPLY
- [ ] 階段 3：斷線續傳、Peer 上限、critical-first 排程、三機 Store-Carry-Forward 驗證

**通過條件（階段 0）**：兩台指定測試機可重複完成發現、連線、傳輸、斷線重試，才可進入 UI 開發。

---

## D：Experiment Harness & 量測（模擬與報告）

**現況**：尚未開始，對應階段 4；前期可協助階段 3 記錄工作。

**待辦**
- [ ] 建立 10、20、50、100 節點可重播模擬情境
- [ ] 實作 Coverage、Freshness Lag、Cellular Savings、Transfer Efficiency、Energy Cost 量測腳本
- [ ] 比較無協作／一般 replication／rarest-first 三種擴散策略
- [ ] 產出 Demo 腳本、限制說明與結果圖表
- [ ] （前期協助）階段 3 多機同步時記錄重複傳輸與同步完成時間

**通過條件**：報告可重現，不宣稱固定時間覆蓋全城；所有成果附測試條件與樣本數。

---

## 里程碑檢查點

| 週次 | 檢查點 | 負責人 |
| --- | --- | --- |
| 第 0–1 週 | 階段 0 通過（實機傳輸 Spike 定案） | C |
| 第 1 週 | 階段 1 通過（單機離線可讀） | B |
| 第 2 週 | 階段 2 App-level 驗證完成（Android 驗簽 adapter 接上） | A + B |
| 第 3–4 週 | 階段 3 通過（3 機 Store-Carry-Forward） | C（D 協助記錄） |
| 第 5 週 | 階段 4 通過（模擬與報告完成） | D |
