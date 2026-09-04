# Stage 2 trusted data pipeline

This directory implements the `system.md` phase-2 path with only Node.js built-ins.

## Task 3: TDX road events

`pipeline/sources/tdx.mjs` separates the complete TDX response from the curated
Neihu events:

1. `collect` obtains the Taipei City Road Events response with OAuth2 client credentials and writes a secret-free `raw-snapshot-v0`.
2. `normalize` adapts the TDX `Events` envelope into unsigned `event-v0` records, preserves the original source record in `attributes.source_record`, and keeps only records whose town and WGS84 geometry match the official Neihu boundary.
3. `build` signs the curated events and creates the existing Manifest v0 and Chunk v0 bundle.

The Raw snapshot keeps out-of-Neihu events for audit and later re-curation. The
collector does not calculate route cost, congestion indices, or district
statistics. TDX credentials are read only from `TDX_CLIENT_ID` and
`TDX_CLIENT_SECRET`; they are never written to Raw, fixtures, logs, or the
Android bundle.

Live collection:

```bash
# Fill TDX_CLIENT_ID and TDX_CLIENT_SECRET in the local, gitignored pipeline/.env first.
node --env-file=pipeline/.env pipeline/cli.mjs collect --source tdx-road-events --out-dir data/live/tdx/2026-09-04
```

This creates `tdx-road-events.raw.json`, `tdx-road-events.events.json`, and
`collection-metadata.json`. Without both credentials, the command exits with a
clear missing-credential error before making a network request.

Fixture mode does not require credentials:

```bash
node pipeline/cli.mjs normalize \
  --source tdx-road-events \
  --input data/fixtures/neihu/tdx-raw-batch-1.json \
  --out /tmp/tdx-events.json
```

`data/fixtures/neihu/tdx-raw-batch-1.json` is a sanitized response-shaped local
fixture, not a live TDX capture. It is explicitly marked `local_fixture` until
an authenticated response can be recorded.

## Task 4: CWA and NCDR dynamic hazards

The CWA source adapters cover significant earthquakes (`E-A0015-001`) and
county or city weather warnings (`W-C0033-001`). The optional NCDR adapter
consumes the JSON alert datastore route configured in `NCDR_API_ENDPOINT`. It
converts earthquake observations, weather warnings, flood, rainfall,
debris-flow and landslide alerts into unsigned `event-v0` records, preserves
the source record, and filters geometry against the official Neihu boundary.
City-level warnings are retained with `attributes.coverage_level=city`; they
are not presented as Neihu-specific measurements.

Live collection:

```bash
node --env-file=pipeline/.env pipeline/cli.mjs collect --source cwa-earthquake --out-dir data/live/cwa/2026-09-04/earthquake
node --env-file=pipeline/.env pipeline/cli.mjs collect --source cwa-weather-warning --out-dir data/live/cwa/2026-09-04/weather-warning
node --env-file=pipeline/.env pipeline/cli.mjs collect --source ncdr-hazard-events --out-dir data/live/ncdr/2026-09-04
```

Set `CWA_API_KEY` for CWA. Run the NCDR command only after the account is
approved and the complete `NCDR_API_ENDPOINT` is confirmed in the account API
documentation. A missing key or unauthorized response writes
`collection-metadata.json` with `source_status=blocked_by_access` and exits
non-zero. Raw snapshots never contain the CWA query key or NCDR token.

NCDR access is optional for the deadline Demo. When NCDR is unavailable, use
the deterministic Neihu simulation/replay data instead:

```bash
node --test pipeline/test/neihu-replay.test.mjs
```

The replay entry is `data/fixtures/neihu/manifest.json`; it uses
`data/fixtures/neihu/scenario.json` and `data/fixtures/neihu/update-sequence.json` to
exercise road closure, flood, warning expiry and shelter state transitions.
These are fictional disaster events on real Neihu feature geometry and must be
displayed as simulation data, not current NCDR alerts.

Fixture normalization does not require credentials:

```bash
node pipeline/cli.mjs normalize --source cwa-earthquake \
  --input data/fixtures/neihu/cwa-earthquake-raw.json --out /tmp/cwa-earthquake-events.json
node pipeline/cli.mjs normalize --source cwa-weather-warning \
  --input data/fixtures/neihu/cwa-warning-raw.json --out /tmp/cwa-warning-events.json
node pipeline/cli.mjs normalize --source ncdr-hazard-events \
  --input data/fixtures/neihu/ncdr-hazard-raw.json --out /tmp/ncdr-events.json
```

Expired alerts remain in the cached event batch with `expires_at`; downstream
verification decides whether they are current. The collector does not assign a
risk score.

