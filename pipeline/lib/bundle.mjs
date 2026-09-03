import {
  canonicalize,
  chunkContent,
  chunkPayloadBytes,
  chunkSignatureInput,
  manifestHashInput,
  manifestSignatureInput,
  sha256Canonical,
  sha256Bytes,
} from './canonical.mjs';
import { signCanonical } from './crypto.mjs';

const PRIORITY_RANK = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };

function priorityFor(events) {
  return events.reduce(
    (highest, event) => (PRIORITY_RANK[event.severity] > PRIORITY_RANK[highest] ? event.severity : highest),
    'LOW',
  );
}

function groupEvents(events, targetSizeBytes, datasetId, namespace, datasetVersion) {
  const groups = [];
  let current = [];
  for (const event of events) {
    const candidate = [...current, event];
    const candidateContent = {
      dataset_id: datasetId,
      namespace,
      dataset_version: datasetVersion,
      sequence: groups.length,
      priority: priorityFor(candidate),
      content_type: 'application/json',
      content_encoding: 'identity',
      events: candidate,
    };
    if (current.length > 0 && Buffer.byteLength(canonicalize(candidateContent), 'utf8') > targetSizeBytes) {
      groups.push(current);
      current = [event];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function buildBundle(events, options) {
  const {
    datasetId,
    namespace,
    datasetVersion,
    source,
    sourceVersion,
    createdAt,
    expiresAt,
    signingKeyId,
    privateKey,
    previousManifestHash,
    targetSizeBytes = 4096,
    manifestId = `${datasetId}:manifest:${datasetVersion}`,
  } = options;
  if (!Array.isArray(events) || events.length === 0) throw new TypeError('buildBundle requires events');
  if (!privateKey) throw new TypeError('buildBundle requires a private key');

  const groups = groupEvents(events, targetSizeBytes, datasetId, namespace, datasetVersion);
  const unsignedChunks = groups.map((group, sequence) => {
    const chunkId = `${datasetId}:chunk:${datasetVersion}:${String(sequence).padStart(3, '0')}`;
    const base = {
      schema_version: 'chunk-v0',
      chunk_id: chunkId,
      manifest_id: manifestId,
      dataset_id: datasetId,
      namespace,
      dataset_version: datasetVersion,
      sequence,
      priority: priorityFor(group),
      created_at: createdAt,
      content_type: 'application/json',
      content_encoding: 'identity',
      event_count: group.length,
      events: group,
      signature_algorithm: 'Ed25519',
      signing_key_id: signingKeyId,
    };
    const payloadBytes = chunkPayloadBytes(base);
    return {
      ...base,
      byte_length: payloadBytes.length,
      chunk_hash: sha256Bytes(payloadBytes),
    };
  });

  const manifestBase = {
    schema_version: 'manifest-v0',
    manifest_id: manifestId,
    dataset_id: datasetId,
    namespace,
    source,
    source_version: String(sourceVersion),
    dataset_version: datasetVersion,
    created_at: createdAt,
    expires_at: expiresAt,
    chunking: {
      algorithm: 'fixed-size',
      target_size_bytes: targetSizeBytes,
      hash_algorithm: 'SHA-256',
    },
    total_event_count: events.length,
    total_size_bytes: unsignedChunks.reduce((total, chunk) => total + chunk.byte_length, 0),
    chunks: unsignedChunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      sequence: chunk.sequence,
      chunk_hash: chunk.chunk_hash,
      size_bytes: chunk.byte_length,
      event_count: chunk.event_count,
      priority: chunk.priority,
      event_ids: chunk.events.map((event) => event.event_id),
    })),
    ...(previousManifestHash ? { previous_manifest_hash: previousManifestHash } : {}),
    signature_algorithm: 'Ed25519',
    signing_key_id: signingKeyId,
  };
  const manifestHash = sha256Canonical(manifestHashInput(manifestBase));
  const manifest = {
    ...manifestBase,
    manifest_hash: manifestHash,
  };
  const signedManifest = {
    ...manifest,
    signature: signCanonical(manifestSignatureInput({ ...manifest, signature: '' }), privateKey),
  };

  const chunks = unsignedChunks.map((chunk) => {
    const signedChunk = {
      ...chunk,
      manifest_hash: manifestHash,
      signature: '',
    };
    return {
      ...signedChunk,
      signature: signCanonical(chunkSignatureInput(signedChunk), privateKey),
    };
  });
  return { manifest: signedManifest, chunks };
}
