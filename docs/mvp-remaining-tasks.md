# MVP 剩餘待辦（合併版，不分人）

> 建立日期：2026-09-05
> 取代分工方式：不再按「甲／乙」或「需不需要實機」切分，只按「離 MVP 通過條件有多近」排序。
> 對應文件：`system.md`（開發階段與驗收條件）、`team-assignments.md`（保留原始分工細節與已完成證據）、`docs/review-system-md-2026-09-05.md`（結構性風險分析）

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

- [ ] **6. 回填 ADR-001 與 targetSizeBytes 決策**
  把上述所有真機數據（多輪接觸窗、connection rate 含鎖屏、energy cost）正式寫進 `docs/adr/ADR-001-transport-layer.md` 的實測記錄段落；同時把 `pipeline/lib/bundle.mjs` 的 `targetSizeBytes = 4096`（目前是憑感覺定的數字）換成用「一次典型接觸窗能傳多少 bytes」反推的理由。

---

## B. 建議做（不阻塞 demo 跑起來，但影響可信度／準確度）

- [ ] **7. 用實機數據校準 simulator**
  用上面 1–4 收集到的接觸率、每次接觸吞吐量校準 `simulator/fixtures/sim-config.json`，重跑 `npm run sim:check` 確認位元相同。現有模擬報告能重現，但參數目前是工程估計值，不是實測值。

- [ ] **8. 維護 demo 腳本與限制說明**
  確保 `experiments/{demo,limitations}.md` 跟最新的協定行為（cross-manifest DTN diff、跨接觸續傳、critical-first）對得上；把上面每一項的已知限制（尤其是下面 C 段的架構限制）寫進 `limitations.md`，不要等評審問了才現想。

---

## C. 已知架構限制（v0 不修，但要寫進文件，避免被當成沒發現）

- [ ] **9. 固定大小切分導致版本更新無法真正 delta**
  `manifest.chunking.algorithm` 是 `fixed-size`：v136 → v137 只要有一筆事件變動，同組後面所有 chunk 的邊界就會位移、hash 全變，等於整組重傳。內容導向切分（CDC）或組內單事件對齊可以修，但工作量不小——v0 建議只在 `limitations.md` 寫清楚，不在 hackathon 時限內動这个。（跨 `manifest_id` 的 DIFF 行為本身**已經修好**：`pipeline/lib/peer-sync.mjs` 與 Kotlin 版 `PeerSync.kt` 都已實作「新版本整組覆蓋舊版本」的 DTN 規則並有測試，這點不用再做。）

- [ ] **10. HELLO 表示法會隨資料集線性膨脹**
  目前逐條列舉 chunk（183 chunk＝36 KB），全台規模會膨脹到數百 KB、傳不完。Bloom filter／bitmap 表示法（23 bytes 等級）已寫進 `system.md` §5 當已知擴展路徑，v0 資料量夠小不需要現在實作，維持現狀即可。

---

## D. 真實資料源整合（選用，非 MVP 必要）

- [ ] **11. 接上不需金鑰的三個資料源**（CP 值最高）
  OSM（Overpass）、消防署避難所點位、台北市醫療院所——`pipeline/sources/{osm,shelter,medical}.mjs` 的即時 HTTP 呼叫都已寫好並實測過（9/4 分別抓到 5,939／26／4 筆內湖資料）。剩下的工作只是把 `node pipeline/cli.mjs collect --source <name>` 的輸出接進 `build`（簽章/切片），取代或混合進目前的合成 replay fixture，抓緊做的話幾小時可完成。

- [ ] **12.（時間允許再做）TDX／CWA 即時 API**
  程式碼已完整（`pipeline/sources/tdx.mjs`、`cwa.mjs`），卡在**申請帳號**而非寫程式：需要 TDX Client ID/Secret（tdx.transportdata.tw）與 CWA 開放資料授權碼，两者通常線上申請數小時到一兩天可下來。申請到後只要把金鑰填進 `.env`、跑 `collect` 即可。

- [ ] **13. NCDR 即時 API——建議直接放棄**
  帳號審核本身還在等待中，在 hackathon 時限內基本不可能拿到。直接在 `limitations.md` 標記 `blocked_by_access`，不要花時間等。

---

## 完成標準

- A 段全部打勾：MVP 五個必須項目（平台/地圖/資料/同步/可信度）才算真正達標，不是「紙上已完成」。
- B、C 段是誠信與品質分：沒做完不影響 demo 能不能跑，但影響評審問到細節時答不答得出來。
- D 段是加分項：時間有餘裕才做，優先序 11 > 12 > 13（13 直接跳過）。
