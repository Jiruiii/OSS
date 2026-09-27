# resilientgeo_flutter

ResilientGeo 的 Flutter add-to-app 地圖模組；Android host 位於 `../android/`。

## 目前進度（2026-09-27）

- 台灣 MapLibre／PMTiles 底圖、設施／事件標記、回報與路線 UI 已接上 Android bridge；Android 負責驗證、儲存與雙北離線路線計算，Flutter 只呈現結果。
- 道路搜尋在 Android 的背景 isolate 執行，地圖配置／行政區聚合快取，GPS 更新不重建全台標記；修正停止拖動後標記消失及字型／圖示資產路徑。
- Pixel 8a AOT profile：含較長跨市路線的暖機 p95 約 68.6 ms、搜尋運算 p95 約 31.7 ms、街道 Flutter frame total span p95 約 9.1 ms。234 項 Flutter 測試及 analyze 通過。
- 冷啟動道路索引約 6.8 秒在背景準備；跨機型效能與兩機災情改道演練尚待完成。本輪未重跑 Chrome 效能驗收。

完整數據、記憶體成本與重跑命令見 [雙北路線文件](../docs/taipei-offline-routing.md)；工作進度見 [MVP 待辦 G、H 段](../docs/mvp-remaining-tasks.md)。

```bash
flutter analyze --no-pub
flutter test --no-pub --timeout 2m --concurrency 2
```

手機效能測試從 Android host 建立 `:app:assembleProfile -Ptarget-platform=android-arm64`，不要把 debug JIT 的耗時和 AOT profile 混用。Chrome 可預覽地圖與資料，但不提供 Android 的可信路線／回報儲存能力。

## Getting Started

For help getting started with Flutter development, view the online
[documentation](https://flutter.dev/).

For instructions integrating Flutter modules to your existing applications,
see the [add-to-app documentation](https://flutter.dev/to/add-to-app).
