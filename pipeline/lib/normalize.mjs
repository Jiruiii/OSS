/**
 * Normalize the small TDX-shaped source fixture into the unsigned Event v0
 * intermediate form. Signing is deliberately a separate operation.
 */
export function normalizeTdx(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.records)) {
    throw new TypeError('TDX input must contain a records array');
  }

  const namespace = options.namespace ?? 'official.tdx';
  const keyId = options.signingKeyId ?? 'fixture-stage2-2026';
  const receivedAt = options.receivedAt ?? raw.retrieved_at;
  const transportSource = options.transportSource ?? {
    kind: 'server',
    node_id: 'tdx-normalizer',
  };

  if (!raw.source || raw.source !== 'TDX') {
    throw new TypeError('TDX normalizer only accepts source=TDX');
  }
  if (!raw.source_version) {
    throw new TypeError('TDX input must contain source_version');
  }
  if (!receivedAt) {
    throw new TypeError('TDX input must contain retrieved_at or receivedAt');
  }

  return raw.records.map((record, index) => {
    const eventId = record.event_id ?? `road:${record.id ?? index + 1}`;
    const eventType = record.event_type ?? record.type;
    const eventVersion = record.event_version ?? record.version;
    const issuedAt = record.issued_at ?? raw.issued_at;
    const expiresAt = record.expires_at ?? raw.expires_at;
    const attributes = record.attributes ?? record.properties ?? {};

    if (!eventType || !Number.isInteger(eventVersion) || eventVersion < 1) {
      throw new TypeError(`invalid event type/version for ${eventId}`);
    }
    if (!issuedAt || !expiresAt || !record.geometry) {
      throw new TypeError(`missing geometry or TTL for ${eventId}`);
    }

    return {
      schema_version: 'event-v0',
      namespace,
      event_id: eventId,
      event_type: eventType,
      geometry: record.geometry,
      severity: record.severity ?? 'UNKNOWN',
      source: raw.source,
      source_version: String(record.source_version ?? raw.source_version),
      event_version: eventVersion,
      issued_at: issuedAt,
      expires_at: expiresAt,
      attributes,
      signature_algorithm: 'Ed25519',
      signing_key_id: keyId,
      provenance: {
        original_source: options.originalSource ?? raw.original_source ?? raw.source,
        received_at: receivedAt,
        transport_source: transportSource,
      },
    };
  });
}
