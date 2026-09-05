# MVP 剩餘待辦（合併版，不分人）

> 建立日期：2026-09-05
> 取代分工方式：不再按「甲／乙」或「需不需要實機」切分，只按「離 MVP 通過條件有多近」排序。
> 對應文件：`system.md`（開發階段與驗收條件）、`team-assignments.md`（保留原始分工細節與已完成證據）、`docs/review-system-md-2026-09-05.md`（結構性風險分析）
>
> **2026-09-05 更新：黑客松明天截止，真實資料源整合（原 D 段：OSM/避難所/醫療接線、TDX/CWA 申請金鑰、NCDR）全部砍掉，不做。** 現有的可重播 fixture 已經滿足 MVP §2「先接一個官方或可重播的測試資料源」的定義，時間不夠不是妥協，是本來就不需要。以下只保留剩下時間內真正做得到、也值得做的項目。

---

## A. 阻塞 MVP 通過條件（必須完成才能宣告 MVP 達標）

- [x] **1. 跨機型相容性補測**（階段 0，2026-09-05 完成，用 Sharp SH-M32 取代 Samsung）
  裝置持有狀況變動，改用 Sharp SH-M32（Android 15, API 35）取代原計畫的 Samsung——品牌與 API 版本都跟兩台 Pixel（Android 17, API 37）不同，滿足「至少兩個品牌、兩個 Android 版本」的排除標準。discovery/connect/transfer 與完整 HELLO→DIFF→REQUEST→TRANSFER→VERIFY/APPLY 序列（含中斷續傳）一次到位。過程中踩到兩個 Windows 端環境問題（USB 線材只能充電、Windows 自動配對錯誤的通用驅動導致 adb 看不到裝置）並排除，記錄在 `team-assignments.md`。**階段 0 相容性正式轉正**。

- [ ] **2. Connection success rate 跨機型正式統計 + 鎖屏情境換正式 service 重跑**
  先前 17/20（85%，亮屏）與鎖屏 0/19（0%）的數字只在兩台 Pixel 之間跑過，用的是甲的 stub service。Sharp 目前只有三機 SCF 過程中的零星 ad-hoc 連線數據，沒有正式跑滿 20 次的統計；鎖屏情境也還沒換成正式 `EmergencyModeService` 重跑，確認結論不是機型或 stub 版本特有的偶然現象。

- [ ] **3. 背景／鎖屏存活驗證換版重跑**
  正式骨架把「App 啟動就常駐」改成「開關驅動啟停」，生命週期改變後要重跑一次鎖屏心跳測試，確認先前 176 秒不間斷心跳的存活結論仍成立。**2026-09-05 曾嘗試重跑，心跳連續跑了 251 秒看似更好，但事後發現 `mWakefulness` 全程是 Awake（adb daemon 因為插入第三台裝置重啟，把螢幕喚醒了）——測到的是「螢幕亮著、App 在背景」的存活，不是真正的鎖屏/Doze 存活，結果無效，需要在確認螢幕真的進入 Dozing 狀態的前提下重來。**

- [x] **4. 三機 Store-Carry-Forward 驗證**（階段 3 的核心通過條件，2026-09-05 完成）
  Pixel 8a（A/Origin，持有全部資料）→ Pixel 7（B/Relay，一開始空的）→ Sharp SH-M32（C/Far，一開始空的）。第一段完成後直接讀 B 的 Room `.db-wal` 確認 4 筆事件皆 `CURRENT`；接著 **force-stop A 的 App、用 `pidof` 確認程序完全沒在跑**，B 換演 server 角色對 C 重跑一次同樣的流程（含一個 chunk 中斷於 1529/1735 bytes 又用 `resume()` 續傳），再次直接讀 C 的 Room `.db-wal` 確認同樣 4 筆事件皆 `CURRENT`。全程 A 不可能跟 C 建立連線（程序沒在跑），資料完全靠 B 中繼，**符合通過條件**。已知簡化：B 對外廣播的摘要是寫死的 fixture，不是動態讀自己 Room 內容組出來的，兩次都用直接讀 Room 的方式驗證內容正確、不受這個簡化影響。細節見 `team-assignments.md`。

