#!/usr/bin/env python3
"""Build a reproducible, pre-indexed walking graph from an OSM PBF.

The extent is the union bounding box of Taipei/New Taipei's checked-in official
county boundaries plus a small border buffer. OSM node IDs preserve topology:
geometrically crossing bridges/tunnels are not accidentally joined.
The legacy Neihu JSON is deliberately retained as a regression fixture.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
import time

CLASSES = ["footway", "path", "pedestrian", "steps", "residential",
           "living_street", "service", "unclassified", "tertiary", "secondary",
           "primary", "track", "cycleway", "tertiary_link", "secondary_link", "primary_link"]
ROOT = Path(__file__).resolve().parents[2]
MAGIC = b"RGMWALK1"


def walking_direction(tags):
    if tags.get("highway") not in CLASSES or tags.get("area") == "yes":
        return 0
    foot = tags.get("foot", "").lower()
    if foot in ("no", "private", "use_sidepath"):
        return 0
    if tags.get("access") in ("no", "private") and foot not in ("yes", "designated", "permissive"):
        return 0
    # Vehicle one-way restrictions do not imply pedestrian one-way restrictions.
    return {"yes": 1, "1": 1, "true": 1, "-1": 2}.get(tags.get("oneway:foot"), 3)


def distance(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(h)))


def make_graph(ways):
    # Never simplify a shared OSM node (a junction). Between junctions, RDP
    # removes sub-metre geometry noise; long segments receive snap nodes so
    # shelter/origin matching is not defeated by sparse OSM vertices.
    shared = Counter(ref for w in ways for ref, _ in w[3])
    def simplify(line):
        keep = {0, len(line)-1}
        keep.update(i for i, (ref, _) in enumerate(line) if shared[ref] > 1)
        anchors = sorted(keep)
        stack = list(zip(anchors, anchors[1:]))
        scale_x, scale_y = 111195 * math.cos(math.radians(25)), 111195
        while stack:
            first, last = stack.pop()
            ax, ay = line[first][1][0]*scale_x, line[first][1][1]*scale_y
            bx, by = line[last][1][0]*scale_x, line[last][1][1]*scale_y
            dx, dy = bx-ax, by-ay
            denom = dx*dx + dy*dy
            best, index = 1.0, -1
            for i in range(first+1, last):
                px, py = line[i][1][0]*scale_x, line[i][1][1]*scale_y
                t = max(0, min(1, ((px-ax)*dx + (py-ay)*dy)/denom)) if denom else 0
                error = (px-ax-t*dx)**2 + (py-ay-t*dy)**2
                if error > best:
                    best, index = error, i
            if index >= 0:
                keep.add(index)
                stack.extend(((first, index), (index, last)))
        return [line[i] for i in sorted(keep)]
    nodes, ids, edges = [], {}, []
    def node(ref, point):
        if ref not in ids:
            ids[ref] = len(nodes)
            nodes.append(point)
        return ids[ref]
    for way_id, road_class, direction, raw_points in sorted(ways, key=lambda w: w[0]):
        points = simplify([(ref, (round(point[0],7),round(point[1],7))) for ref,point in raw_points])
        for segment, ((ref_a, a), (ref_b, b)) in enumerate(zip(points, points[1:])):
            if ref_a == ref_b or a == b:
                continue
            steps = max(1, math.ceil(distance(a, b)/60))
            previous, previous_point = node(ref_a, a), a
            for step in range(1, steps+1):
                fraction = step/steps
                point = b if step == steps else (round(a[0]+(b[0]-a[0])*fraction,7), round(a[1]+(b[1]-a[1])*fraction,7))
                ref = ref_b if step == steps else (way_id, segment, ref_a, ref_b, step)
                current = node(ref, point)
                edges.append((previous, current, distance(previous_point, point), way_id, CLASSES.index(road_class), direction))
                previous, previous_point = current, point
    adjacency = [[] for _ in nodes]
    for e, (a, b, *_rest) in enumerate(edges):
        adjacency[a].append(e)
        adjacency[b].append(e)
    start, flat = [0], []
    for members in adjacency:
        flat.extend(members)
        start.append(len(flat))
    component, sizes = [-1]*len(nodes), []
    for first in range(len(nodes)):
        if component[first] >= 0:
            continue
        cid, count, stack = len(sizes), 0, [first]
        component[first] = cid
        while stack:
            a = stack.pop()
            count += 1
            for edge in adjacency[a]:
                u, v = edges[edge][:2]
                b = v if u == a else u
                if component[b] < 0:
                    component[b] = cid
                    stack.append(b)
        sizes.append(count)
    node_grid, edge_grid = defaultdict(list), defaultdict(list)
    for n, (lon, lat) in enumerate(nodes):
        node_grid[(math.floor(lon/.001), math.floor(lat/.001))].append(n)
    for e, (a, b, *_rest) in enumerate(edges):
        p, q = nodes[a], nodes[b]
        for x in range(math.floor(min(p[0], q[0])/.01), math.floor(max(p[0], q[0])/.01)+1):
            for y in range(math.floor(min(p[1], q[1])/.01), math.floor(max(p[1], q[1])/.01)+1):
                edge_grid[(x, y)].append(e)
    return nodes, edges, start, flat, component, sizes, node_grid, edge_grid


def write_graph(output, version, graph):
    nodes, edges, start, flat, component, sizes, node_grid, edge_grid = graph
    def integers(file, values):
        # Chunked packing also works for large regions without huge argument lists.
        for i in range(0, len(values), 8192):
            chunk = values[i:i+8192]
            file.write(struct.pack(f">{len(chunk)}i", *chunk))
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, filename="") as f:
        f.write(MAGIC)
        for text in (version, "雙北及邊界緩衝區"):
            encoded = text.encode("utf-8")
            f.write(struct.pack(">i", len(encoded)))
            f.write(encoded)
        f.write(struct.pack(">ii", len(nodes), len(edges)))
        for lon, lat in nodes:
            f.write(struct.pack(">ii", round(lon*1e7), round(lat*1e7)))
        for a, b, length, way, cls, direction in edges:
            f.write(struct.pack(">iifqBB", a, b, length, way, cls, direction))
        integers(f, start)
        integers(f, flat)
        integers(f, component)
        f.write(struct.pack(">i", max(range(len(sizes)), key=sizes.__getitem__) if sizes else -1))
        for grid in (node_grid, edge_grid):
            f.write(struct.pack(">i", len(grid)))
            for (x, y), members in sorted(grid.items()):
                f.write(struct.pack(">iii", x, y, len(members)))
                integers(f, members)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-pbf", required=True, type=Path)
    parser.add_argument("--source-date", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--boundary", type=Path, default=ROOT / "data/boundaries/geojson/county.geojson")
    parser.add_argument("--output", type=Path, default=ROOT / "android/app/src/main/assets/routing/taipei-walk.rgmz")
    args = parser.parse_args()
    started = time.perf_counter()
    digest = hashlib.file_digest(args.input_pbf.open("rb"), "sha256").hexdigest()
    if digest != args.source_sha256.lower():
        parser.error("source SHA-256 mismatch")
    boundary_bytes = args.boundary.read_bytes()
    boundary = json.loads(boundary_bytes)
    points = []
    def visit(coords):
        if isinstance(coords[0], (int, float)):
            points.append(coords)
        else:
            for c in coords:
                visit(c)
    for feature in boundary["features"]:
        if feature["properties"].get("COUNTYCODE") in ("63000", "65000"):
            visit(feature["geometry"]["coordinates"])
    if not points:
        parser.error("Taipei/New Taipei county boundaries missing")
    buffer = .02
    west, south = min(p[0] for p in points)-buffer, min(p[1] for p in points)-buffer
    east, north = max(p[0] for p in points)+buffer, max(p[1] for p in points)+buffer
    import osmium
    ways = []
    class Handler(osmium.SimpleHandler):
        def way(self, w):
            tags = {t.k: t.v for t in w.tags}
            direction = walking_direction(tags)
            if not direction:
                return
            line = []
            # Keep only segments wholly in the buffered extent. Shared OSM
            # refs remain identical on both sides of every municipal boundary.
            for n in w.nodes:
                if n.location.valid() and west <= n.location.lon <= east and south <= n.location.lat <= north:
                    line.append((n.ref, (n.location.lon, n.location.lat)))
                else:
                    if len(line) >= 2:
                        ways.append((w.id, tags["highway"], direction, line))
                    line = []
            if len(line) >= 2:
                ways.append((w.id, tags["highway"], direction, line))
    Handler().apply_file(str(args.input_pbf), locations=True, idx="sparse_mem_array")
    graph = make_graph(ways)
    version = f"taipei-new-taipei-{args.source_date}-{digest[:8]}-s1m"
    write_graph(args.output, version, graph)
    nodes, edges, _s, _a, _c, sizes, _ng, _eg = graph
    manifest = {
        "schema_version": "rgm-walk-v1", "graph_version": version,
        "coverage": "Taipei City and New Taipei City, with border buffer",
        "bounds": [west, south, east, north], "snapshot_at": args.source_date,
        "source_url": args.source_url, "source_sha256": digest,
        "boundary_sha256": hashlib.sha256(boundary_bytes).hexdigest(),
        "attribution": "© OpenStreetMap contributors (ODbL)",
        "nodes": len(nodes), "edges": len(edges), "ways": len(ways),
        "components": len(sizes), "largest_component_nodes": max(sizes, default=0),
        "bytes": args.output.stat().st_size,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
        "road_classes": CLASSES,
        "simplification_tolerance_m": 1, "max_snap_segment_m": 60,
    }
    args.output.with_suffix(".rgm.manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({**manifest, "build_seconds": round(time.perf_counter()-started, 2)}, ensure_ascii=True))


if __name__ == "__main__":
    main()
