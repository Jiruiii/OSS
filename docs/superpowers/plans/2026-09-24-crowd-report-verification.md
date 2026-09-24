# 民眾回報 + 政府驗證 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 狀態：2026-09-24 規劃，**尚未實作**。任務總覽與進度追蹤見 `docs/mvp-remaining-tasks.md` F 段。

**Goal:** 讓民眾在 App 上回報災情。回報以 `UNVERIFIED` 顯示，並經 BLE mesh 在附近手機之間流通。回報送到政府端後，政府簽發官方確認或否定事件，經既有的 pipeline 與 mesh 傳回手機，地圖上的原回報改顯示為「已查證」或「查證為假」。

**Architecture:**
- 每台裝置第一次回報時，自己產生一把 Ed25519 金鑰，用它簽 `crowd.reports` 事件，公鑰隨事件一起送出。
- `EventVerifier`（Kotlin）和 `contract.mjs`（JS）對 `crowd.*` 事件改用事件內附的公鑰驗章；`official.*` 仍然只信任內建的 `trusted-keys.json`。
- crowd 回報以「一筆回報一個分片」的方式放進獨立的 dataset，由既有的 `AutoPeerSyncEngine` 轉傳。
- 政府驗證是另一筆 `official.verified` 事件，用 `payload_hash` 指回原回報。原回報不會被修改。

**Tech Stack:** Kotlin + Bouncy Castle `bcprov-jdk18on`（已有）、Room、Flutter MethodChannel（已有）、Node.js `node:crypto`（pipeline，零相依）、`node:test`、JUnit 4、Flutter test。

## Global Constraints

- **`official.*` 的信任規則不能因為 crowd 放寬而鬆動。** 用裝置金鑰簽的事件，只要 namespace 不是 `crowd.*` 就必須拒絕，而且要有反向測試把這條規則釘住。
- 裝置私鑰只存在這台裝置上，不進 log、不進 bridge 回傳值、不隨 HELLO 或事件送出。
- Flutter 仍然沒有 Room 寫入路徑。Flutter 只傳表單欄位，組事件、簽章、ingest 都在 Android 端做。
- JS 與 Kotlin 兩套驗證邏輯必須對同一份 fixture 得到相同結果。沿用現有做法：兩份 fixture 副本位元相同，並用測試保證。
- 伺服器是「升級管道」，不是前提。F1、F2 做完時，完全沒有政府端也要能運作。
- crowd 回報的顯示文字不得暗示已查證。多人佐證（F4）的文字也必須和「已查證」明確區分。
- 不修改 Flutter 產生的 `flutter/.android/`。

## 已確認的設計決策

| 項目 | 決定 |
|---|---|
| 簽章 | 裝置自產 Ed25519 金鑰。`signing_key_id = "device:" + sha256(SPKI DER) 前 32 個 hex`，事件新增選填欄位 `signer_public_key`（base64 SPKI） |
| 驗證表示法 | 獨立事件 `official.verified/attest:<原回報 event_id>`，`attributes` 帶 `target_namespace`、`target_event_id`、`target_payload_hash`、`verdict`（`CONFIRMED`／`REFUTED`） |
| 上行 | 有網路的節點代為上傳（Store-Carry-Forward 反方向）。demo 版以檔案匯出／匯入取代真的 API |
| 政府端 | `pipeline/cli.mjs attest` 指令。demo 時在筆電上跑 |

## 待確認（開工前要決定，決定後更新本段）

- 回報入口：長按地圖、浮動按鈕＋目前位置，或兩者都要。**本計畫先以「兩者都要」撰寫**，可以刪減。
- 回報類型清單：暫定 `ROAD_BLOCKED`、`FLOODING`、`TRAPPED_PERSON`、`SHELTER_ISSUE`、`OTHER`。
- 群眾回報 TTL：暫定 6 小時。
- 每台裝置的回報數量上限：暫定同時持有 20 筆「自己的」有效回報；每台節點最多保存 200 筆「他人的」crowd 回報。

