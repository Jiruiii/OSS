# MVP 剩餘待辦（合併版，不分人）

> 建立日期：2026-09-05
> 取代分工方式：不再按「甲／乙」或「需不需要實機」切分，只按「離 MVP 通過條件有多近」排序。
> 對應文件：`system.md`（開發階段與驗收條件）、`team-assignments.md`（保留原始分工細節與已完成證據）、`docs/review-system-md-2026-09-05.md`（結構性風險分析）
>
> **2026-09-05 更新：黑客松明天截止，真實資料源整合（原 D 段：OSM/避難所/醫療接線、TDX/CWA 申請金鑰、NCDR）全部砍掉，不做。** 現有的可重播 fixture 已經滿足 MVP §2「先接一個官方或可重播的測試資料源」的定義，時間不夠不是妥協，是本來就不需要。以下只保留剩下時間內真正做得到、也值得做的項目。

---

## A. 阻塞 MVP 通過條件（必須完成才能宣告 MVP 達標）

- [ ] **1. Samsung SM-S731B 跨機型相容性補測**（階段 0）
  目前兩台測試機都是 Pixel、同 API 37，尚未排除「傳輸層只能在單一機型運作」的停止條件。用手上已有的 Samsung 重跑 discovery／connect／transfer，階段 0 才能從「條件通過」轉正。

- [ ] **2. Connection success rate 跨機型 + 正式 service 重跑**
  先前 17/20（85%，亮屏）與鎖屏 0/19（0%）的數字是用 Pixel + 甲的 stub service 量到的。要在 Samsung 上重跑一次，並改用正式 `EmergencyModeService`（非 stub）重跑鎖屏情境，確認結論不是機型或 stub 版本特有的偶然現象。

- [ ] **3. 背景／鎖屏存活驗證換版重跑**
  正式骨架把「App 啟動就常駐」改成「開關驅動啟停」，生命週期改變後要重跑一次鎖屏心跳測試，確認先前 176 秒不間斷心跳的存活結論仍成立。

- [ ] **4. 三機 Store-Carry-Forward 驗證**（階段 3 的核心通過條件，目前完全還沒測）
  用 Samsung 當第三台裝置，驗證 A 不直接連 C 時，更新仍能經 B 到達 C，且全程通過簽章驗證、沒有重複從伺服器下載完整資料集。

- [ ] **5. Energy Cost 分析補進報告**（階段 4 通過條件之一）
  原始 CSV（60 秒 scan-only 22.35 mW、scan+傳輸 26.78 mW）已收集，只差整理進 `experiments/results/report.md` 的 Energy Cost 欄位。

- [x] **6. 回填 ADR-001 與 targetSizeBytes 決策**（2026-09-05 完成）
  多輪接觸窗（3.8–4.4 KB/s）、connection rate（亮屏 17/20、鎖屏 0/19）、energy cost（22.35→26.78 mW）都已寫進 `docs/adr/ADR-001-transport-layer.md`「回填」段落；`pipeline/lib/bundle.mjs` 的 `targetSizeBytes = 4096` 保留原值，但補上用接觸窗吞吐量反推的理由（4096 bytes 在 3.8–4.4 KB/s 下約 1–1.5 秒傳完，符合最短 10 秒接觸窗的需求）。

- [x] **（額外修復，不在原始清單內）BleGattTransport 訊息序號 race bug**（2026-09-05 完成）
  team-assignments.md 記錄的「跨接觸續傳疊加 critical-first 時收到雜訊 payload、後續 chunk ack 逾時」的深層限制已修好：每個 GATT write 加 1-byte 訊息序號，接收端用 `(peer address, seq)` 取代單一 peer 一個 slot。修復過程中在真機上又抓到一個新 bug（sender 端記錄中斷 seq 的表被無關的後續訊息成功清掉）並修正。兩輪 Pixel 7 ↔ Pixel 8a 實機驗證，logcat 佐證 `interrupted → 其他 3 個 chunk 正常送達 → resume 成功組出完整訊息`，無雜訊、無逾時。細節見 `team-assignments.md` 該條目與 commit `cabf6ca`。

---

## B. 建議做（不阻塞 demo 跑起來，但影響可信度／準確度）

- [x] **7. 用實機數據校準 simulator**（2026-09-05 完成，部分）
  `max_bytes_per_round` 已從憑感覺的 24576 校準成 `3,819 B/s（10 秒短窗最保守量測）× 30s = 114,570`，`npm run sim:check` 通過位元比對。順帶抓到一個真的設定檔問題：`p2p_throughput_bytes_per_sec: 131072` 這個欄位是舊的高頻寬候選（Nearby Connections/Wi-Fi Direct）遺留下來的數字，**simulator 程式碼從來沒讀過它**——真正生效的一直是 `max_bytes_per_round`，已移除該死欄位並在 `notes` 說明，避免有人以為那才是模擬用的吞吐量。`contact_probability`（0.55）與 `transfer_failure_prob`（0.06）維持工程估計值不變——這兩個是社交接觸機率／傳輸失敗率模型，目前的實機數據（BLE 吞吐量、connection success rate）沒有直接對應到這兩個參數，硬套會是假精確，寧可留著工程估計標籤。

- [ ] **8. 維護 demo 腳本與限制說明**
  確保 `experiments/{demo,limitations}.md` 跟最新的協定行為（cross-manifest DTN diff、跨接觸續傳、critical-first）對得上；把上面每一項的已知限制（尤其是下面 C 段的架構限制）寫進 `limitations.md`，不要等評審問了才現想。

---

## C. 已知架構限制（v0 不修，但要寫進文件，避免被當成沒發現）

- [ ] **9. 固定大小切分導致版本更新無法真正 delta**
  `manifest.chunking.algorithm` 是 `fixed-size`：v136 → v137 只要有一筆事件變動，同組後面所有 chunk 的邊界就會位移、hash 全變，等於整組重傳。內容導向切分（CDC）或組內單事件對齊可以修，但工作量不小——v0 建議只在 `limitations.md` 寫清楚，不在 hackathon 時限內動这个。（跨 `manifest_id` 的 DIFF 行為本身**已經修好**：`pipeline/lib/peer-sync.mjs` 與 Kotlin 版 `PeerSync.kt` 都已實作「新版本整組覆蓋舊版本」的 DTN 規則並有測試，這點不用再做。）

- [ ] **10. HELLO 表示法會隨資料集線性膨脹**
  目前逐條列舉 chunk（183 chunk＝36 KB），全台規模會膨脹到數百 KB、傳不完。Bloom filter／bitmap 表示法（23 bytes 等級）已寫進 `system.md` §5 當已知擴展路徑，v0 資料量夠小不需要現在實作，維持現狀即可。

---

## 不做（明確排除，寫在這裡是為了不要有人半夜手癢又撿回來做）

- ~~真實資料源接線（OSM/避難所/醫療無金鑰三源、TDX/CWA 申請金鑰、NCDR）~~——明天截止，時間不夠。MVP 定義本來就允許用可重播 fixture，不算縮水。demo/limitations 文件裡照實寫「災情資料為可重播模擬資料，非即時官方資料」即可（`docs/neihu-online-data-sources.md` 已經有這段話可以直接引用）。

---

## 完成標準

- A 段全部打勾：MVP 五個必須項目（平台/地圖/資料/同步/可信度）才算真正達標，不是「紙上已完成」。
- B、C 段是誠信與品質分：沒做完不影響 demo 能不能跑，但影響評審問到細節時答不答得出來，時間允許就做，卡時間就先跳過、留在 limitations 裡誠實說沒做完。
