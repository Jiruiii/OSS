# Stage 2 trusted data pipeline

This directory implements the `system.md` phase-2 path with only Node.js built-ins:

1. `sources/tdx-fixture.json` is a TDX-shaped input record (a real 內湖區 road).
   `fixtures/neihu/demo-v136.json` and `scale-v136.json` are larger multi-source
   inputs in the same shape.
2. `normalizeSource()` converts a batch to unsigned Event v0, accepting an
   allowed-source list and requiring every record to declare `area_id` / `theme`.
   `normalizeTdx()` is the TDX-only wrapper kept for existing callers.
3. `signEvent()` calculates the canonical SHA-256 payload hash and signs it with Ed25519.
4. `buildBundle()` buckets events by `(area_id, theme)`, then splits each bucket by
   size, into signed Chunk v0 records + a signed Manifest v0. Each chunk and each
   manifest entry carries `area_id`, `theme` and a derived `bbox`.
5. `verifyBundle()` verifies the manifest, chunk binding/hash/bbox/signature, and
   every event before APPLY.

The private key is a server-side input. It is never stored in this repository or shipped to an Android client.

## Run

```powershell
npm test

node pipeline/cli.mjs keygen --out-dir .stage2-keys --key-id neihu-demo-2026

# Curated demo dataset: 5 areas x 6 themes -> ~22 chunks named by area/theme.
node pipeline/cli.mjs build `
  --input fixtures/neihu/demo-v136.json `
  --out-dir .neihu-bundle `
  --private-key .stage2-keys/private-key.pem `
  --key-id neihu-demo-2026
node pipeline/cli.mjs verify `
  --manifest .neihu-bundle/manifest.json `
  --chunks-dir .neihu-bundle/chunks `
  --public-key .stage2-keys/public-key.pem `
  --now 2026-09-01T08:00:00Z

# Scale dataset (~500 events) -> many more chunks; bump target size to taste.
node pipeline/cli.mjs build `
  --input fixtures/neihu/scale-v136.json `
  --out-dir .neihu-scale `
  --private-key .stage2-keys/private-key.pem `
  --key-id neihu-demo-2026 `
  --target-size-bytes 8192
```

The generated key and bundle directories (`.stage2-*`, `.neihu-*`) are local
development artifacts and are gitignored.