---

### Task 1: 資料契約：crowd 事件的裝置簽章

**Files:**

- Modify: `schemas/event-v0.schema.json`（新增選填欄位 `signer_public_key`；`if namespace ^crowd\.` 則 `signer_public_key` 為 required）
- Modify: `docs/data-contract-v0.md`（新增「群眾回報簽章」一節）
- Modify: `pipeline/lib/contract.mjs`（`validateEventShape`、`verifyEvent`）
- Create: `pipeline/lib/device-key.mjs`（計算公鑰指紋）
- Create: `fixtures/crowd-reports-v0.json`（有效回報、竄改內容、指紋不符、用裝置金鑰冒充 `official.*` 各一筆）
- Modify: `pipeline/test/schema.test.mjs`
- Create: `pipeline/test/crowd-signature.test.mjs`

**Produces:** JS 端能驗證裝置簽章的 crowd 事件，並拒絕冒充官方的事件；以及一份給 Kotlin 端交叉驗證用的 fixture。

- [ ] **Step 1: 寫失敗測試。** 測試以下五種情況：
  - 有效的 crowd 回報，應通過，`eventState` 為 `unverified`。
  - 竄改 `attributes`，應在 integrity 階段失敗。
  - `signing_key_id` 與 `signer_public_key` 指紋不符，應在 trust 階段失敗。
  - `namespace: official.tdx` 卻用 `device:` 金鑰，應在 trust 階段失敗。
  - `crowd.*` 事件缺少 `signer_public_key`，應在 schema 階段失敗。
- [ ] **Step 2: 執行 `npm test`，確認新測試失敗、舊測試全過。**
- [ ] **Step 3: 實作。** `verifyEvent` 的 trust 階段改為兩條路徑：
  - `crowd.*` 且 `signing_key_id` 以 `device:` 開頭：從 `signer_public_key` 解析公鑰，再比對指紋。
  - 其他情況：維持原本的 `trustedKeyIds` 與 publicKey 路徑，而且 `device:` 開頭一律拒絕。
- [ ] **Step 4: 用新的 `pipeline/tools` 腳本產生 `fixtures/crowd-reports-v0.json`**。用固定種子產生測試金鑰，這把私鑰只能用在 fixture。重跑 `npm test` 必須全過。
- [ ] **Step 5: 更新 `docs/data-contract-v0.md`。** 寫清楚裝置簽章證明什麼（內容沒被竄改、出自同一台裝置）、不證明什麼（內容屬實）。

### Task 2: Android 端驗章與裝置金鑰

**Files:**

- Modify: `android/app/src/main/java/com/resilientgeo/mesh/trust/EventShapeValidator.kt`
- Modify: `android/app/src/main/java/com/resilientgeo/mesh/trust/EventVerifier.kt`
- Create: `android/app/src/main/java/com/resilientgeo/mesh/trust/DeviceSigningKey.kt`（產生、保存、簽章）
- Copy: `fixtures/crowd-reports-v0.json` → `android/app/src/test/resources/fixtures/`
- Create: `android/app/src/test/java/com/resilientgeo/mesh/trust/CrowdSignatureTest.kt`
- Modify: `pipeline/test/` 中檢查 fixture 副本位元相同的測試（把新 fixture 加進去）

**Produces:** Kotlin 端對同一份 fixture 得到與 JS 相同的結果，而且裝置能對自己的回報簽章。

