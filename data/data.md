# 內湖區資料說明

範圍：臺北市內湖區。資料分為 Live、Demo／測試 fixture、Derived 三類。

## 1. Live 真實資料

| 資料 | 位置 | 用途 |
|---|---|---|
| TDX 道路事件 | `data/live/tdx/2026-09-04/` | 道路事故、施工、封閉與交通事件 |
| CWA 地震 | `data/live/cwa/2026-09-04/earthquake/` | 地震與震度資料 |
| CWA 天氣警報 | `data/live/cwa/2026-09-04/weather-warning/` | 臺北市豪雨等縣市警報 |
| OSM | `data/live/osm/2026-09-04/` | 道路、醫院、學校、水系與捷運等地物 |
| 避難所 | `data/live/shelter/2026-09-04/` | 避難所位置、容量與適用災害 |
| 醫療院所 | `data/live/medical/2026-09-04/` | 醫院位置與基本資料 |

每個 Live 來源通常包含：

```text
*.raw.json                 原始 API 回應
*.events.json              正規化災害／道路事件
*.features.json            正規化地物資料
collection-metadata.json   抓取時間、筆數與來源狀態
```

重新抓取資料：

```bash
node --env-file=pipeline/.env pipeline/cli.mjs collect \
  --source tdx-road-events \
  --out-dir data/live/tdx/$(date +%F)
```

其他來源只需替換 `--source` 與輸出資料夾。可用的 `source-id` 包含：
`tdx-road-events`、`cwa-earthquake`、`cwa-weather-warning`、
`osm-neihu`、`taipei-shelter`、`taipei-medical`。

## 2. Demo／測試模擬資料

位置：`data/fixtures/neihu/`

| 檔案 | 用途 |
|---|---|
| `manifest.json` | Replay 入口 |
| `scenario.json` | 內湖 Demo 情境設定 |
| `update-sequence.json` | 道路、豪雨、淹水、避難所狀態更新 |
| `cwa-events.json` | 模擬 CWA 地震事件 |
| `ncdr-events.json`、`ncdr-hazard-raw.json` | 模擬 NCDR 災害事件 |
| `demo-v136.json`、`demo-v137.json` | Demo 敘事資料 |
| `scale-v136.json` | 約 500 筆規模測試資料 |

模擬資料使用真實內湖地物，但災害事件是虛構的，必須標示：

```text
模擬災害情境，非即時官方災情
```

執行 Replay：

```bash
node --test pipeline/test/neihu-replay.test.mjs
```

## 3. Derived 衍生資料

位置：`data/derived/`

目前尚未產生資料。之後可放置 DEM／DSM 坡度、孤立風險、通訊脆弱度與
SAR／光學影像判釋等分析結果。

API 金鑰放在 `pipeline/.env`，不可放入任何資料檔或提交 Git。
