# 政府資料自動更新與離線轉傳

政府 API → Node 收集器 → Ed25519 簽章 feed / manifest / chunk / event → Cloudflare Pages → Android 驗證 → Room 與 BLE 快取 → 附近手機。

地圖、避難點靜態清單、步行路網仍隨 App 打包。這次新增的是 NCDR 警報、氣象署地震／天氣警特報／颱風、TDX 道路事件及 EMIC 收容所動態狀態更新。沒有網路時，查圖、已下載事件、避難路線與 BLE 同步仍獨立運作；未取得動態狀態時，不把打包的收容所清單當成目前開放。

## 更新時間與免費方案

- App 在前景每 5 分鐘檢查一次，也有手動更新。背景用 Android JobScheduler 設定 15 分鐘週期，實際執行由系統網路、電量與休眠政策控制。
- 正式服務網址：<https://resilientgeo-feed.pages.dev/>，已建立 Pages 並首次部署。App 預設下載臺北、新北與全臺警報，可在政府資料更新頁選擇全臺；只改下載範圍，不修改政府原始事件的幾何。全臺資料與 BLE 清單較大，轉傳需要更長接觸時間。
- GitHub Actions 預設每 2 小時收集與部署（UTC 偶數小時的第 17 分鐘，每月最多 372 次排程）；Cloudflare Pages 官方首頁列出 Free 每月 500 次部署，保留手動部署餘額。其他專案使用同一帳號的額度也要算入。
- 這是定期更新，**不是政府更新後立即推送**。TDX 無來源有效期限時預設只保鮮 15 分鐘；2 小時發布方案中間可能顯示過期，不能拿較久的發布間隔延長道路資料的有效期。需要較高頻率時，先確認平台額度，或將同一收集器部署到常駐主機與可更新物件的儲存服務。
- GitHub 排程可能延後，公開 repo 無活動 60 天也可能停用排程。App 顯示每個來源最近成功取得時間，不能用手機下載成功時間代表所有政府來源都已更新。
- 來源各自最多處理 3 分鐘；失敗／超時的來源標為無法取得，其他來源仍發布。座標不足的 EMIC 記錄不猜測位置，來源顯示部分資料。

