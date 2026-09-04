# Data layout

The Neihu data products use three layers with different provenance:

```text
data/
├── live/
│   └── <source>/<YYYY-MM-DD>/
│       ├── raw snapshot
│       ├── curated events or features
│       └── collection-metadata.json
├── fixtures/
│   └── neihu/
└── derived/
```

## `data/live/`

This contains local outputs from authenticated or public source collection.
Raw snapshots preserve the source response; curated files are the Neihu-filtered
and normalized output. Each collection date has its own directory so a refresh
does not overwrite an earlier snapshot. Live data and derived outputs are
ignored by Git because they are mutable and may be large.

## `data/fixtures/neihu/`

This contains deterministic Demo and test inputs. CWA/NCDR disaster events in
these fixtures are simulated and must be labelled as simulation data, not as
current official alerts. The OSM geometry used by the fixture is a real,
timestamped snapshot.

## `data/derived/`

This is reserved for later analysis products such as slope, isolation,
communication-vulnerability, or image-derived hazard results. Collectors do
not write risk scores here.

API keys, Authorization headers, private keys, and personal GNSS coordinates
must never be stored in any data directory.
