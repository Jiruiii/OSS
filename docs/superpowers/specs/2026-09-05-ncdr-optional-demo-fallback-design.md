# NCDR Optional Demo Fallback Design

## Goal

讓內湖 Demo 不依賴 NCDR 帳號在期限內完成驗證，同時保留未來接回 NCDR live API 的能力。

## Decision

NCDR 是可選的正式災害資料源，不是 Demo 的必要資料源。NCDR 尚未授權時，Demo 使用 repo 內既有的 Neihu replay fixture；所有本地災情資料都必須明確標示為模擬資料，不得宣稱是即時 NCDR 災情。

## Data modes

- `live`：TDX、CWA 或已完成授權的 NCDR API 回應。
- `local_fixture`／replay：固定時間、固定事件、可重現的 Demo 與測試資料。
- NCDR 沒有 key 或未確認完整 endpoint 時，NCDR collector 維持 blocked 狀態，不自動產生空的官方資料。

## Demo source

使用 `data/fixtures/neihu/scenario.json`、`data/fixtures/neihu/update-sequence.json` 與 `pipeline/lib/neihu-replay.mjs`。這些資料使用真實內湖地物幾何搭配虛構災情，可展示道路封閉、淹水、警示過期、避難所狀態更新與多機同步流程。

## Safety and provenance

- `pipeline/.env` 的 NCDR key 與 endpoint 保持空白，待帳號文件核發後再填入。
- NCDR live endpoint 必須以帳號核准文件中的完整資料服務路徑為準。
- Demo 文件必須標示「模擬災害情境，非即時官方災情」。
- 不把 local fixture 當成 NCDR live snapshot，也不把缺少 NCDR 權限當成成功的空資料。

## Acceptance criteria

- 沒有 NCDR key 時，TDX／CWA 與 Neihu replay demo 仍可驗證。
- NCDR collector 的缺少授權狀態仍可被清楚辨識。
- 既有 replay、資料契約與完整測試不受影響。