- [ ] **Step 1: 寫失敗測試。** 用 Task 1 的 fixture 跑同樣五種情況；另外做一次往返測試：`DeviceSigningKey` 簽出來的事件要能通過 `EventVerifier`。
- [ ] **Step 2: 執行 `./gradlew testDebugUnitTest`，確認新測試失敗。**
- [ ] **Step 3: 實作 `EventVerifier` 的兩條 trust 路徑。** 規則和 JS 版逐字對應，註解標明對應 `contract.mjs` 的哪一段。
- [ ] **Step 4: 實作 `DeviceSigningKey`。**
  - 用 Bouncy Castle 產生 Ed25519 金鑰。私鑰用 Android Keystore 的 AES 金鑰加密後，存在 app 私有目錄；Keystore 原生支援 Ed25519 要 API 33 起，而 minSdk 是 26，所以採用這種包裝方式。
  - 對外只開放 `publicKeySpkiBase64()`、`keyId()`、`sign(bytes)`，不提供任何取得私鑰的 API。
- [ ] **Step 5: 全部 JVM 測試通過。**

### Task 3: 建立本機回報（Repository + Bridge）

**Files:**

- Modify: `android/app/src/main/java/com/resilientgeo/mesh/data/MeshRepository.kt`（新增 `createCrowdReport(...)`）
- Create: `android/app/src/main/java/com/resilientgeo/mesh/report/CrowdReportFactory.kt`（純函式：表單欄位＋時間＋金鑰 → event-v0）
- Modify: `android/app/src/main/java/com/resilientgeo/mesh/bridge/FlutterMapBridge.kt`（新增 method `submitCrowdReport`）
- Modify: `android/app/src/main/java/com/resilientgeo/mesh/bridge/MapBridgeProtocol.kt`
- Create: `android/app/src/test/java/com/resilientgeo/mesh/report/CrowdReportFactoryTest.kt`
- Create: `android/app/src/androidTest/java/com/resilientgeo/mesh/data/CrowdReportRepositoryInstrumentedTest.kt`

**Produces:** Flutter 呼叫 `submitCrowdReport({type, severity, note, lon, lat})` 後，Android 會組事件、簽章，並走一般 `EventIngestor` 流程寫入 Room，最後回傳 `{event_id, apply_state}`。

- [ ] **Step 1: 寫 `CrowdReportFactoryTest`。** 要檢查的項目：
  - 產出的事件通過 `EventVerifier`。
  - `namespace = crowd.reports`，`event_id` 格式為 `report:<keyId 後 8 碼>:<UUID>`。
  - `expires_at = issued_at + TTL`。
  - `provenance.transport_source.kind = "local_fixture"` 或新增的 `"local_report"`；若要新增 enum 值，也要同步修改 schema。
  - 備註欄超過上限會被拒絕。
  - 座標超出內湖 bounds 會被拒絕。
- [ ] **Step 2: 實作 factory 與 `MeshRepository.createCrowdReport`。** 必須走 `EventIngestor.ingest`，不能直接寫 DAO，確保本機回報和收到的回報走完全相同的驗證。
- [ ] **Step 3: bridge method。** 參數驗證失敗時回傳 `invalid_arguments`，並寫 `MapBridgeProtocol` 單元測試。
- [ ] **Step 4: instrumented 測試。** 回報後 `observeEvents()` 要出現這筆事件，且 `apply_state = UNVERIFIED`。
- [ ] **Step 5: 更新 `FlutterMapBridge` 類別註解。** 說明為什麼新增寫入 method 仍然符合「Flutter 沒有 Room 寫入路徑」：Flutter 只提供欄位，驗證和寫入都在 Android。

### Task 4: Flutter 回報 UI

**Files:**

- Modify: `flutter/lib/data/map_bridge.dart`（`submitCrowdReport`）
- Create: `flutter/lib/widgets/crowd_report_sheet.dart`（表單）
- Modify: `flutter/lib/screens/map_screen.dart`（長按地圖與浮動按鈕入口）
- Modify: `flutter/lib/widgets/feature_details_sheet.dart`（crowd 回報詳情加上「未經查證，僅供參考」提示）
- Create: `flutter/test/crowd_report_sheet_test.dart`

**Produces:** 民眾可以用長按地圖或浮動按鈕發起回報，送出後地圖上馬上出現紫色的「未驗證」標記。

