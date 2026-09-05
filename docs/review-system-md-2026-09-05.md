# `system.md` 規劃評估

- 評估日期：2026-09-05
- 對象：`system.md`（進度更新 2026-09-04）、`docs/adr/ADR-001-transport-layer.md`、`team-assignments.md`
- 分支：`merge/android-b-into-c-skeleton`（`3fc08c7`）
- 方法：實際執行 `npm test`、`python -m unittest discover -s tests`、`node pipeline/cli.mjs keygen/build`（對 `fixtures/neihu/scale-v136.json`），並讀過 `pipeline/lib/{bundle,peer-sync,geo}.mjs`、`schemas/`、`android/README.md`

---

## 總評

規劃**方向正確、誠實度罕見地高、邊界收斂得好**。會主動寫「尚未開始」「不能視為完成」「原規劃的 1MB/10MB 是壓力測試數字不是實際酬載」；有 ADR、有停止條件、有「不宣稱什麼」的段落——這在 hackathon 規模的專案裡很少見，值得保持。

真正的風險不在進度落後，而在**三個假設從來沒被數字檢驗過**：

| # | 假設 | 現況 |
| --- | --- | --- |
| C1 | 「KB 級酬載，BLE 3–6 KB/s 夠用」 | 用單筆事件大小論證，不是用一次同步的實際傳輸量 |
| C2 | Peer 之間交換同一份 manifest 的分片 | 這是 BitTorrent 模型，跟 DTN 前提衝突 |
| C3 | HELLO 的 peer summary 傳得完 | 逐條列舉，隨資料集線性膨脹 |

這三個現在都還在「改文件、改 schema 就能修」的階段。等階段 3 程式寫完才發現，成本會高一個數量級。**建議動階段 3 的程式碼之前，先花半天把 C1 和 C2 的設計決定寫下來。**

---

## 一、和題目的對應：方向對，但價值主張放錯位置

題目模擬的情境是**「有訊號但被降到 256 kbps」**（行政院 8/10 演練），不是完全斷網。這點很關鍵：

| | 吞吐量 |
| --- | --- |
| 降速後的行動網路 | 256 kbps ≈ **32 KB/s** |
| BLE GATT 實測 | **3–6 KB/s** |

也就是說，**在題目真正模擬的那個情境裡，從 peer 拿資料比直接從基地台拿慢 5–10 倍**。但 ADR-001 採用 BLE 的理由之一寫的是「最貼近災難情境下不需要任何網路基礎設施」——這是往「完全斷網」的場景偏了。

Mesh 在降速情境的價值不是「更快」，而是題目自己第五點講的：**避免同一份資料被 100 個人從基地台重複下載**。但 `system.md` §1 的五個目標裡，這件事排在第 3 點、而且措辭是「交換缺少的事件分片」（手段），不是「減少重複下載」（價值）；§7 指標表也只有 Cellular Savings 一列碰到它。

**建議**：把 §1 目標的第一順位改成「減少重複下載、把稀缺的總頻寬留給還沒拿到的人」。

這直接影響 demo 說服力：

- 如果 demo 是「兩台飛航模式互傳」→ 評審會問「那為什麼不用 CBS / 衛星？」
- 如果 demo 是「10 台共用 256 kbps，一台下載、九台從 peer 拿到」→ 才對得上題目

---

## 二、文件與 repo 現況不符

### 2.1 測試數字錯了，而且有一項真的是紅的（阻塞）

`system.md` 開頭寫「`npm test` 的 Node 測試 16 項通過」。實際跑的結果是 **20 項，19 通過、1 失敗**：

```
not ok 7 - the committed Neihu fixtures match a fresh deterministic generation
    MISMATCH: fixtures/neihu/demo-v136.json is stale; re-run without --check
    MISMATCH: fixtures/neihu/demo-v137.json is stale; re-run without --check
    MISMATCH: fixtures/neihu/scale-v136.json is stale; re-run without --check
```

**根因不是生成器不決定性，是 Windows 行尾。** `core.autocrlf=true` 且 repo 沒有 `.gitattributes`：checkout 出來的 fixture 是 CRLF，`tools/generate-neihu-fixtures.mjs` 的 `stableStringify` 寫的是 LF，`--check` 逐位元組比對就 MISMATCH。

