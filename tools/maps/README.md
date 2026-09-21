# 台灣 Protomaps PMTiles

Flutter 的 MapLibre 樣式使用五個本機 PMTiles 檔案：

| 檔案 | bbox（minLon,minLat,maxLon,maxLat） | zoom |
| --- | --- | --- |
| `taiwan.pmtiles` | `119.9,21.8,122.2,25.5` | z0–12 |
| `taiwan-north.pmtiles` | `119.9,24.0,122.2,25.5` | z13–15 |
| `taiwan-central.pmtiles` | `119.9,23.0,121.6,24.1` | z13–15 |
| `taiwan-south.pmtiles` | `119.9,21.8,121.6,23.1` | z13–15 |
| `taiwan-east.pmtiles` | `120.8,21.8,122.2,25.5` | z13–15 |

資料來源是 Protomaps daily build；以 Git LFS 管理，不要把大型檔案轉成一般 Git blob。

## 重建與驗證

先安裝 [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli)，再執行：

```bash
git lfs pull
PMTILES_BIN=pmtiles SOURCE_DATE=20260921 \
  ./tools/maps/build_taiwan_pmtiles.sh
```

腳本會對每個 archive 執行 `show --header-json`、`verify` 與 SHA-256。來源日期、bbox、zoom 與目前檔案 hash 也必須同步更新
`flutter/lib/data/offline_map_manifest.dart`，再執行：

```bash
cd flutter
flutter test test/offline_map_manifest_test.dart \
  test/offline_map_package_files_test.dart
```

PMTiles 內容依 OSM／Protomaps 授權保留 attribution；樣式中的 attribution 不可移除。
