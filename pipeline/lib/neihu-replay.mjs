import { readFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalize } from './canonical.mjs';
import { eventState, validateEventShape } from './contract.mjs';
import { validateFeatureShape } from './feature-contract.mjs';

const FIXTURE_SIGNER_PREFIX = 'fixture-neihu-';

function clone(value) {
  return structuredClone(value);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function parseTime(value, field) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be a valid timestamp`);
  }
  return parsed;
}

function isoTime(value) {
  return parseTime(value, 'now').toISOString();
}

function eventKey(event) {
  return `${event.namespace}\u0000${event.event_id}`;
}

function projectionKey(row) {
  return `${row.namespace}\u0000${row.event_id}`;
}

function generatedEvent(index, expansion) {
  const sequence = String(index).padStart(3, '0');
  const areaId = expansion.area_ids[(index - 1) % expansion.area_ids.length];
  const longitude = Number((121.56 + ((index * 7) % 55) / 1000).toFixed(6));
  const latitude = Number((25.06 + ((index * 11) % 45) / 1000).toFixed(6));
  const receivedAt = new Date(parseTime(expansion.issued_at, 'expansion.issued_at').getTime() + index * 1000).toISOString();
  const hex = index.toString(16).padStart(64, '0');
  return {
    schema_version: 'event-v0',
    namespace: 'official.tdx',
    event_id: `road:fixture-${sequence}`,
    event_type: 'ROAD_STATUS',
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    severity: 'LOW',
    source: 'TDX',
    source_version: expansion.source_version,
    event_version: 1,
    issued_at: expansion.issued_at,
    expires_at: expansion.expires_at,
    attributes: {
      area_id: areaId,
      theme: 'road',
      status: 'OPEN',
      generated_fixture_record: index,
    },
    payload_hash: `sha256:${hex}`,
    signature: 'Zml4dHVyZS1uZWlodS1zY2FsZQ==',
    signature_algorithm: 'Ed25519',
    signing_key_id: `${FIXTURE_SIGNER_PREFIX}2026`,
    provenance: {
      original_source: 'neihu-replay-expansion',
      received_at: receivedAt,
      transport_source: { kind: 'local_fixture', node_id: 'neihu-replay' },
    },
  };
}

function expandEvents(sequence, targetEventRecordCount) {
  const baseEvents = Array.isArray(sequence.events) ? clone(sequence.events) : [];
  const eventUpdates = (Array.isArray(sequence.updates) ? sequence.updates : [])
    .filter((update) => update?.kind === 'event');
  const generatedCount = targetEventRecordCount - baseEvents.length - eventUpdates.length;
  if (!Number.isInteger(generatedCount) || generatedCount < 0) {
    throw new TypeError('target_event_record_count is smaller than the fixed event sequence');
  }
  if (generatedCount === 0) return baseEvents;
  const expansion = sequence.expansion;
  if (!expansion || !Array.isArray(expansion.area_ids) || expansion.area_ids.length === 0) {
    throw new TypeError('expansion.area_ids is required when generated records are requested');
  }
  return [...baseEvents, ...Array.from({ length: generatedCount }, (_, offset) => generatedEvent(offset + 1, expansion))];
}

export function loadNeihuFixture(manifestPath) {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifest = readJson(resolvedManifestPath);
  if (manifest?.schema_version !== 'neihu-replay-manifest-v0') {
    throw new TypeError('manifest schema_version must be neihu-replay-manifest-v0');
  }
  const sequencePath = path.resolve(path.dirname(resolvedManifestPath), manifest.update_sequence);
  const sequence = readJson(sequencePath);
  if (sequence?.schema_version !== 'neihu-update-sequence-v0') {
    throw new TypeError('update sequence schema_version must be neihu-update-sequence-v0');
  }
  const targetEventRecordCount = manifest.target_event_record_count ?? sequence.expansion?.target_event_record_count;
  if (!Number.isInteger(targetEventRecordCount) || targetEventRecordCount < 1) {
    throw new TypeError('target_event_record_count must be a positive integer');
  }
  return {
    manifest: clone(manifest),
    rawSnapshots: clone(sequence.raw_snapshots ?? []),
    events: expandEvents(sequence, targetEventRecordCount),
    features: clone(sequence.features ?? []),
    updates: clone(sequence.updates ?? []),
  };
}

function sameFeatureContent(left, right) {
  return canonicalize({
    feature_type: left.feature_type,
    geometry: left.geometry,
    properties: left.properties,
  }) === canonicalize({
    feature_type: right.feature_type,
    geometry: right.geometry,
    properties: right.properties,
  });
}

function applyFixtureEvent(store, event, now) {
  const key = [event?.namespace, event?.event_id];
  const errors = validateEventShape(event);
  if (errors.length > 0) {
    return { key, result: 'rejected', reason: 'invalid_event', errors };
  }
  // These fixtures intentionally use stable structural signatures. Production
  // bundles continue through verifyEvent/ingestEvent with a real public key.
  if (!event.signing_key_id.startsWith(FIXTURE_SIGNER_PREFIX)) {
    return { key, result: 'rejected', reason: 'untrusted_fixture_signer' };
  }
  const identity = eventKey(event);
  const current = store.get(identity);
  const state = eventState(event, now);
  if (!current) {
    const sameEventOtherNamespace = [...store.values()].some((stored) =>
      stored.event_id === event.event_id && stored.namespace !== event.namespace);
    store.set(identity, event);
    return {
      key,
      result: sameEventOtherNamespace ? 'inserted_separate_namespace' : 'inserted',
      incoming_version: event.event_version,
      state,
    };
  }
  if (event.event_version > current.event_version) {
    store.set(identity, event);
    return {
      key,
      result: 'updated',
      stored_version_before: current.event_version,
      incoming_version: event.event_version,
      stored_version_after: event.event_version,
      state,
    };
  }
  if (event.event_version < current.event_version) {
    return {
      key,
      result: 'rejected',
      stored_version_before: current.event_version,
      incoming_version: event.event_version,
      reason: 'version_rollback',
    };
  }
  return {
    key,
    result: 'rejected',
    stored_version_before: current.event_version,
    incoming_version: event.event_version,
    reason: 'same_version_conflict',
  };
}

function applyFeatureSnapshot(store, snapshotVersion, feature) {
  const errors = validateFeatureShape(feature, { signed: false });
  const key = [feature?.layer_id, feature?.feature_id];
  if (errors.length > 0) return { key, result: 'rejected', reason: 'invalid_feature', errors };
  if (!Number.isInteger(snapshotVersion) || snapshotVersion < 1) {
    return { key, result: 'rejected', reason: 'invalid_snapshot_version' };
  }
  const identity = `${feature.layer_id}\u0000${feature.feature_id}`;
  const current = store.get(identity);
  if (!current) {
    store.set(identity, { feature, snapshotVersion, unchangedSnapshotCount: 0 });
    return { key, result: 'inserted', snapshot_version: snapshotVersion };
  }
  if (snapshotVersion <= current.snapshotVersion) {
    return {
      key,
      result: 'rejected',
      reason: snapshotVersion === current.snapshotVersion ? 'same_snapshot_conflict' : 'snapshot_rollback',
      stored_snapshot_version: current.snapshotVersion,
      incoming_snapshot_version: snapshotVersion,
    };
  }
  const unchanged = sameFeatureContent(current.feature, feature);
  store.set(identity, {
    feature,
    snapshotVersion,
    unchangedSnapshotCount: current.unchangedSnapshotCount + (unchanged ? 1 : 0),
  });
  return {
    key,
    result: 'updated',
    stored_snapshot_version_before: current.snapshotVersion,
    incoming_snapshot_version: snapshotVersion,
    content_state: unchanged ? 'unchanged' : 'changed',
  };
}

function projectEvent(event, now) {
  const row = {
    namespace: event.namespace,
    event_id: event.event_id,
    event_version: event.event_version,
    state: eventState(event, now),
    source: event.source,
    event_type: event.event_type,
    area_id: event.attributes.area_id,
    theme: event.attributes.theme,
  };
  if (typeof event.attributes.status === 'string') row.status = event.attributes.status;
  return row;
}

function projectFeature({ feature, snapshotVersion, unchangedSnapshotCount }) {
  return {
    layer_id: feature.layer_id,
    feature_id: feature.feature_id,
    snapshot_version: snapshotVersion,
    source_version: feature.source_version,
    content_state: unchangedSnapshotCount > 0 ? 'unchanged' : 'initial',
    unchanged_snapshot_count: unchangedSnapshotCount,
  };
}

export function replayNeihuFixture(fixture, now) {
  if (!fixture || !Array.isArray(fixture.events) || !Array.isArray(fixture.features) || !Array.isArray(fixture.updates)) {
    throw new TypeError('replayNeihuFixture requires a loaded fixture');
  }
  const evaluationTime = parseTime(now, 'now');
  const eventStore = new Map();
  const featureStore = new Map();
  const decisions = [];
  const featureDecisions = [];
  const counts = { inserted: 0, updated: 0, rejected: 0 };

  const recordEventDecision = (decision, updateId = null) => {
    if (updateId) decision.update_id = updateId;
    decisions.push(decision);
    if (decision.result === 'inserted' || decision.result === 'inserted_separate_namespace') counts.inserted += 1;
    else if (decision.result === 'updated') counts.updated += 1;
    else if (decision.result === 'rejected') counts.rejected += 1;
  };

  for (const feature of fixture.features) {
    featureDecisions.push({ ...applyFeatureSnapshot(featureStore, 1, feature), update_id: 'initial-feature-snapshot' });
  }
  for (const event of fixture.events) recordEventDecision(applyFixtureEvent(eventStore, event, evaluationTime));
  for (const update of fixture.updates) {
    if (update?.kind === 'event') {
      recordEventDecision(applyFixtureEvent(eventStore, update.event, evaluationTime), update.update_id);
    } else if (update?.kind === 'feature_snapshot') {
      for (const feature of update.features ?? []) {
        const decision = applyFeatureSnapshot(featureStore, update.snapshot_version, feature);
        decision.update_id = update.update_id;
        featureDecisions.push(decision);
      }
    } else {
      featureDecisions.push({ result: 'rejected', reason: 'unknown_update_kind', update_id: update?.update_id ?? null });
    }
  }
  const current = [...eventStore.values()]
    .map((event) => projectEvent(event, evaluationTime))
    .sort((left, right) => projectionKey(left).localeCompare(projectionKey(right)));
  const featureLayers = [...featureStore.values()]
    .map(projectFeature)
    .sort((left, right) => `${left.layer_id}\u0000${left.feature_id}`.localeCompare(`${right.layer_id}\u0000${right.feature_id}`));
  const rawSnapshots = clone(fixture.rawSnapshots);
  const rawRecordCount = rawSnapshots.reduce((total, snapshot) => total + (snapshot.records?.length ?? 0), 0);
  const excludedRecordCount = rawSnapshots.reduce(
    (total, snapshot) => total + (snapshot.records ?? []).filter((record) => record.in_neihu === false).length,
    0,
  );

  return {
    fixture_id: fixture.manifest?.fixture_id ?? null,
    evaluation_time: evaluationTime.toISOString(),
    record_count: fixture.events.length + fixture.updates.filter((update) => update?.kind === 'event').length,
    inserted: counts.inserted,
    updated: counts.updated,
    rejected: counts.rejected,
    counts,
    expired: current.filter((event) => event.state === 'expired').length,
    current,
    featureLayers,
    decisions,
    featureDecisions,
    rawSnapshots,
    rawPreservation: {
      snapshot_count: rawSnapshots.length,
      raw_record_count: rawRecordCount,
      excluded_record_count: excludedRecordCount,
    },
  };
}

export function checkNeihuExpectations(result, expected) {
  const errors = [];
  if (result.record_count !== expected.expected_record_count) errors.push('record_count differs from expected');
  if (JSON.stringify(result.counts) !== JSON.stringify(expected.counts)) errors.push('counts differ from expected');
  if (result.current.length !== expected.current_count) errors.push('current count differs from expected');
  if (result.expired !== expected.expired_count) errors.push('expired count differs from expected');
  for (const expectedEvent of expected.final_events ?? []) {
    const actual = result.current.find((event) =>
      event.namespace === expectedEvent.namespace && event.event_id === expectedEvent.event_id);
    if (!actual) {
      errors.push(`missing final event: ${expectedEvent.namespace}/${expectedEvent.event_id}`);
      continue;
    }
    for (const [field, value] of Object.entries(expectedEvent)) {
      if (actual[field] !== value) errors.push(`final event mismatch: ${expectedEvent.namespace}/${expectedEvent.event_id}/${field}`);
    }
  }
  for (const expectedFeature of expected.final_features ?? []) {
    const actual = result.featureLayers.find((feature) =>
      feature.layer_id === expectedFeature.layer_id && feature.feature_id === expectedFeature.feature_id);
    if (!actual) {
      errors.push(`missing final feature: ${expectedFeature.layer_id}/${expectedFeature.feature_id}`);
      continue;
    }
    for (const [field, value] of Object.entries(expectedFeature)) {
      if (actual[field] !== value) errors.push(`final feature mismatch: ${expectedFeature.layer_id}/${expectedFeature.feature_id}/${field}`);
    }
  }
  for (const [field, value] of Object.entries(expected.raw_preservation ?? {})) {
    if (result.rawPreservation[field] !== value) errors.push(`raw preservation mismatch: ${field}`);
  }
  return errors;
}