## Task 5: OSM, shelters and medical static layers

Task 5 keeps three different products separate:

- OSM roads and selected POIs become `feature-v0` records in `osm-road` and
  `osm-poi` layers.
- Shelter location, address, capacity and supported disaster types remain
  static `feature-v0` properties. If a source response includes opening status,
  it is emitted separately as an unsigned `SHELTER_STATUS` Event for the later
  event signing step; the point file without that field does not create an
  artificial `UNKNOWN` status.
- Taipei medical institutions become `feature-v0` records in the `medical`
  layer. The original source row is retained in `properties.source_record`.

Every normalizer preserves the Raw snapshot, filters against the official
WGS84 Neihu boundary, validates `[longitude, latitude]`, and does not calculate
routes, nearest shelters, capacity pressure, coverage, slope or risk scores.

Static source replay:

```bash
node pipeline/cli.mjs normalize --source osm-neihu \
  --input data/fixtures/neihu/osm-raw.json --out /tmp/osm-features.json
node pipeline/cli.mjs normalize --source taipei-shelter \
  --input data/fixtures/neihu/shelter-raw.json --out /tmp/shelter-features.json
node pipeline/cli.mjs normalize --source taipei-medical \
  --input data/fixtures/neihu/medical-raw.json --out /tmp/medical-features.json
```

Live public-source collection writes both `<source>.raw.json` and
`<source>.features.json`:

```bash
node --env-file=pipeline/.env pipeline/cli.mjs collect --source osm-neihu --out-dir data/live/osm/2026-09-04
node --env-file=pipeline/.env pipeline/cli.mjs collect --source taipei-shelter --out-dir data/live/shelter/2026-09-04
node --env-file=pipeline/.env pipeline/cli.mjs collect --source taipei-medical --out-dir data/live/medical/2026-09-04
```

Sign one static layer at a time. The resulting layer package has a separate
`layer-manifest-v0`, `layer-chunk-v0`, `features.json`, and `chunks/` directory;
it does not use the dynamic event `build` command:

```bash
node pipeline/cli.mjs build-layer \
  --input /tmp/shelter-features.json --out-dir .stage5-shelter-bundle \
  --private-key .stage2-keys/private-key.pem --key-id neihu-static-2026
node pipeline/cli.mjs verify-layer \
  --manifest .stage5-shelter-bundle/manifest.json \
  --chunks-dir .stage5-shelter-bundle/chunks \
  --public-key .stage2-keys/public-key.pem
```

`SHELTER_DATA_ENDPOINT`, `MEDICAL_DATA_ENDPOINT` and `OSM_API_ENDPOINT` are
optional public endpoint overrides in `pipeline/.env`. API credentials and private keys
remain local and are never included in Raw snapshots or bundles.

## Task 7: Neihu replay fixture

`data/fixtures/neihu/manifest.json` loads the deterministic replay scenario through
`pipeline/lib/neihu-replay.mjs`. The loader combines the fixed transition
records in `update-sequence.json` with fixed-ID road records until the event
arrival count reaches 100. It never uses random IDs or the current clock.

The replay harness keeps Raw snapshots, event records and static feature
snapshots separate:

- Event identity is `(namespace, event_id)`. A newer `event_version` replaces
  the stored event; an older version is rejected. `crowd.road` is an
  unverified namespace and cannot overwrite `official.tdx`.
- Expired events remain in the cached state projection with `state=expired`.
  Crowd events are marked `unverified` while they are not expired.
- Static features use `(layer_id, feature_id)` plus `snapshot_version`.
  Repeated hospital content is reported as unchanged rather than mixed into
  the event stream.
- Raw records marked outside the Neihu filter remain available for audit; the
  replay harness does not silently discard them.

The fixture uses stable structural signatures for replay tests. Production
event and feature bundles still require the existing Ed25519 verification
path.

Run the replay checks directly:

```bash
node --test pipeline/test/neihu-replay.test.mjs
```

## Existing signed bundle flow

1. `sources/tdx-fixture.json` is a TDX-shaped input record (a real 內湖區 road).
   `data/fixtures/neihu/demo-v136.json` and `scale-v136.json` are larger multi-source
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
  --input data/fixtures/neihu/demo-v136.json `
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
  --input data/fixtures/neihu/scale-v136.json `
  --out-dir .neihu-scale `
  --private-key .stage2-keys/private-key.pem `
  --key-id neihu-demo-2026 `
  --target-size-bytes 8192
```

The generated key and bundle directories (`.stage2-*`, `.neihu-*`) are local
development artifacts and are gitignored.