**修法**（10 分鐘）：新增 `.gitattributes`

```
*.json text eol=lf
*.mjs  text eol=lf
```

然後 `git add --renormalize .` 重新正規化一次。

> 這是低成本但高價值的修正：現在任何 Windows 隊員 clone 下來 `npm test` 就是紅的，會侵蝕整組人對測試的信任。

Python 測試 4 項確實通過，這部分文件正確。

### 2.2 指令不存在

`android/README.md` 有三處叫人執行 `npm run generate:android-fixture`，但 `package.json` 只有 `test` 一個 script。這個指令現在跑不起來。

### 2.3 MVP 定義自相矛盾

§1 第 5 點把「量測資料擴散速度、節省的行動流量與耗電量」列為專案目標，但 §2 的「MVP 必須完成」清單裡沒有任何量測項目——量測被推到階段 4。兩處對「MVP 是什麼」的定義不一致，建議擇一。

---

## 三、三個沒被數字檢驗的假設

### C1：「KB 級酬載所以 BLE 夠用」這個論證方式是錯的

ADR-001 的結論是「實際酬載是 KB 級事件記錄，3–6 KB/s 夠用」。用 repo 自己的 pipeline 實測（`fixtures/neihu/scale-v136.json`，500 筆）：

```
node pipeline/cli.mjs keygen --out-dir <k> --key-id t1
node pipeline/cli.mjs build  --input fixtures/neihu/scale-v136.json \
                             --out-dir <b> --private-key <k>/<id>.private.pem
```

| 項目 | 實測 | BLE @ 4 KB/s |
| --- | --- | --- |
| 簽章後 chunk 總量 | 1.18 MB（183 片，平均 6.5 KB，最大 46.6 KB） | **289 秒（≈ 4.8 分）** |
| `manifest.json` | 104 KB | **26 秒** |
| HELLO peer summary（183 條 × 202 B） | 36 KB | **9 秒單向、18 秒雙向** |

問題在於：opportunistic contact（走路擦身、同節車廂、避難所排隊）的典型接觸窗大概 **10–60 秒**。把 30 秒的窗口拆開來看：

**情境 A — 雙方都已有 manifest（30 秒窗 = 120 KB 預算）**

```
HELLO A->B   36 KB  ########             9s
HELLO B->A   36 KB  ########             9s
實際 chunk   48 KB  ###########         12s   -> 約 7 / 183 片（約 4%）
                    ----------------------
                    120 KB              30s
```

**情境 B — 首次相遇，對方尚無 manifest**

```
manifest    104 KB  #######################   26s
HELLO 雙向   72 KB  ################          18s
                    ------------------------------
                    176 KB                    44s   X 超出 30 秒窗 47%
```

**首次相遇的節點連握手都做不完。** 這是最需要成功的一次相遇（對方什麼都沒有），卻是最做不到的一次。

這不代表方案錯——DTN 本來就是慢慢擴散——但代表兩件事要重想：

- **`targetSizeBytes = 4096`（`pipeline/lib/bundle.mjs:105`）是憑什麼定的？** 應該從接觸窗口回推，而不是拍一個 4 KB。
- **續傳能力在傳輸層有、協定層沒接上。** `BleGattTransport` 已驗證位元組級續傳，但 `pipeline/lib/peer-sync.mjs` 的 `buildRequest()` 硬寫 `offset_bytes: 0`（註解自承「v0 always requests from offset 0」）。在這個吞吐量下，**跨接觸續傳**是最關鍵的能力，現在是斷的。

**建議**：階段 3 之前先補一項量測——**「一次典型接觸能同步多少 bytes」**。它比 10/20/50/100 節點模擬更早需要，因為它是模擬器的**輸入參數**。這也正好給現在無事可做的 D 一個有真實輸入的起點，不必空等。

---

### C2：`computeDiff` 在 manifest_id 不同時直接 throw——跟 DTN 前提衝突

`pipeline/lib/peer-sync.mjs:50`：