- [ ] **Step 1: 寫 widget 測試。** 包含：表單必填驗證；送出時用正確參數呼叫 bridge（mock `MethodChannel`）；送出前有確認步驟；bridge 回錯時顯示錯誤，不假裝成功。
- [ ] **Step 2: 實作表單。** 類型、嚴重度、備註（上限 200 字，並提醒不要填個資）、位置。位置預設用長按點或 GPS，可以微調。
- [ ] **Step 3: `flutter test` 全過。**
- [ ] **Step 4: 實機手動驗證。** 關閉網路後回報，強制結束 App 再重開，回報仍然在。

### Task 5: crowd 回報經 mesh 轉傳

**Files:**

- Create: `android/app/src/main/java/com/resilientgeo/mesh/report/CrowdChunkCodec.kt`（一筆回報包成一個 chunk-v0）
- Modify: `android/app/src/main/java/com/resilientgeo/mesh/protocol/ChunkVerifier.kt`（crowd dataset 走裝置金鑰路徑）
- Modify: `android/app/src/main/java/com/resilientgeo/mesh/data/MeshRepository.kt`（`KNOWN_DATASETS` 加入 `crowd-reports`/`crowd.reports`，以及保存上限與淘汰規則）
- Modify: `pipeline/lib/contract.mjs` 的 `verifyChunk`（JS 對應）
- Modify: `simulator/`（只要讓 crowd dataset 不會讓現有模擬報告改變；`npm run sim:check` 必須仍然 PASS）
- Create: `android/app/src/test/java/com/resilientgeo/mesh/report/CrowdChunkCodecTest.kt`
- Modify: `android/app/src/test/java/com/resilientgeo/mesh/emergency/AutoPeerSyncEngineTest.kt`

**Produces:** 附近的手機開著 Emergency Mode 時，crowd 回報會自動在它們之間流通，收到的一方同樣顯示 `UNVERIFIED`。

- [ ] **Step 1: 決定 chunk 包裝方式並寫進 `docs/peer-sync-v0.md`。** 建議做法：
  - `dataset_id = crowd-reports`，`chunk_id = crowd:<event_id>`，`manifest_id = crowd:none`，`manifest_hash` 用 `event.payload_hash`。
  - chunk 由原回報者的裝置金鑰簽，中繼節點不重新簽，這樣可以追溯來源。
  - `dataset_version` 固定為 1，不走官方的整組版本覆蓋規則。
- [ ] **Step 2: 寫失敗測試。** 包含：往返編碼後驗證通過；中繼節點竄改後被拒；crowd chunk 的 `signing_key_id` 與內含事件的 `signing_key_id` 不同時被拒；`computeDiff` 對 crowd dataset 能正確算出缺少的回報。
- [ ] **Step 3: 實作。** 另外加兩項防濫用機制：
  - 單一 chunk 上限 2 KB。
  - 每個節點最多保存 200 筆他人回報，超過時先淘汰已過期的，再淘汰最舊的。
- [ ] **Step 4: JVM 測試、`npm test`、`npm run sim:check` 全過。**
- [ ] **Step 5: 實機驗證（三機）。** A 回報 → B 轉傳 → C 收到。直接讀 C 的 Room，確認事件存在、狀態為 `UNVERIFIED`、`signing_key_id` 是 A 的。結果記錄到 `docs/mvp-remaining-tasks.md` F 段。

### Task 6: 政府端 `attest` 與官方確認事件

**Files:**

- Modify: `pipeline/cli.mjs`（新增 `attest` 指令）
- Create: `pipeline/lib/attest.mjs`
- Create: `pipeline/test/attest.test.mjs`
- Modify: `schemas/event-v0.schema.json`（如果要對 `ATTESTATION` 的 attributes 做結構檢查）
- Modify: `docs/data-contract-v0.md`（確認事件的格式與語意）

