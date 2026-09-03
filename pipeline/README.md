# Stage 2 trusted data pipeline

This directory implements the `system.md` phase-2 path with only Node.js built-ins:

1. `sources/tdx-fixture.json` is a TDX-shaped input record.
2. `normalizeTdx()` converts it to an unsigned Event v0.
3. `signEvent()` calculates the canonical SHA-256 payload hash and signs it with Ed25519.
4. `buildBundle()` creates signed fixed-size Chunk v0 records and a signed Manifest v0.
5. `verifyBundle()` verifies the manifest, chunk binding/hash/signature, and every event before APPLY.

The private key is a server-side input. It is never stored in this repository or shipped to an Android client.

## Run

```powershell
npm test

node pipeline/cli.mjs keygen --out-dir .stage2-keys --key-id stage2-demo-2026
node pipeline/cli.mjs build `
  --input pipeline/sources/tdx-fixture.json `
  --out-dir .stage2-bundle `
  --private-key .stage2-keys/private-key.pem `
  --key-id stage2-demo-2026
node pipeline/cli.mjs verify `
  --manifest .stage2-bundle/manifest.json `
  --chunks-dir .stage2-bundle/chunks `
  --public-key .stage2-keys/public-key.pem `
  --now 2026-09-01T08:00:00Z
```

The generated key and bundle directories are local development artifacts and should not be committed.