```js
if (localDataset.manifest_id !== remoteDataset.manifest_id) {
  throw new RangeError(
    `manifest mismatch for ${namespace}/${datasetId}: `
    + `local=${localDataset.manifest_id} remote=${remoteDataset.manifest_id}`,
  );
}
```

這假設「所有節點對同一份 manifest 交換分片」——那是 **BitTorrent swarm 模型**（大家下載同一個檔案的不同片）。

但題目要的是 **DTN 模型**：A 帶著 v137 走進一個大家還停在 v136 的避難所。**這正是最有價值的一次相遇**，而現在的協定會直接拒絕。

repo 自己就有 `fixtures/neihu/demo-v136.json` / `demo-v137.json` 兩個版本，卻沒有任何跨版本 diff 的測試。這是我認為 `system.md` 最需要補的一段設計。v0 至少要決定：

- 以 `(namespace, event_id, event_version)` 為單位比對，而不是以 `chunk_id`？還是
- 定義「較新 manifest 覆蓋較舊」的規則，先傳 manifest 再 diff？

#### C2 延伸：固定大小切分讓版本更新無法 delta

`manifest.chunking.algorithm` 標的是 `'fixed-size'`。這表示 v136 → v137 只要有**一筆**事件變動，該組後面所有 chunk 的邊界就會位移、hash 全變、**整份要重傳**。對 delta sync 是致命的。

程式碼裡先按 `(area_id, theme)` 分組（`pipeline/lib/bundle.mjs:32`）是對的方向——把爆炸半徑限制在同一個 area/theme 內——但組內仍是 byte-size 累積切分（`bundle.mjs:69`），**組內任一筆變動仍會位移該組後續所有邊界**。

要讓未變動的 chunk hash 保持穩定，需要：

- 內容導向切分（CDC / rolling hash），或
- 組內穩定排序 + 單事件對齊（一片 N 筆固定，不看 byte size）

順帶：這件事和 C1 的 chunk 大小決策是同一個設計，應該一起決定。

---

### C3：HELLO 沒有壓縮表示法，會隨資料集線性膨脹

`schemas/peer-summary-v0.schema.json` 目前是把每個 chunk 的 `chunk_id` / `chunk_hash` / `size_bytes` / `priority` / `state` 逐條列出（實測單條 202 bytes）。

| 資料集規模 | chunk 數 | HELLO 大小 | BLE @ 4 KB/s |
| --- | --- | --- | --- |
| 內湖 500 筆（現況） | 183 | 36 KB | 9 秒 |
| 全台 TDX+CWA+NCDR（推估） | 數千 | 數百 KB | **傳不完** |

標準做法是 **Bloom filter** 或**對 manifest 順序的 bitmap**（有／沒有各 1 bit → 183 chunk = **23 bytes**，差 1500 倍）。

v0 不一定要實作，但**應該寫進 `system.md` §5 或 `docs/peer-sync-v0.md` 當作已知的擴展路徑**——否則等階段 3 才發現要改協定格式時，schema 已經被三個模組依賴了。

---

## 四、兩個「已宣告通過但證據不足」的地方

### 4.1 階段 0 的相容性條件其實沒過

ADR-001 自己誠實列出了這點，但 `system.md` §6 把階段 0 的通過條件寫成「**已達成**」，而 §8 風險表的停止條件是「傳輸層只能在單一機型運作」。

目前兩台都是 **Pixel、同 API 37**——**還沒有證據排除這個停止條件**。BLE GATT 的 MTU 協商、advertise 支援、GATT server 併發在不同廠商（三星 One UI、小米）差異是出了名的大。

而 `C_BLEbroadcast.md` 裡就記載了一台 **Samsung SM-S731B（Android 16, API 36）**——已經在手上。用那台補測是**最便宜的高價值驗證**。

**建議**：階段 0 標成「**條件通過（pending 相容性）**」，並把 Samsung 補測排進本週。

### 4.2 背景執行只驗證了 15 秒

Doze 是這類 App 最經典的殺手。`system.md` §8 寫「MVP 使用前景服務與明確 Emergency Mode」，但 `android/app/.../transport/` 底下目前**全是 Activity，沒有任何 foreground service**。