參考：[Pages 限制](https://developers.cloudflare.com/pages/platform/limits/)、[Pages 首頁](https://developers.cloudflare.com/pages/)、[GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。

## 本機啟動

需要 Node 22 或更新版本。所有命令在 repo 根目錄執行。

```powershell
# 本工作區已建立這組 key；再次執行會沿用，不會覆寫私鑰。
node pipeline/tools/setup-government-key.mjs
# 首次發布才使用 --initial，後續保留 .government-public 的簽章狀態。
node --env-file=pipeline/.env pipeline/government-publisher.mjs --initial
node --env-file=pipeline/.env pipeline/government-publisher.mjs
node pipeline/serve-government.mjs
```

私鑰在 `.stage2-keys/government-feed/private-key.pem`，已被 Git 忽略；Android 只打包公開金鑰。發布前會比對私鑰對應的公開金鑰是否與 App 信任設定一致。不要另生成一把私鑰給 CI，否則已安裝的手機會拒收。

正式服務建立後，本機收集也應設定 `GOVERNMENT_FEED_URL=https://resilientgeo-feed.pages.dev/`。收集前會比對公開版本與本機版本，沿用較新的帳本；同版本不同內容會中止。部署前再次比對，拒絕覆寫較新的公開版本。只啟用一個正式收集排程，避免多個發布器同時競爭。

USB debug 測試可用 `adb -s <serial> reverse tcp:8787 tcp:8787`，手機「個人設定 → 政府資料更新」填 `http://127.0.0.1:8787/`。只有 debug 版允許 localhost HTTP；正式版要求 HTTPS，拒絕帳密、query、fragment 與跨網址 redirect。

## 免費 Cloudflare Pages 正式部署

1. 在 Cloudflare 建立 **Direct Upload** Pages 專案，例如 `resilientgeo-feed`。取得實際的 `https://<project>.pages.dev/`，不用另外購買網域。
2. 在自己的 Cloudflare 帳號建立可編輯該帳號 Pages 的 API token，取得 Account ID。不要把 token 貼進聊天、App 或 repo。
3. GitHub repository Actions Secrets 設定：

| Secret | 內容 |
| --- | --- |
| `GOVERNMENT_SIGNING_PRIVATE_KEY` | 本工作區政府發布私鑰 PEM 的完整內容（含換行） |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Pages 部署 token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `NCDR_ALERT_API_KEY` | NCDR API key |
| `CWA_API_KEY` | 氣象署 API key |
| `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` | TDX OAuth 憑證 |

4. Actions Variables 設定 `CLOUDFLARE_PAGES_PROJECT` 為專案名稱、`GOVERNMENT_FEED_URL` 為上述網址，尾端可含 `/`。
5. 將本次程式與 `.github/workflows/government-feed.yml` 提交到 repo 預設分支。在 Actions 執行「Publish signed government feed」，**只有第一次**勾選 `initial`。之後不勾選；新 runner 會從公開服務下載並驗證上一版的版本帳本及事件，避免版本回退。若上一版取不到，整次發布失敗，不重設帳本。
6. 確認服務 `/feed.json` 回傳已簽章 JSON，再在兩台手機填入同一網址、啟用自動更新並手動更新一次。

本工作區已有正式網址，不要再選 `initial`。使用已登入的 GitHub CLI 可協助設定上述 Secrets：將 Pages token 存成被 Git 忽略的 `.stage2-keys/cloudflare-api-token.txt`（僅 token 一行），先執行 `node pipeline/tools/configure-government-github.mjs` 唯讀檢查，再加 `--apply` 設定。腳本會比對 App 公鑰、檢查專案存取權，並以標準輸入寫入 GitHub 加密 Secret；不列印憑證，也不把 token 放入命令參數。帳號登入的 OAuth 憑證不會複製到 CI。

也可從本機發布：設定上述 Cloudflare 三個環境變數，執行 `node pipeline/deploy-government.mjs`。先加 `--prepare-only` 可產生並審查上傳資料夾；只會包含驗證過的 feed、目前引用的 chunks、固定首頁與標頭，**不會上傳 `.env`、私鑰或原始 API 回應**。每次建立新的上傳資料夾，不把累積的舊發布版本一起部署。

正式線上狀態以 `/feed.json` 與手機來源時間為準。只有本機測試通過，不能視為 Cloudflare 上線完成。

## 資料安全與事件生命週期

- Feed、manifest、chunk、event 都需使用已打包的政府發布公開金鑰驗證；下載內容不能引入新的信任金鑰。
- Manifest 綁定資料集、命名空間、版本與逐塊 hash。只允許同一更新服務下固定的版本路徑。回應有大小限制，連線／讀取有逾時。
- 同版內容衝突、版本回退、過期 feed、毀損資料皆拒絕。完成整個下載與儲存後才記錄成功游標；中途失敗可重試，已驗證的事件仍可離線使用。
- 已存在的同版快取不重新下載；若快取遺失，會補抓。內容不變的政府事件保持版本，來源資料包也保持版本；只有變動的資料集發布新包。
- 短暫網路錯誤、HTTP 429 或 5xx 最多嘗試三次，間隔 1／2 秒；簽章錯誤不重試。重試失敗保留已取得資料，不記錄成功游標。
- 手機 BLE 快取上限調為 32 MiB；政府單次發布限制為 24 MiB、最多 4096 個 chunks，每塊最多 256 KiB，保留空間給民眾通報與舊版本。這避免全臺約 11 MB 的收容所／道路資料反覆超過舊 8 MB 上限、每次重新下載。
- 收集大量事件時，用共用且受鎖保護的快取大小計數，避免每寫一塊都重讀所有 JSON。建立 BLE HELLO 時仍會檢查實際快取與 Room 是否一致。
- BLE 請求依位元組數增加等待時間，上限 5 分鐘；送出資料的一方會等自己正在服務的 REQUEST 結束，再結束連線。較大的政府區域圖形不會只因原本 5 秒的接收窗口而被切斷。
- 簽章版本帳本保留曾用過的事件版本，即使事件已過期，稍後再次出現也不會被 Room 當成舊版本拒絕。
- API 失敗或項目從清單消失，不等同解除警報／道路重新開放。保留上次事件到它自己的有效期，來源新回應可更新該事件。
- NCDR CAP `Cancel` 或 `Update` 的明確 references，可對舊事件產生較高版本、已過期的簽章撤回事件；保留發布 24 小時，讓離線 BLE 能轉傳解除狀態。來源明確把既有事件有效期改成過去，也會發布失效事件。
- 線上來源使用 `official.live.*`，民眾通報仍是獨立命名空間。
- 不發布原始 source_record 與含 API key 的 request provenance；發布保留正規化的來源名稱、描述、範圍、狀態與來源有效期。NCDR 已被正規化判定為不顯示的行政背景資料不進入這個行動更新 feed。

## 驗證

```powershell
node --test pipeline/test/*.test.mjs simulator/test/*.test.mjs
# Flutter 與 Android 常規測試見各模組 README。
# 配對實機測試使用獨立記憶體 Room 與暫存快取，不清除正式資料。
node pipeline/tools/prepare-government-hardware-feed.mjs
```

硬體測試從本機真實 API 收集結果挑一筆仍有效事件，建立測試發布 feed；不使用合成事件替代。HTTP 經 USB localhost 供來源手機下載，確認第二次同步不重抓，接著關閉兩手機 Wi-Fi / 行動數據，確認無 activeNetwork，透過真正的 BLE 讓另一手機接收、驗證、寫入 Room 並提供後續轉傳。測試前記錄網路與藍牙設定，測試後復原。這項測試證明下載至離線傳播的流程，公開 HTTPS 部署需另行驗證。

### 本工作區部署與驗證狀態

- 已建立 `resilientgeo-feed` Direct Upload 專案，正式網址為上述 `pages.dev` 服務，公開 revision 3 的 2,679 個 chunks 均完成 Node 簽章與內容驗證。
- Sharp 最終 APK 的公開 HTTPS 實機測試通過：臺北／新北與全臺警報範圍取得 574 個 chunks、1,656 筆事件，再次同步下載 0 個 chunks；正式 App 也已保存 revision 3。七項獨立 Room／快取一致性實機測試通過。測試紀錄：`.sim-out/government-sharp-public-final.log`，耗時 93.73 秒。
- Node／模擬器 193 項、Flutter 259 項、Android JVM 152 項測試通過；Flutter analyze 無問題。
- GitHub 部署 Secrets 與 Variables 已設定；工作流程發布與第一次 Actions 驗證進行中。排程是否可正常發布，以 Actions 成功結果與公開版本增加為準。
- 政府大型警報的 BLE 測試曾發現傳送方過早結束連線；修正已通過延遲傳輸單元測試。兩手機最終實機重測因 Pixel USB 斷線尚未完成，不能將單元測試視為實機通過。
