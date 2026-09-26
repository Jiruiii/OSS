import gzip
from pathlib import Path
import tempfile
import unittest

from tools.maps.build_taipei_walk_graph import make_graph, walking_direction, write_graph


class TaipeiWalkGraphTest(unittest.TestCase):
    def test_access_and_pedestrian_direction(self):
        self.assertEqual(0, walking_direction({'highway': 'motorway'}))
        self.assertEqual(0, walking_direction({'highway': 'footway', 'foot': 'no'}))
        self.assertEqual(0, walking_direction({'highway': 'service', 'access': 'private'}))
        self.assertEqual(3, walking_direction({'highway': 'service', 'access': 'private', 'foot': 'yes'}))
        self.assertEqual(3, walking_direction({'highway': 'residential', 'oneway': 'yes'}))
        self.assertEqual(1, walking_direction({'highway': 'footway', 'oneway:foot': 'yes'}))
        self.assertEqual(2, walking_direction({'highway': 'footway', 'oneway:foot': '-1'}))

    def test_shared_junction_survives_simplification_but_crossings_are_not_joined(self):
        graph = make_graph([
            (1, 'footway', 3, [(1, (121.5, 25)), (2, (121.5001, 25)), (3, (121.5002, 25))]),
            (2, 'footway', 3, [(4, (121.5001, 24.9999)), (2, (121.5001, 25)), (5, (121.5001, 25.0001))]),
            (3, 'footway', 3, [(6, (121.5001, 25)), (7, (121.5002, 25.0001))]),
        ])
        nodes, edges, start, _flat, components, sizes, _ng, _eg = graph
        self.assertEqual(2, len(sizes))
        junctions = [n for n, p in enumerate(nodes) if p == (121.5001, 25)]
        self.assertEqual(2, len(junctions))
        self.assertIn(4, [start[n+1]-start[n] for n in junctions])

    def test_sparse_roads_receive_snap_nodes_and_are_indexed_at_cell_boundaries(self):
        graph = make_graph([(1, 'footway', 3, [(1, (121.4999, 25)), (2, (121.502, 25))])])
        nodes, edges, *_ = graph
        self.assertTrue(all(e[2] <= 60.01 for e in edges))
        self.assertGreater(len(nodes), 2)
        self.assertIn((12149, 2500), graph[-1])
        self.assertIn((12150, 2500), graph[-1])

    def test_output_is_deterministic(self):
        graph = make_graph([(1, 'footway', 1, [(1, (121.5, 25)), (2, (121.5001, 25))])])
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp)/'a.gz', Path(temp)/'b.gz'
            write_graph(a, 'test-v1', graph)
            write_graph(b, 'test-v1', graph)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertTrue(gzip.decompress(a.read_bytes()).startswith(b'RGMWALK1'))


if __name__ == '__main__':
    unittest.main()
