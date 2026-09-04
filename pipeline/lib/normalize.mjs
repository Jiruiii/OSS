/**
 * Normalize a source fixture into the unsigned Event v0 intermediate form.
 * Signing is deliberately a separate operation.
 *
 * `normalizeSource` is the general entry point: it accepts records from any of
 * the allowed disaster-data sources (TDX, CWA, NCDR, the fire agency, OSM-derived
 * synthetic events) and requires every record to declare its `area_id` and
 * `theme` so downstream chunking can group by geography without guessing.
 *
 * `normalizeTdx` stays as a thin wrapper so existing call sites and tests that
 * only speak TDX keep working unchanged.
 */

const DEFAULT_ALLOWED_SOURCES = ['TDX', 'CWA', 'NCDR', 'FIRE_AGENCY', 'OSM_SYNTHETIC'];

function eventIdPrefix(record) {
  if (typeof record.theme === 'string' && record.theme.length > 0) return record.theme;
  const eventType = record.event_type ?? record.type;
  if (typeof eventType === 'string' && eventType.length > 0) {
    return eventType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  return 'event';
}

export function normalizeSource(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.records)) {
    throw new TypeError('source input must contain a records array');
  }

  const allowedSources = options.allowedSources ?? DEFAULT_ALLOWED_SOURCES;
  const defaultNamespace = options.namespace ?? 'official.tdx';
  const keyId = options.signingKeyId ?? 'fixture-stage2-2026';
  const receivedAt = options.receivedAt ?? raw.retrieved_at;
  const transportSource = options.transportSource ?? {
    kind: 'server',
    node_id: 'source-normalizer',
  };

  if (raw.source && !allowedSources.includes(raw.source)) {
    throw new TypeError(`source ${raw.source} is not in the allowed list: ${allowedSources.join(', ')}`);
  }
  if (!raw.source && !raw.records.every((record) => record.source)) {
    throw new TypeError('source input needs a top-level source or a source on every record');
  }
  if (!raw.source_version && !raw.records.every((record) => record.source_version)) {
    throw new TypeError('source input needs a top-level source_version or one on every record');
  }
  if (!receivedAt) {
    throw new TypeError('source input must contain retrieved_at or receivedAt');
  }

  return raw.records.map((record, index) => {
    const eventId = record.event_id ?? `${eventIdPrefix(record)}:${record.id ?? index + 1}`;
    const eventType = record.event_type ?? record.type;
    const eventVersion = record.event_version ?? record.version;
    const issuedAt = record.issued_at ?? raw.issued_at;
    const expiresAt = record.expires_at ?? raw.expires_at;
    const baseAttributes = record.attributes ?? record.properties ?? {};
    const areaId = record.area_id ?? baseAttributes.area_id;
    const theme = record.theme ?? baseAttributes.theme;

    const source = record.source ?? raw.source;
    if (!allowedSources.includes(source)) {
      throw new TypeError(`record ${eventId} source ${source ?? '<missing>'} is not allowed`);
    }
    if (!eventType || !Number.isInteger(eventVersion) || eventVersion < 1) {
      throw new TypeError(`invalid event type/version for ${eventId}`);
    }
    if (!issuedAt || !expiresAt || !record.geometry) {
      throw new TypeError(`missing geometry or TTL for ${eventId}`);
    }
    if (typeof areaId !== 'string' || areaId.length === 0 || typeof theme !== 'string' || theme.length === 0) {
      throw new TypeError(`record ${eventId} must declare area_id and theme`);
    }

    const attributes = { ...baseAttributes, area_id: areaId, theme };

    return {
      schema_version: 'event-v0',
      namespace: record.namespace ?? defaultNamespace,
      event_id: eventId,
      event_type: eventType,
      geometry: record.geometry,
      severity: record.severity ?? 'UNKNOWN',
      source,
      source_version: String(record.source_version ?? raw.source_version),
      event_version: eventVersion,
      issued_at: issuedAt,
      expires_at: expiresAt,
      attributes,
      signature_algorithm: 'Ed25519',
      signing_key_id: keyId,
      provenance: {
        original_source:
          record.original_source ?? options.originalSource ?? raw.original_source ?? source,
        received_at: receivedAt,
        transport_source: record.transport_source ?? transportSource,
      },
    };
  });
}

export function normalizeTdx(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.records)) {
    throw new TypeError('TDX input must contain a records array');
  }
  if (!raw.source || raw.source !== 'TDX') {
    throw new TypeError('TDX normalizer only accepts source=TDX');
  }
  return normalizeSource(raw, {
    ...options,
    allowedSources: ['TDX'],
    transportSource: options.transportSource ?? { kind: 'server', node_id: 'tdx-normalizer' },
  });
}
