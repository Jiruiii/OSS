#!/usr/bin/env python3
"""Validate the exact runtime graph name/bytes after Android asset packaging."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    args = parser.parse_args()
    with zipfile.ZipFile(args.apk) as apk:
        name = 'assets/routing/taipei-walk.rgmz'
        manifest = json.loads(apk.read('assets/routing/taipei-walk.rgm.manifest.json'))
        digest = hashlib.sha256()
        with apk.open(name) as graph:
            first = graph.read(8)
            assert first.startswith(b'\x1f\x8b'), 'packager decompressed the graph'
            digest.update(first)
            for chunk in iter(lambda:graph.read(1024*1024), b''):
                digest.update(chunk)
        assert digest.hexdigest() == manifest['sha256'], 'packaged graph hash mismatch'
        assert apk.getinfo(name).compress_type == zipfile.ZIP_STORED, 'graph was recompressed'
        assert 'assets/routing/walk-roads.json' in apk.namelist(), 'legacy Neihu graph missing'
        for entry in apk.infolist():
            if entry.filename.endswith('.pmtiles'):
                assert entry.compress_type == zipfile.ZIP_STORED, 'PMTiles was recompressed'
        print(json.dumps({'graph_version':manifest['graph_version'],'bytes':manifest['bytes'],'sha256':digest.hexdigest(),'legacy_preserved':True}))


if __name__=='__main__':
    main()