- [x] **5. Energy Cost 分析補進報告**（2026-09-05 完成，階段 4 通過條件之一）
  已整理進 `experiments/results/report.md` 第 5 節（透過 `simulator/lib/report.mjs` 的 `ENERGY_COST` 常數生成，而非手改 report.md——那個檔案是 `matrix --check` 位元比對的對象，手改會被下次重跑蓋掉），含樣本數與「單一機型、單一視窗」的限制揭露。

- [x] **6. 回填 ADR-001 與 targetSizeBytes 決策**（2026-09-05 完成）
  多輪接觸窗（3.8–4.4 KB/s）、connection rate（亮屏 17/20、鎖屏 0/19）、energy cost（已於同日重測取代，見 D 段第 10 項）都已寫進 `docs/adr/ADR-001-transport-layer.md`「回填」段落；`pipeline/lib/bundle.mjs` 的 `targetSizeBytes = 4096` 保留原值，但補上用接觸窗吞吐量反推的理由（4096 bytes 在 3.8–4.4 KB/s 下約 1–1.5 秒傳完，符合最短 10 秒接觸窗的需求）。

- [x] **（額外修復，不在原始清單內）BleGattTransport 訊息序號 race bug**（2026-09-05 完成）
  team-assignments.md 記錄的「跨接觸續傳疊加 critical-first 時收到雜訊 payload、後續 chunk ack 逾時」的深層限制已修好：每個 GATT write 加 1-byte 訊息序號，接收端用 `(peer address, seq)` 取代單一 peer 一個 slot。修復過程中在真機上又抓到一個新 bug（sender 端記錄中斷 seq 的表被無關的後續訊息成功清掉）並修正。兩輪 Pixel 7 ↔ Pixel 8a 實機驗證，logcat 佐證 `interrupted → 其他 3 個 chunk 正常送達 → resume 成功組出完整訊息`，無雜訊、無逾時。細節見 `team-assignments.md` 該條目與 commit `cabf6ca`。

---

## B. 建議做（不阻塞 demo 跑起來，但影響可信度／準確度）

- [x] **7. 用實機數據校準 simulator**（2026-09-05 完成，部分）
  `max_bytes_per_round` 已從憑感覺的 24576 校準成 `3,819 B/s（10 秒短窗最保守量測）× 30s = 114,570`，`npm run sim:check` 通過位元比對。順帶抓到一個真的設定檔問題：`p2p_throughput_bytes_per_sec: 131072` 這個欄位是舊的高頻寬候選（Nearby Connections/Wi-Fi Direct）遺留下來的數字，**simulator 程式碼從來沒讀過它**——真正生效的一直是 `max_bytes_per_round`，已移除該死欄位並在 `notes` 說明，避免有人以為那才是模擬用的吞吐量。`contact_probability`（0.55）與 `transfer_failure_prob`（0.06）維持工程估計值不變——這兩個是社交接觸機率／傳輸失敗率模型，目前的實機數據（BLE 吞吐量、connection success rate）沒有直接對應到這兩個參數，硬套會是假精確，寧可留著工程估計標籤。

- [x] **8. 維護 demo 腳本與限制說明**（2026-09-05 完成）
  `experiments/demo.md` 更新了過期的分支參照與校準前的數字（cellular_savings、freshness p50），並補上 Energy Cost 已量測的說明；`experiments/limitations.md` 更新「尚未校準」段落反映 `max_bytes_per_round` 已校準、`contact_probability`／`transfer_failure_prob` 仍是估計值，並把下面 C 段的兩項架構限制寫進去（見 9、10）。

---

## C. 已知架構限制（v0 不修，但已寫進文件，避免被當成沒發現）

- [x] **9. 固定大小切分導致版本更新無法真正 delta**（2026-09-05 已寫進 `experiments/limitations.md`）
  `manifest.chunking.algorithm` 是 `fixed-size`：v136 → v137 只要有一筆事件變動，同組後面所有 chunk 的邊界就會位移、hash 全變，等於整組重傳。內容導向切分（CDC）或組內單事件對齊可以修，但工作量不小——v0 不在 hackathon 時限內動這個，只確保文件寫清楚。（跨 `manifest_id` 的 DIFF 行為本身**已經修好**：`pipeline/lib/peer-sync.mjs` 與 Kotlin 版 `PeerSync.kt` 都已實作「新版本整組覆蓋舊版本」的 DTN 規則並有測試，這點不用再做。）

