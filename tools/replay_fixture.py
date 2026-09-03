#!/usr/bin/env python3
"""Replay the phase-0 event fixtures and check v0 state-transition rules.

The production Ed25519 pipeline lives under ``pipeline/``. This legacy
fixture tool intentionally keeps its structural trust stub so the original
phase-0 examples remain dependency-free and deterministic.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SHA256_RE = re.compile(r"^sha256:[0-9A-Fa-f]{64}$")
EVENT_REQUIRED = {
    "schema_version",
    "namespace",
    "event_id",
    "event_type",
    "geometry",
    "severity",
    "source",
    "source_version",
    "event_version",
    "issued_at",
    "expires_at",
    "attributes",
    "payload_hash",
    "signature",
    "signature_algorithm",
    "signing_key_id",
    "provenance",
}
SEVERITIES = {"LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"}
GEOMETRY_TYPES = {
    "Point",
    "LineString",
    "Polygon",
    "MultiPoint",
    "MultiLineString",
    "MultiPolygon",
    "GeometryCollection",
}


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"expected an object in {path}")
    return value


def parse_time(value: Any, field_name: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be an RFC 3339 string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} is not a valid RFC 3339 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field_name} must include a timezone")
    return parsed.astimezone(timezone.utc)


def validate_event(event: Any) -> list[str]:
    """Return structural v0 errors without requiring a third-party schema lib."""

    if not isinstance(event, dict):
        return ["event must be an object"]

    errors: list[str] = []
    missing = sorted(EVENT_REQUIRED - event.keys())
    if missing:
        errors.append(f"missing required fields: {', '.join(missing)}")

    if event.get("schema_version") != "event-v0":
        errors.append("schema_version must be event-v0")

    for field in ("namespace", "event_id", "event_type", "source", "source_version"):
        if not isinstance(event.get(field), str) or not event[field]:
            errors.append(f"{field} must be a non-empty string")

    if event.get("severity") not in SEVERITIES:
        errors.append("severity is not a v0 value")

    version = event.get("event_version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        errors.append("event_version must be a positive integer")

    issued_at: datetime | None = None
    expires_at: datetime | None = None
    for field in ("issued_at", "expires_at"):
        try:
            parsed = parse_time(event.get(field), field)
        except ValueError as exc:
            errors.append(str(exc))
        else:
            if field == "issued_at":
                issued_at = parsed
            else:
                expires_at = parsed
    if issued_at is not None and expires_at is not None and expires_at < issued_at:
        errors.append("expires_at must not precede issued_at")

    geometry = event.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") not in GEOMETRY_TYPES:
        errors.append("geometry must be a supported GeoJSON geometry object")
    elif geometry["type"] == "GeometryCollection":
        if not isinstance(geometry.get("geometries"), list):
            errors.append("GeometryCollection.geometries must be an array")
    elif not isinstance(geometry.get("coordinates"), list):
        errors.append("geometry.coordinates must be an array")

    if not isinstance(event.get("attributes"), dict):
        errors.append("attributes must be an object")

    if not isinstance(event.get("payload_hash"), str) or not SHA256_RE.fullmatch(
        event.get("payload_hash", "")
    ):
        errors.append("payload_hash must match sha256:<64 hex characters>")

    signature = event.get("signature")
    if not isinstance(signature, str):
        errors.append("signature must be a base64 string")
    else:
        try:
            if not base64.b64decode(signature, validate=True):
                errors.append("signature must not decode to an empty value")
        except (ValueError, base64.binascii.Error):
            errors.append("signature is not valid base64")

    if event.get("signature_algorithm") != "Ed25519":
        errors.append("signature_algorithm must be Ed25519")
    if not isinstance(event.get("signing_key_id"), str) or not event["signing_key_id"]:
        errors.append("signing_key_id must be a non-empty string")

    provenance = event.get("provenance")
    if not isinstance(provenance, dict):
        errors.append("provenance must be an object")
    else:
        if not isinstance(provenance.get("original_source"), str) or not provenance["original_source"]:
            errors.append("provenance.original_source must be a non-empty string")
        try:
            parse_time(provenance.get("received_at"), "provenance.received_at")
        except ValueError as exc:
            errors.append(str(exc))
        transport_source = provenance.get("transport_source")
        if not isinstance(transport_source, dict) or transport_source.get("kind") not in {
            "upstream",
            "server",
            "peer",
            "local_fixture",
        }:
            errors.append("provenance.transport_source.kind is not a v0 value")

    return errors


def _fixture_verified(event: dict[str, Any]) -> bool:
    """Use the fixture key namespace as a deliberate, non-production trust stub."""

    return isinstance(event.get("signing_key_id"), str) and event["signing_key_id"].startswith(
        "fixture-"
    )


def apply_event(
    store: dict[tuple[str, str], dict[str, Any]], event: dict[str, Any]
) -> dict[str, Any]:
    errors = validate_event(event)
    key = [event.get("namespace"), event.get("event_id")]
    if errors:
        return {
            "key": key,
            "result": "rejected",
            "reason": "invalid_event",
            "errors": errors,
        }
    if not _fixture_verified(event):
        return {
            "key": key,
            "result": "rejected",
            "reason": "untrusted_fixture_signer",
        }

    identity = (event["namespace"], event["event_id"])
    current = store.get(identity)
    if current is None:
        same_event_other_namespace = any(
            existing_event_id == event["event_id"]
            and existing_namespace != event["namespace"]
            for existing_namespace, existing_event_id in store
        )
        store[identity] = event
        return {
            "key": key,
            "result": (
                "inserted_separate_namespace"
                if same_event_other_namespace
                else "inserted"
            ),
            "incoming_version": event["event_version"],
            "reason": (
                "crowd_namespace_cannot_overwrite_official_namespace"
                if same_event_other_namespace
                else "new_verified_event"
            ),
        }

    current_version = current["event_version"]
    incoming_version = event["event_version"]
    if incoming_version > current_version:
        store[identity] = event
        return {
            "key": key,
            "result": "updated",
            "stored_version_before": current_version,
            "incoming_version": incoming_version,
            "stored_version_after": incoming_version,
            "reason": "newer_verified_version",
        }
    if incoming_version < current_version:
        return {
            "key": key,
            "result": "rejected",
            "stored_version_before": current_version,
            "incoming_version": incoming_version,
            "reason": "version_rollback",
        }
    return {
        "key": key,
        "result": "rejected",
        "stored_version_before": current_version,
        "incoming_version": incoming_version,
        "reason": "same_version_conflict",
    }


def _event_state(event: dict[str, Any], evaluation_time: datetime) -> str | None:
    if evaluation_time >= parse_time(event["expires_at"], "expires_at"):
        return "expired"
    if event["namespace"].startswith("crowd."):
        return "unverified"
    return None


def _current_projection(
    store: dict[tuple[str, str], dict[str, Any]], evaluation_time: datetime
) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for (namespace, event_id), event in store.items():
        row: list[Any] = [namespace, event_id, event["event_version"]]
        state = _event_state(event, evaluation_time)
        if state is not None:
            row.append(state)
        rows.append(row)
    return sorted(rows, key=lambda row: (row[0], row[1]))


def replay(
    initial_path: Path, delta_path: Path, evaluation_time: datetime
) -> dict[str, Any]:
    initial = load_json(initial_path)
    delta = load_json(delta_path)
    initial_events = initial.get("events")
    delta_events = delta.get("events")
    if not isinstance(initial_events, list) or not isinstance(delta_events, list):
        raise ValueError("both fixtures must contain an events array")

    store: dict[tuple[str, str], dict[str, Any]] = {}
    initial_decisions = [apply_event(store, event) for event in initial_events]
    delta_decisions = [apply_event(store, event) for event in delta_events]
    return {
        "evaluation_time": evaluation_time.isoformat().replace("+00:00", "Z"),
        "verification_mode": "fixture-structural",
        "initial_decisions": initial_decisions,
        "delta_decisions": delta_decisions,
        "current_events": _current_projection(store, evaluation_time),
    }


def check_expected(result: dict[str, Any], expected_path: Path) -> list[str]:
    expected = load_json(expected_path)
    errors: list[str] = []
    if result["delta_decisions"] != expected.get("expected_decisions"):
        errors.append("delta_decisions differ from expected_decisions")
    if result["current_events"] != sorted(
        expected.get("current_events_after_replay", []), key=lambda row: (row[0], row[1])
    ):
        errors.append("current_events differ from current_events_after_replay")
    return errors


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--initial",
        type=Path,
        default=ROOT / "fixtures" / "events-batch-1.json",
        help="initial event fixture",
    )
    parser.add_argument(
        "--delta",
        type=Path,
        default=ROOT / "fixtures" / "events-batch-2.json",
        help="delta event fixture",
    )
    parser.add_argument(
        "--now",
        default="2026-09-01T08:00:00Z",
        help="evaluation time in RFC 3339 format",
    )
    parser.add_argument(
        "--expected",
        type=Path,
        default=ROOT / "fixtures" / "expected-results-v0.json",
        help="expected replay result",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero when the replay differs from the expected fixture",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        evaluation_time = parse_time(args.now, "--now")
        result = replay(args.initial, args.delta, evaluation_time)
        if args.check:
            errors = check_expected(result, args.expected)
            if errors:
                for error in errors:
                    print(f"FAIL: {error}", file=sys.stderr)
                return 1
            print("PASS: fixture replay matches expected results", file=sys.stderr)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
