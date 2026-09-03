# Fixtures

這些檔案是階段 0 的可重播輸入：

- `events-batch-1.json`：初始道路、避難所與豪雨事件。
- `events-batch-2.json`：道路更新、新避難所、不同 namespace 的群眾回報，以及版本倒退。
- `manifest-v136.json`：三個官方 chunk 的索引。
- `peer-a-summary-v0.json`／`peer-b-summary-v0.json`：A/B 的 chunk inventory。
- `protocol-exchange-v0.json`：HELLO、DIFF、REQUEST 的固定交換結果。
- `expected-results-v0.json`：以 `2026-09-01T08:00:00Z` replay 時的預期套用結果。

可直接執行：

```powershell
python tools/replay_fixture.py --check
python -m unittest discover -s tests -v
```

fixture 中的 hash 與 signature 是穩定測試 token，不是正式簽章。資料契約與套用規則請見 [`docs/data-contract-v0.md`](../docs/data-contract-v0.md)。
