# 模擬情境：內湖梅雨鋒面

`simulator/fixtures/sim-config.json` 的 `scenario_id: neihu-meiyu-front-v1`。

## 設定

梅雨鋒面滯留台北，基隆河水位偏高，行動網路在內湖部分地區斷續。一批災情資料
（`data/fixtures/neihu/scale-v136.json`，~500 筆事件，涵蓋道路 / 避難所 / 醫療 / 捷運 / 淹水 /
土石流六個主題、五個生活圈）已在斷訊前由伺服器發布。手機使用者開啟 Emergency Mode，
靠 peer sync 補齊彼此缺少的分片。

- **真實 OSM 地物 + 虛構災情。** 幾何（道路線形、學校 / 醫院輪廓、文湖線車站、基隆河 /
  內溝溪）取自 `data/fixtures/neihu/osm-snapshot.json`；災情事件（哪條路封閉、哪個避難所開設、
  哪段邊坡警戒）是合成的，不代表任何真實災況。
- **一次性發布。** 預設矩陣把全部事件的 `issued_at` 設在 round 0，所以 Freshness Lag
  量到的是純傳播時間，coverage 乾淨單調。真正的更新序列（版本遞增）在
  `data/fixtures/neihu/demo-v137.json`，之後的 `--waves` 模式會用到，不納入可重現矩陣。

## 節點與拓撲

- 節點數 10 / 20 / 50 / 100，依 `area_density_weights` 分配到五區（內科最多）。
- 每區有 ~20% 的節點是 gateway（仍有行動網路，可向 server 拉分片）；其餘純 P2P。
  `no-coop` 策略下每個節點都算 gateway。
- 每個 gateway 用自身 seed 決定拉分片的順序 —— 不同手機在斷訊前抓到不同片段，這個
  多樣性是 peer 階段能交換的前提。
- 每回合每個節點最多接觸 `max_peer_count`（4，schema 上限 5）個同區 / 鄰區節點，
  每條邊以 `contact_probability`（0.55）實現。鄰接鏈：
  `西湖 ↔ 內科 ↔ 文德 ↔ 大湖 ↔ 東湖`。
- 24 回合 × 30 秒 = 模擬 12 分鐘。

## 策略

| 策略 | server 拉取 | peer 階段 | REQUEST 排序 |
|---|---|---|---|
| `no-coop` | 全部節點 | 無 | — |
| `replication` | 僅 gateway（+ 缺 flood 分片者 fallback） | 有 | `pipeline/lib/peer-sync.mjs`：CRITICAL>HIGH>NORMAL>LOW，同級小的優先 |
| `rarest-first` | 同上 | 有 | 同上，但 non-CRITICAL 依全域持有數升冪 |

## 地理相關性過濾（`--geo-filter` / matrix `--geo`）

正交開關。開啟時節點只接收 `area_id` 屬於自身或鄰接 area 的分片；`theme=flood`
（全區級河岸淹水警報）一律接收。這模擬 `docs/peer-sync-v0.md` 描述的
「不下載 chunk 就能判斷是否與自身區域相交」。

> 實作註記：過濾以 `area_id` 歸屬判斷，而非 bbox 矩形相交 —— OSM 衍生的分片 bbox 太粗
> （長路段 / 河段），純矩形測試無法區分。bypass 以 `theme=flood` 而非「任何 CRITICAL 分片」
> —— 單一封閉道路是 CRITICAL 但屬地方性，不應讓它穿透過濾。