- [x] **10. HELLO 表示法會隨資料集線性膨脹**（2026-09-05 已寫進 `experiments/limitations.md`）
  目前逐條列舉 chunk（183 chunk＝36 KB），全台規模會膨脹到數百 KB、傳不完。Bloom filter／bitmap 表示法（23 bytes 等級）已寫進 `system.md` §5 當已知擴展路徑，v0 資料量夠小不需要現在實作，維持現狀即可。

---

## 不做（明確排除，寫在這裡是為了不要有人半夜手癢又撿回來做）

- ~~真實資料源接線（OSM/避難所/醫療無金鑰三源、TDX/CWA 申請金鑰、NCDR）~~——明天截止，時間不夠。MVP 定義本來就允許用可重播 fixture，不算縮水。demo/limitations 文件裡照實寫「災情資料為可重播模擬資料，非即時官方資料」即可（`docs/neihu-online-data-sources.md` 已經有這段話可以直接引用）。

---

## D. 2026-09-05 送件前程式碼審查修正

對照程式碼而非文件自述，找出九項「文件說有、程式碼沒有」或「與自訂通過條件相違」的問題並修正。全部已驗證：40 項 JVM 單元測試、115 項 Node 測試、`npm run sim:check` PASS、`assembleDebug` 成功。

- [x] **1. TTL 過期狀態永遠不更新（真 bug）** — `applyState` 原本只在 ingest 當下算一次就存進 Room，列表與地圖直接讀存下來的字串。事件離線放到過期後仍顯示 CURRENT，直接違反階段 2 通過條件「TTL 到期時不把它顯示為目前有效資料」。改為由 `ApplyState.at(namespace, expiresAt, now)` 單一來源在**繪製當下**推導，ingest 與顯示共用同一份定義；`MainActivity` 加 30 秒 ticker 讓 badge 會真的翻成 EXPIRED。新增 `ApplyStateTest`（7 例，含到期邊界與 crowd namespace 的優先序）。既有 fixture 只有「已過期」與「2099 過期」兩種，永遠踩不到中間，這是它沒被抓到的原因。
- [x] **2. Emergency Mode 是空殼** — 服務原本只有心跳 log 與通知，沒有任何 BLE。已接上 `BleDiscovery` 廣播＋掃描、以 30 秒視窗統計附近節點數並顯示在通知列，權限或藍牙未就緒時如實顯示 "Discovery off" 而非假裝正常。**仍未做**：自動建立 GATT 連線與角色協商，已寫進 README 限制。
- [x] **3. Peer Sync 在 App 裡按不到** — `PeerSyncMilestoneActivity` 原本只能 `adb shell am start`，裝了 APK 的人無法操作本專案核心功能。主畫面加上「Peer Sync (2 devices)」按鈕。
- [x] **4. 節點不知道自己有什麼** — 新增 `chunks` 資料表（`ChunkEntity`/`ChunkDao`，Room v1→v2 真 migration，不用 destructive fallback 以免清掉離線持有的資料）。`MeshRepository.ingestChunk` 在驗證通過後記錄分片，`localPeerSummary()` 據此組出真正的 `peer-summary-v0`；requester 端 HELLO 已改用它，不再是寫死的「我什麼都沒有」。新增 5 項 instrumented 測試（未在本次執行，無裝置）。
- [x] **5. 續傳沒有進協定層** — `buildRequest` 原本兩邊都硬寫 `offset_bytes: 0`，續傳訊息只能由 demo activity 手工組。JS 與 Kotlin 版皆加上 `offsets` 參數（超出範圍會拋錯、已完整持有的分片直接不請求），各補 3 項測試。ADR-001 自己說在 3.8–4.4 KB/s 下跨接觸續傳是同步能不能推進的關鍵，它本來不在可重用的那一層。
- [x] **6. `.gitignore` 漏一層目錄** — 規則是 `/android/.idea/`，實際目錄在 `android/app/.idea/`，導致 `workspace.xml` 被追蹤、其餘 7 個檔案永遠浮在 `git status`。補規則並 `git rm --cached`。
- [x] **7. 所有 spike activity `exported="true"`** — 沒有 intent-filter 卻對外開放，任何 App 都能啟動會開藍牙廣播的畫面。main manifest 全改 `exported="false"`。
  **修正（實機驗證後）**：原本以為「shell 持有 `START_ANY_ACTIVITY`，所以 `adb shell am start` 不受影響」——**這是錯的**，Pixel 7 上實測直接噴 `SecurityException: Permission Denial ... not exported from uid 10262`。這會打斷所有靠 adb 驅動 harness 畫面的量測流程（接觸窗、connection rate、耗電）。改用 `src/debug/AndroidManifest.xml` 只在 debug 變體以 `tools:replace` 重新 export，release 變體維持全關；已用 merged manifest 逐項確認兩個變體的旗標。`EmergencyModeService` 兩個變體都維持 non-exported，由 UI 開關驅動。
