# 路線自動重算

2026-09-27 實作。路線仍由 Android 使用本機離線路網與事件計算；Flutter 負責觸發重算、比較候選避難所及呈現結果。

## 行為

- 規劃路線後，收到道路狀態、避難所狀態、洪水／坡地／土石流危險區或民眾警示的新增、版本變更、移除、套用狀態變更時，自動重算。事件到期也會觸發，不必等 Android 的下一次 30 秒事件通知。
- 改變避難災害情境會重新規劃。一般官方資訊更新、事件順序改變、完全相同的快照重播不會觸發。
- 道路等資料變動時立即清除舊路線，顯示原因。更新合併等待 600 ms；計算中收到更新會丟棄舊結果，等原生請求完成後才啟動最新請求，避免在 Android 佇列累積工作。
- 手動選擇目的地會保留該避難所；「推薦最近避難所」會重新比較候選地點，原推薦地點額滿時可改薦其他可達避難所。畫面顯示目的地名稱。
- App 在背景或切到其他主分頁時暫停新增自動請求；回到地圖會重新檢查到期及等待中的變更。已啟動的原生請求無法取消，仍可完成，但失效結果不會顯示。
- 關閉路線會取消等待中的重算，遲到的結果不會重開畫面。重算失敗會清除舊路線、說明錯誤並提供重試，不會對同一個失敗快照無限重試。
- Android 重建覆蓋層前先釋放舊快取，降低同時保留兩份約 10 MB 陣列的記憶體尖峰；debug 測試 Activity 結束時也會清空路網服務，避免重複啟動堆積大型物件。

## 驗證入口

Flutter 完整測試：258 項通過，`flutter analyze --no-pub` 無問題；Android JVM：142 項通過，含同一份封路資料到期後恢復原路線、移除後清除到期警告。路線流程涵蓋連續更新合併、舊回應丟棄、手動目的地保留、推薦改選、到期、背景恢復、關閉與重試；快照單元測試涵蓋順序、事件種類、到期與移除。

另有僅存在於 debug APK 的 `RouteValidationActivity`，使用正式 `MapScreen`、MethodChannel 與打包雙北路網，固定起點及兩個測試避難所。模擬狀態只存於 Activity 記憶體，不接觸使用者 Room、分片快取、BLE 或定位設定；release APK 不含此 Activity，Dart 驗證入口在 release 不啟動。

```powershell
adb -s <serial> shell am start -n com.resilientgeo.mesh/.debug.RouteValidationActivity
```

操作「推薦最近避難所」後依序使用「額滿測試」、「開放測試」、「到期測試」（12 秒 TTL）及「連續更新測試」（同時發布三個版本）。「暫停重算／恢復重算」驗證主分頁可見性控制；也可按 Home 再返回測試 OS 背景恢復。「計算次數」及 `adb logcat -s RouteValidation` 可確認重算次數與 Android 真實結果。

完整 UI 回歸可使用以下腳本；`--restart-process` 會先重新啟動 App 程序，保留儲存的資料。驗證時先關閉緊急模式。

```powershell
python tools/validation/validate_auto_routes.py --serial <serial> --output .sim-out --restart-process
```

腳本保存每一步的 UI XML、截圖及結果 JSON，依次驗證額滿／開放、三版本合併、暫停／恢復、前景到期、關閉不重開與背景到期後返回。

## 兩機實測結果

Pixel 8a（`41051JEKB12762`）與 Sharp SH-M32（`SX5LFM3571700701`）均以新版 debug APK 通過完整腳本：

| 步驟 | 兩機結果 |
| --- | --- |
| 初始推薦 | B，約 218 m；A 約 950 m |
| B 額滿／重新開放 | 自動改薦 A／恢復推薦 B |
| 同時發布三個版本 | 只觸發一輪比較，原生請求次數 6 → 8 |
| 暫停時更新／恢復 | 暫停期間維持 8 次；恢復後變為 10 次並推薦 B |
| 12 秒 TTL | 先薦 A，到期後自行恢復 B，顯示「事件到期」；native 不發送到期快照 |
| 關閉路線再更新 | 維持 14 次，不重開路線 |
| 背景到期後返回 | 恢復 B，最終 20 次原生請求 |

最終兩次完整實機流程均為 `PASS`。已使用覆蓋安裝保留資料，驗證事件未寫入 Room；測試沒有修改網路、藍牙或定位設定。早期重跑曾因測試 Activity 保留多份路網耗盡 Java heap；修正資源釋放及覆蓋層重建後，用乾淨程序重跑完整流程通過。

原始證據在本機 `.sim-out/<serial>-auto-route-result.json`、`<serial>-auto-route-ui-final.log`、各步驟 XML／PNG；建置與單元測試分別為 `auto-route-android-build-final.log`、`auto-route-full-tests.log`、`auto-route-analyze-final.log`。

完整 mesh 傳入簽章封路、飛航模式及長時間 Doze 的演練仍需獨立驗收；記憶體資料驗證不取代這些項目。
