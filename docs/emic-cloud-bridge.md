# EMIC 雲端收集橋接

EMIC 的[官方收容所 XML](https://data.gov.tw/dataset/12849)在臺灣可以讀取，但 GitHub Actions 所在的美國網路連線逾時。Cloudflare Pages Functions 會在請求進入的附近節點執行；實測 GitHub 呼叫預覽函式時落在美國節點，仍無法連接 EMIC。因此 EMIC 使用獨立的 Cloudflare Worker，設定 `placement.region = "gcp:asia-east1"`，讓轉接程式在臺灣附近執行。這個設定是 [Cloudflare Workers Placement Hints](https://developers.cloudflare.com/workers/configuration/placement/) 支援的配置，實際跨區連線仍須於部署後驗證。

橋接 Worker 只接受 `GET /api/emic-shelters`，固定向官方 HTTPS 網址讀取 XML，檢查狀態與資料格式，限制 25 秒及 24 MiB，並回傳官方 `Last-Modified`。GitHub 收集器仍優先直連官方網址，直連失敗才使用已設定的橋接網址，且會檢查固定的 Worker 網域與來源標頭。橋接失敗時沿用原有的來源失敗處理，不會把舊資料宣稱為最新狀態。公開發布仍由原本的 Ed25519 簽章流程處理；橋接 Worker 本身不持有簽章私鑰。

重新部署需要 Cloudflare 帳號的 Workers Script Edit 權限。GitHub 工作流程現有的 Pages 憑證只負責發布簽章 feed；Worker 使用已授權的 Wrangler OAuth 在 repo 根目錄部署：

```powershell
npx wrangler deploy --config pipeline/cloudflare/emic-bridge.wrangler.jsonc
```

目前 Worker 已部署於 <https://resilientgeo-emic-bridge.resilientgeo-mesh.workers.dev/api/emic-shelters>，GitHub Actions 變數 `SHELTER_STATUS_RELAY_ENDPOINT` 也已設定。GitHub 的[唯讀診斷](https://github.com/Jiruiii/OSS/actions/runs/36404841839)確認跨區呼叫取得 7,907 筆官方 XML，並讀到來源 `Last-Modified`。若未設定 Worker 或其連線失敗，正式排程會保留既有有效事件並標記 EMIC 來源不可用。

TDX 道路事件 API 目前實測只接受 12 個縣市代碼。收集器會查詢這 12 個縣市，以及獨立的省道與國道事件端點，總計 14 個端點，依帳號回傳的每分鐘 5 次限制分批查詢。未支援的縣市地方道路沒有對應的 TDX City 端點，不應宣稱完整覆蓋全臺地方道路。
