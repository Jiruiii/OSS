import { signEvent, verifyEvent } from './contract.mjs';
import { isCrowdNamespace, isDeviceKeyId } from './device-key.mjs';

/**
 * Government attestation of a crowd report (docs/data-contract-v0.md「官方查證事件」).
 *
 * The attestation is its own official event pointing at the report by
 * (namespace, event_id, payload_hash); the report itself is never modified.
 * Re-attesting the same report bumps event_version so a verdict can be revised
 * through the ordinary newer-version-wins apply rule.
 */
export const ATTESTATION_NAMESPACE = 'official.verified';
export const ATTESTATION_EVENT_TYPE = 'ATTESTATION';
export const ATTESTATION_VERDICTS = Object.freeze(['CONFIRMED', 'REFUTED']);
export const ATTESTATION_NOTE_MAX_CODE_POINTS = 160;

export function attestationEventId(reportEventId) {
  return `attest:${reportEventId}`;
}

function isoSeconds(date) {
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

function fail(message) {
  throw new RangeError(message);
}

export function buildAttestation({
  report,
  verdict,
  privateKey,
  keyId,
  issuedAt = new Date(),
  previous,
  note,
}) {
  if (!ATTESTATION_VERDICTS.includes(verdict)) fail(`verdict must be one of ${ATTESTATION_VERDICTS.join(', ')}`);
  if (typeof keyId !== 'string' || keyId.length === 0 || isDeviceKeyId(keyId)) {
    fail('attestations must be signed with an official key id');
  }
  if (!isCrowdNamespace(report?.namespace) || !isDeviceKeyId(report?.signing_key_id)) {
    fail('only device-signed crowd.* reports can be attested');
  }
  const issued = new Date(issuedAt);
  const reportCheck = verifyEvent(report, null, { now: issued });
  if (!reportCheck.valid) fail(`report failed verification at ${reportCheck.stage}: ${reportCheck.errors.join('; ')}`);
  if (reportCheck.expired) fail('report has already expired; an attestation could not outlive it');
  if (note !== undefined && (typeof note !== 'string' || [...note].length > ATTESTATION_NOTE_MAX_CODE_POINTS)) {
    fail(`note must be a string of at most ${ATTESTATION_NOTE_MAX_CODE_POINTS} characters`);
  }

  const eventId = attestationEventId(report.event_id);
  let eventVersion = 1;
  if (previous) {
    if (previous.namespace !== ATTESTATION_NAMESPACE || previous.event_id !== eventId) {
      fail('previous attestation targets a different report');
    }
    eventVersion = previous.event_version + 1;
  }

  const attributes = {
    target_namespace: report.namespace,
    target_event_id: report.event_id,
    target_event_version: report.event_version,
    target_payload_hash: report.payload_hash,
    target_signing_key_id: report.signing_key_id,
    verdict,
    area_id: 'crowd',
    theme: 'attestation',
  };
  if (note) attributes.note = note;

  return signEvent({
    schema_version: 'event-v0',
    namespace: ATTESTATION_NAMESPACE,
    event_id: eventId,
    event_type: ATTESTATION_EVENT_TYPE,
    geometry: report.geometry,
    severity: report.severity,
    source: 'GOV_ATTEST',
    source_version: isoSeconds(issued),
    event_version: eventVersion,
    issued_at: isoSeconds(issued),
    expires_at: report.expires_at,
    attributes,
    signing_key_id: keyId,
    provenance: {
      original_source: 'government-attestation',
      received_at: isoSeconds(issued),
      transport_source: { kind: 'server', node_id: 'attest-cli' },
    },
  }, privateKey);
}

/** Accepts a single event, an event-batch-v0, or a bare array (the Android debug export). */
export function reportsFromInput(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.events)) return input.events;
  if (input?.schema_version === 'event-v0') return [input];
  throw new TypeError('report input must be an event, an event batch, or an array of events');
}
