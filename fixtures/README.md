# Fixtures

Demo 場域是**台北市內湖區**。所有 fixture 幾何取自 OSM 真實地物；**災情事件本身是虛構的**（真實地物 ＋ 虛構災情），不代表任何真實災況。

## 三層資料集（用途不同，勿混用）

| 路徑 | 筆數 | 用途 |
|---|---|---|
| `events-batch-1.json`、`events-batch-2.json`、`expected-results-v0.json` | 3 + 4 | **契約回歸**。刻意小而穩定，涵蓋 5 條套用規則（更新／新增／crowd namespace／版本倒退／過期）。Python replay 測試用。 |
| `neihu/demo-v136.json`、`neihu/demo-v137.json` | ~27 / ~29 | **Demo 敘事**。真實內湖地物，橫跨 5 個 area、6 個 theme，供 A/B/C 多機同步 demo 與 Android UI。v137 是 v136 的增量版本。 |
| `neihu/scale-v136.json` | ~500 | **規模與模擬**。從 OSM 快照生成，補上 `system.md` 階段 0 的「100–1,000 筆測試事件」，供多 chunk 分片與擴散模擬。 |

`neihu/demo-*` 與 `neihu/scale-*` 是 TDX-shaped source 檔，直接餵給 `pipeline/cli.mjs build`。

## 內湖 area 定義

以生活圈劃分，作為 chunk 的天然邊界（`attributes.area_id`）：

| `area_id` | 涵蓋 | 主要災害情境 |
|---|---|---|
| `neihu.xihu` | 西湖捷運站、內湖路一段 | 基隆河沿岸淹水 |
| `neihu.tech-park` | 港墘、瑞光路、洲子街（內科） | 高日間人口、疏散壅塞 |
| `neihu.wende` | 文德路、碧湖公園、內湖路二段 | 邊坡 |
| `neihu.donghu` | 東湖路、康寧路三段、葫洲 | 低窪積水 |
| `neihu.dahu` | 大湖公園、成功路四段、大湖山莊街 | 山坡地土石流 |

每個 area 的 bbox 由該區實際事件幾何計算得出，不手填。

## OSM 快照

`neihu/osm-snapshot.json` 由 `tools/fetch-osm-neihu.mjs` 一次性抓取（內湖區行政區界內的主要道路、學校、醫院、水系、文湖線車站），並提交進 repo。之後所有 fixture 生成都讀這份快照，不再打 Overpass API——這是「報告可重現」的硬性要求。快照的 `meta.fetched_at` 與 `meta.query` 記錄抓取時間與查詢語句。

重新抓取（僅在刻意要更新幾何、且接受 OSM 資料漂移時）：

```powershell
node tools/fetch-osm-neihu.mjs
node tools/generate-neihu-fixtures.mjs
```

## 可直接執行

```powershell
python tools/replay_fixture.py --check
python -m unittest discover -s tests -v
node tools/generate-neihu-fixtures.mjs --check   # 確認 fixture 與生成器輸出一致
```

## 其他 fixture

- `manifest-v136.json`：三個內湖官方 chunk（`dahu:road`、`dahu:shelter`、`xihu:flood`）的索引。
- `peer-a-summary-v0.json`／`peer-b-summary-v0.json`：A/B 的 chunk inventory。
- `protocol-exchange-v0.json`：HELLO、DIFF、REQUEST 的固定交換結果——A 缺 `dahu:shelter` 分片。

fixture 中的 hash 與 signature 是穩定測試 token，不是正式簽章。資料契約與套用規則請見 [`docs/data-contract-v0.md`](../docs/data-contract-v0.md)。