三機 Store-Carry-Forward 需要中繼那台手機在口袋裡移動時還活著——這是一個**已經寫在計畫裡、實作還沒開始、而且會直接卡住階段 3** 的項目。

**建議**：把「實作 Emergency Mode foreground service」從計畫裡的一句話，升級成階段 3 的明列待辦，排在協定接線之前或同時。

---

## 五、階段 3 這個包裹太大

現行階段 3（第 3–4 週）要一次完成：協定接線 + 斷線續傳 + Peer 上限 + critical-first 排程 + 三機 SCF + 五機擴展。

但協定層與傳輸層**從來沒接過線**——`send` / `resume` 現在走的還是 Stage 0 spike 的隨機測試 payload。建議拆開：

| 子階段 | 內容 | 為什麼單獨 |
| --- | --- | --- |
| **3a** | HELLO/DIFF/REQUEST 序列化上 `BleGattTransport`，兩機交換**一個**真 chunk，通過 `EventVerifier` 寫進 Room | 這是唯一真正的整合風險點，值得單獨當里程碑 |
| **3b** | 跨接觸續傳（接上 `offset_bytes`）、Peer 上限、critical-first | 依賴 3a 打通 |
| **3c** | 三機 Store-Carry-Forward | 依賴 3b + foreground service |
| ~~3d~~ | ~~五機實機擴展~~ | 時間緊就砍掉用模擬器代替，邊際資訊量遠低於成本 |

同時，階段 4 的「10/20/50/100 節點模擬」所需的參數（接觸率、每次接觸吞吐量）只能從 3a/3b 拿到——這也是 D 現在真的沒東西可做的原因。讓 D 提前接手 C1 提的接觸窗口量測，才有真實輸入。

---

## 建議動作（依 CP 值排序）

| # | 動作 | 負責 | 估時 | 對應 |
| --- | --- | --- | --- | --- |
| 1 | 加 `.gitattributes` 修掉假失敗的測試，順手把 `system.md` 的「16 項通過」改成實際數字 | A | 10 分 | §2.1 |
| 2 | 修正 ADR-001 的「夠用」論證：改用「一次接觸能傳多少」而非「單筆事件多大」 | C | 30 分（純文件） | C1 |
| 3 | 用手上的 Samsung SM-S731B 補相容性測試，階段 0 改標「通過（含相容性）」 | C | 1–2 小時 | §4.1 |
| 4 | 決定跨 `manifest_id` 的 diff 行為，寫進 `docs/peer-sync-v0.md` 並補測試 | A + C | 半天 | C2 |
| 5 | 決定 chunk 切分策略（大小 + 是否內容導向），和 4 一起做 | A | 併入上項 | C2 延伸 |
| 6 | 階段 3 拆成 3a/3b/3c，3a 單獨當里程碑；foreground service 明列 | 全員 | 規劃會 | §4.2、§5 |
| 7 | 補上 `generate:android-fixture` script | B | 5 分 | §2.2 |
| 8 | §1 目標第一順位改成「避免重複下載」，讓 demo 敘事對上 256 kbps 情境 | 全員 | 30 分 | §一 |
| 9 | 把 HELLO 的 Bloom filter / bitmap 表示法寫進 §5 當已知擴展路徑 | C | 30 分 | C3 |

---

## 附錄：本次評估實際執行的指令

```bash
npm test
#   -> 20 tests, 19 pass, 1 fail (neihu-fixtures determinism, CRLF 假失敗)

python -m unittest discover -s tests -v
#   -> 4 tests, OK

node pipeline/cli.mjs keygen --out-dir <tmp>/k --key-id t1
node pipeline/cli.mjs build --input fixtures/neihu/scale-v136.json \
                            --out-dir <tmp>/b --private-key <tmp>/k/<id>.private.pem
#   -> 183 chunks / 1,184,094 bytes / manifest 106,628 bytes

git config core.autocrlf   # -> true（且無 .gitattributes）
```

> 註：評估過程中曾誤跑 `tools/generate-neihu-fixtures.mjs`（未帶 `--check`）覆寫 `fixtures/neihu/`，已用 `git checkout --` 完整還原，工作區乾淨。