**Produces:** `node pipeline/cli.mjs attest --report <file> --verdict CONFIRMED --private-key ... --key-id ...` 會輸出一筆經官方簽章的 `official.verified` 事件。

- [ ] **Step 1: 寫失敗測試。** 包含：
  - 確認事件的格式與簽章。
  - 原回報的裝置簽章無效時拒絕簽發。
  - `target_payload_hash` 必須等於原回報的 `payload_hash`。
  - 同一筆回報再次 attest 時 `event_version` 遞增，讓政府可以改判。
- [ ] **Step 2: 實作。** 確認事件的 `expires_at` 預設等於原回報的 `expires_at`。
- [ ] **Step 3: 上行（demo 版）。** 新增 debug-only 的 Android 匯出，把本機收到的 crowd 回報寫成 JSON 檔（`adb pull` 取出），再交給 `attest`。真的上傳 API 列為後續工作，不在本計畫範圍。
- [ ] **Step 4: 確認事件用既有的 `build` 指令打包成官方分片**，走原本的下行路徑。

### Task 7: 手機端顯示查證結果

**Files:**

- Create: `flutter/lib/data/attestation_index.dart`（把確認事件對應到原回報）
- Modify: `flutter/lib/widgets/map_layers.dart`、`google_map_layers.dart`、`feature_details_sheet.dart`、`notifications_screen.dart`
- Create: `flutter/test/attestation_index_test.dart`

**Produces:** 原回報的顯示狀態依確認事件改變：`CONFIRMED` 顯示為「已查證」，`REFUTED` 預設隱藏，但可以在詳情頁看到「查證為假」。

- [ ] **Step 1: 寫失敗測試。** 包含：
  - `target_payload_hash` 對不上時不套用，因為原回報可能已被新版本取代。
  - 確認事件本身已過期時不套用。
  - 多筆確認事件時取 `event_version` 最高的。
  - 只接受 `official.verified` namespace，crowd 事件冒充 attestation 時不套用。
- [ ] **Step 2: 實作。** 這是純 Dart 的顯示邏輯，Android 的 `ApplyState` 不需要修改。
- [ ] **Step 3: 實機 demo。** A 回報 → mesh → 匯出 → 筆電 `attest` → `build` → 下行分片 → A、B、C 都顯示「已查證」。更新 `experiments/demo.md`。

### Task 8（選做）: 多裝置佐證

**Files:**

- Create: `flutter/lib/data/corroboration.dart`
- Create: `flutter/test/corroboration_test.dart`

- [ ] **Step 1: 定義規則。** 同類型、距離 150 m 內、2 小時內，來自不同 `signing_key_id` 的回報數 ≥ 2，就顯示「N 人回報」。
- [ ] **Step 2: 測試。** 同一金鑰重複回報不重複計數；已過期的回報不計；文字不得出現「驗證」「查證」字樣。
- [ ] **Step 3: 在 `experiments/limitations.md` 寫明弱點。** 一個人用多支手機就能灌票，這不是驗證。

### Task 9: 文件與收尾

- [ ] README：「核心功能」新增民眾回報；更新「限制」段落；「未來工作」移除已完成的部分。
- [ ] `docs/mvp-remaining-tasks.md` F 段：勾選已完成項目。
- [ ] `experiments/limitations.md`：記錄上行仍然是 demo 版檔案匯出、裝置金鑰可以被串連追蹤的隱私問題，以及沒有撤銷機制。
- [ ] 全套驗證：`npm test`、`python -m unittest discover -s tests`、`npm run sim:check`、`./gradlew testDebugUnitTest`、`./gradlew connectedDebugAndroidTest`（實機）、`flutter test`。

## 不在本計畫範圍

- 真的上傳 API 與政府端後台 UI。
- 現場授權人員驗證（授權憑證鏈與撤銷機制）。
- 回報附照片（BLE 頻寬 3.8–4.4 KB/s，照片不適合走 mesh）。
- 信譽評分。