- [x] **8. 已否決方案仍留在 App 裡** — 刪除 `NearbyConnectionsTransport`／`WifiDirectTransport`／`LocalNetworkTransport` 與三個對應 spike activity，連同 `INTERNET`、`ACCESS_WIFI_STATE`、`CHANGE_WIFI_STATE`、`NEARBY_WIFI_DEVICES`、`CHANGE_WIFI_MULTICAST_STATE` 權限與 Play Services 相依。程式碼保留在 git 歷史，實測記錄保留在 ADR-001。**現在 APK 實際權限只剩藍牙／前景服務／通知**（`aapt2 dump permissions` 驗證過），「不需要網路基礎設施」才是可查證的主張。
- [x] **9. README 不實陳述** — 原本寫「不需要任何網路權限」但 manifest 有 `INTERNET`（第 8 項修掉後這句才成立）；Emergency Mode 的描述也超前於實作，已改為精確描述並補進限制段落。

### D 段的實機驗證結果（2026-09-05，三台裝置實測）

- **instrumented 測試 21/21 全過**，三台各跑 7 項：Pixel 7（API 37）、Pixel 8a（API 37）、Sharp SH-M32（API 35）。含新增的分片庫存測試，跨品牌跨 API 版本。
- **新的 Emergency Mode 服務實機確認可用**：Pixel 7 與 Pixel 8a 互相發現，兩台都回報 `peers=1`、`discovery=true`，foreground service 持續存活（單台連續 999 秒以上）。

- [x] **10. Energy Cost 重測，並判定舊數據作廢**（不在原始九項內，由重測過程發現）
  改版後的服務會持續 BLE 掃描，必須重新量測。過程中發現**舊的 22.35 / 26.78 mW 根本沒有量到耗電**：當時手機插著 USB 且電量全滿，電池電流在零附近震盪，記錄到的是計量器雜訊。三項證據：(1) 兩個「不同條件」的 min／p25／median 完全相同（1.35／10.83／20.31），不同工作負載不可能如此；(2) 22 mW 對整支手機物理上不可能，本次量到螢幕關閉的閒置就是約 385 mW；(3) 滿電插電的 Pixel 8a 今天可重現同樣的正負震盪型態。
  重測結果：Pixel 7 螢幕關閉、Pixel 8a 當鄰居，baseline 與 Emergency Mode **交錯** 6 輪 × 60 筆 ⇒ **385 → 439 mW，+54 mW（+14%）**，約每小時多耗 0.3% 電量。採用「各輪中位數的中位數」而非平均值：baseline 第 3 輪被系統背景工作污染（748 mW，其餘五輪 363–398），該輪**保留不刪**，並同時揭露彙總算法的 +43 mW 以顯示估計值對這一輪的敏感度。每輪取樣前後都用 logcat 驗證服務狀態，驗證不過就丟棄該輪——第一次嘗試正是因為螢幕關閉後裝置重新上鎖、開關沒按到，產出了「看起來合理但服務其實沒開」的數據，全部作廢重跑。

## E. 2026-09-05 第二輪程式碼審查（實機在手）

- [x] **11. HELLO 不符合自己發布的 schema** — `schemas/peer-summary-v0.schema.json` 要求 6 個頂層欄位（`schema_version`／`protocol_version`／`node_id`／`generated_at`／`capabilities`／`datasets`），但 Android 端寫死的 `NODE_A/B_SUMMARY` 只帶 3 個，`localPeerSummary()` 也照抄了這個缺陷。沒有東西攔得住，因為 `PeerSummary.fromJson` 只讀 `node_id` 與 `datasets`，而 `pipeline/test/schema.test.mjs` **從未驗證過 peer-summary fixture**。這是唯一真的會在兩台手機之間傳輸的訊息，卻是唯一沒被驗證的 schema。已補齊兩端欄位，並在 Node 測試補上 fixture 對 schema 的驗證、缺欄位的反向測試，以及兩份 fixture 副本（repo 根目錄與 Android test resources）必須位元相同的測試——否則 Kotlin 與 JS 版的 `computeDiff` 會在不同輸入上各自「通過」。

