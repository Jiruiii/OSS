/**
 * Applying one chunk to one node — from the server (cellular) or from a peer.
 *
 * Both paths run the real `verifyChunk` before applying anything. Byte
 * accounting splits peer receipts into useful / duplicate / failed so Transfer
 * Efficiency is measured, not assumed.
 */

import { verifyChunk } from '../../pipeline/lib/contract.mjs';
import { eventIdentity } from './scenario.mjs';
import { subStream } from './rng.mjs';

// Every authoritative chunk is byte-identical across nodes, and full-bundle
// verification is already covered by the pipeline tests. Verify each chunk in
// full once per scenario build (keyed by manifest_hash), then trust it — unless
// a caller passes an explicit `deliverChunk` (a simulated tampered peer), which
// always gets the real check.
const verifiedByManifest = new Map();

function knownGood(scenario, chunkId) {
  return verifiedByManifest.get(scenario.manifest.manifest_hash)?.has(chunkId) ?? false;
}

function markGood(scenario, chunkId) {
  let set = verifiedByManifest.get(scenario.manifest.manifest_hash);
  if (!set) verifiedByManifest.set(scenario.manifest.manifest_hash, (set = new Set()));
  set.add(chunkId);
}

function verifyOptions(scenario, simClock) {
  return { now: simClock, trustedKeyIds: [scenario.keyId] };
}

function verifyDelivered(scenario, chunkId, chunk, simClock, isOverride) {
  if (!isOverride && knownGood(scenario, chunkId)) return { valid: true };
  const result = verifyChunk(chunk, scenario.manifest, scenario.publicKey, verifyOptions(scenario, simClock));
  if (result.valid && !isOverride) markGood(scenario, chunkId);
  return result;
}

/**
 * Apply a chunk's events after `verifyChunk` has already validated every
 * signature. Mirrors `ingestEvent`'s monotonic-version rule (identity =
 * namespace + event_id; newer version wins, older/equal is dropped) without
 * paying for a second round of Ed25519 verification.
 */
function applyChunkEvents(scenario, node, chunk, round) {
  let anyApplied = false;
  let appliedEventBytes = 0;
  for (const event of chunk.events) {
    const identity = eventIdentity(event);
    const current = node.store.get(identity);
    if (current && event.event_version <= current.event_version) continue;
    node.store.set(identity, event);
    anyApplied = true;
    appliedEventBytes += Buffer.byteLength(JSON.stringify(event), 'utf8');
    const latest = scenario.latestVersionByIdentity.get(identity);
    if (event.event_version === latest && !node.appliedRound.has(identity)) {
      node.appliedRound.set(identity, round);
    }
  }
  return { anyApplied, appliedEventBytes };
}

/** Server pull over cellular: reliable, no failure roll, counts as cellular bytes. */
export function applyServerChunk(scenario, node, chunkId, round, simClock) {
  const entry = scenario.manifestEntryById.get(chunkId);
  const chunk = scenario.chunksById.get(chunkId);
  node.cellularBytes += entry.size_bytes;
  node.cellularFetches += 1;
  const verification = verifyDelivered(scenario, chunkId, chunk, simClock, false);
  if (!verification.valid) throw new Error(`authoritative chunk ${chunkId} failed verify: ${verification.errors?.join(',')}`);
  applyChunkEvents(scenario, node, chunk, round);
  node.chunksVerified += 1;
  node.heldChunks.add(chunkId);
}

/**
 * One peer→peer chunk transfer. `deliverChunk` overrides the bytes actually
 * delivered (used by tests to simulate a tampered peer); it defaults to the
 * authoritative chunk.
 */
export function transferChunk(scenario, config, src, dst, chunkId, seed, round, chunkSeq, simClock, deliverChunk) {
  const entry = scenario.manifestEntryById.get(chunkId);
  const size = entry.size_bytes;
  dst.p2pRxBytes += size;

  const failRoll = subStream(seed, 'xfer', round, src.index, dst.index, chunkSeq)();
  if (failRoll < config.transfer_failure_prob) {
    dst.failedRxBytes += size;
    return { outcome: 'failed' };
  }
  if (dst.heldChunks.has(chunkId)) {
    dst.duplicateRxBytes += size;
    return { outcome: 'duplicate' };
  }

  const chunk = deliverChunk ?? scenario.chunksById.get(chunkId);
  const verification = verifyDelivered(scenario, chunkId, chunk, simClock, deliverChunk !== undefined);
  if (!verification.valid) {
    dst.failedRxBytes += size;
    return { outcome: 'rejected', errors: verification.errors };
  }

  const { anyApplied, appliedEventBytes } = applyChunkEvents(scenario, dst, chunk, round);
  dst.heldChunks.add(chunkId);
  dst.chunksVerified += 1;
  if (anyApplied) {
    dst.usefulRxBytes += size;
    dst.usefulEventBytes += appliedEventBytes;
    return { outcome: 'useful' };
  }
  dst.duplicateRxBytes += size;
  return { outcome: 'duplicate' };
}
