import unittest
from pathlib import Path

from tools.replay_fixture import check_expected, load_json, parse_time, replay


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures"


class ReplayFixtureTests(unittest.TestCase):
    def setUp(self):
        self.result = replay(
            FIXTURES / "events-batch-1.json",
            FIXTURES / "events-batch-2.json",
            parse_time("2026-09-01T08:00:00Z", "test time"),
        )

    def test_replay_matches_documented_expectations(self):
        self.assertEqual(
            check_expected(self.result, FIXTURES / "expected-results-v0.json"), []
        )

    def test_newer_version_replaces_old_version(self):
        road = next(
            decision
            for decision in self.result["delta_decisions"]
            if decision["key"] == ["official.tdx", "road:chenggong-4"]
            and decision["result"] == "updated"
        )
        self.assertEqual(road["stored_version_before"], 1)
        self.assertEqual(road["stored_version_after"], 2)

    def test_rollback_is_rejected_without_changing_current_state(self):
        rollback = self.result["delta_decisions"][-1]
        self.assertEqual(rollback["reason"], "version_rollback")
        road = next(
            row
            for row in self.result["current_events"]
            if row[:2] == ["official.tdx", "road:chenggong-4"]
        )
        self.assertEqual(road[2], 2)

    def test_namespace_isolation_and_expiry_are_visible(self):
        self.assertIn(
            ["crowd.community", "road:chenggong-4", 1, "unverified"],
            self.result["current_events"],
        )
        self.assertIn(
            ["official.fire", "shelter:dahu-es", 1, "expired"],
            self.result["current_events"],
        )


if __name__ == "__main__":
    unittest.main()