- [x] **12. 能力宣告仍在推銷已否決的傳輸層** — 四份 peer-summary fixture 的 `transfer_transports` 都寫著 `["NEARBY_CONNECTIONS","WIFI_DIRECT"]`，兩個都是 ADR-001 實測後否決、程式碼也已刪除的方案。更根本的是 **schema 的 transport enum 裡根本沒有本專案實際採用的 BLE GATT**——那份詞彙表早於 ADR-001，只能說「BLE」，而在原始設計裡 BLE 專指「只做發現、不做傳輸」。已把 `BLE_GATT` 加進 enum（純擴充），四份 fixture 與 App 端一律改為宣告 `discovery=["BLE"]`／`transfer=["BLE_GATT"]`，並加測試釘住。

- [x] **13. Room 1→2 migration 完全沒被測試** — 其餘 instrumented 測試用 `inMemoryDatabaseBuilder`，那是每次全新建表、**永遠不會執行 migration**。手寫的 `CREATE TABLE` 只要與 Room 期望的 schema 有一點不符，升級的裝置一開 App 就會崩潰，而重新安裝的人永遠測不到。新增 `MigrationInstrumentedTest`：手工造一個 v1 資料庫並塞入一筆事件，用真實檔案開啟 v2，驗證**既有事件仍在**（這正是階段 1「資料不會消失」的通過條件，也是當初不用 destructive fallback 的理由）、chunks 表可寫可讀、全新安裝路徑不受影響。兩台 Pixel 實機通過。

- [x] **14. 送出失敗卻回報成功** — `PeerSyncMilestoneActivity` 的 `sendEnvelope()` 失敗時只記一行 log，呼叫端仍無條件印「sent HELLO」／「sent REQUEST」。實機跑的時候親眼看到 `send failed ... writeCharacteristic() failed to queue` 的下一行就是「sent HELLO」。這個畫面上的日誌正是 demo 時人類用來判斷協定有沒有跑通的依據，等於一次什麼都沒送出去的執行看起來跟成功握手一模一樣。改成回傳 Boolean，失敗就不宣稱送出，並把訊息改為明顯的 `send FAILED`。

- [x] **15. 兩機端到端已補跑**（2026-09-05，Pixel 7 + Pixel 8a）
  第 11、12 項改動了兩台裝置實際交換的 HELLO 內容與大小，因此重跑完整序列驗證。

  **第一次交換**（Node A 手上是空的）：HELLO 雙向 → `DIFF: missing=[4 片]` → REQUEST 依 critical-first 排序送出（`shelter(CRITICAL) → flood(CRITICAL) → road(HIGH) → medical(LOW)`，`max_total_bytes=4623`）→ 其中 shelter **中斷於 507 bytes**，A 帶 `offset_bytes=507` 送出 resume REQUEST → 4 個分片全部通過 `ChunkVerifier` + `EventVerifier` 並寫入 Room（`Inserted(state=CURRENT)` ×4）。新版 HELLO（多帶 `protocol_version`／`generated_at`／`capabilities`）沒有造成任何問題。

  **第二次交換（關鍵驗證）**：force-stop 兩台重跑同一流程，這次 Node A 已持有全部 4 片。結果是 **`DIFF: missing=[] stale=[]` → 「nothing to request, already in sync」**，一個 byte 都沒有重傳。改動前寫死的 `NODE_A_SUMMARY` 永遠宣告空庫存，第二次相遇會把同樣 4 片全部重抓一次——**這條就是本專案「不要讓同一份資料被重複下載」的核心主張，現在是實機可證的，而不只是設計意圖**。

  另外直接讀 Pixel 7 的 Room 確認新的 `chunks` 表確實寫入了 4 筆分片記錄（不只信 log），這是第二次交換能正確回報持有的來源。

---

## 完成標準

- A 段全部打勾：MVP 五個必須項目（平台/地圖/資料/同步/可信度）才算真正達標，不是「紙上已完成」。
- B、C 段是誠信與品質分：沒做完不影響 demo 能不能跑，但影響評審問到細節時答不答得出來，時間允許就做，卡時間就先跳過、留在 limitations 裡誠實說沒做完。
