import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ATTESTATION_NAMESPACE, buildAttestation } from '../lib/attest.mjs';
import { verifyEvent } from '../lib/contract.mjs';
import { exportPrivateKeyPem } from '../lib/crypto.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/crowd-reports-v0.json'), 'utf8'));
const report = fixture.event_cases.find((entry) => entry.name === 'valid_report').event;
const ISSUED = new Date('2026-09-24T00:40:00Z');
const official = generateKeyPairSync('ed25519');
const KEY_ID = 'gov-attest-2026';

function attest(overrides = {}) {
  return buildAttestation({
    report,
    verdict: 'CONFIRMED',
    privateKey: official.privateKey,
    keyId: KEY_ID,
    issuedAt: ISSUED,
    ...overrides,
  });
}

test('attestation is an officially signed pointer to the report', () => {
  const attestation = attest();
  assert.equal(attestation.namespace, ATTESTATION_NAMESPACE);
  assert.equal(attestation.event_id, `attest:${report.event_id}`);
  assert.equal(attestation.event_type, 'ATTESTATION');
  assert.equal(attestation.expires_at, report.expires_at);
  assert.deepEqual(attestation.geometry, report.geometry);
  assert.equal(attestation.attributes.verdict, 'CONFIRMED');
  assert.equal(attestation.attributes.target_namespace, report.namespace);
  assert.equal(attestation.attributes.target_event_id, report.event_id);
  assert.equal(attestation.attributes.target_payload_hash, report.payload_hash);
  assert.equal(attestation.attributes.target_signing_key_id, report.signing_key_id);
  const result = verifyEvent(attestation, official.publicKey, { trustedKeyIds: [KEY_ID], now: ISSUED });
  assert.equal(result.valid, true);
});

test('a report with a broken device signature is never attested', () => {
  const tampered = fixture.event_cases.find((entry) => entry.name === 'tampered_attributes').event;
  assert.throws(() => attest({ report: tampered }), /integrity/);
  const mismatch = fixture.event_cases.find((entry) => entry.name === 'fingerprint_mismatch').event;
  assert.throws(() => attest({ report: mismatch }), /trust/);
});

test('only crowd reports can be attested, only with an official key', () => {
  assert.throws(() => attest({ report: fixture.attestations[0] }), /crowd/);
  assert.throws(() => attest({ keyId: report.signing_key_id }), /official key/);
  assert.throws(() => attest({ verdict: 'MAYBE' }), /verdict/);
  assert.throws(() => attest({ issuedAt: new Date('2026-09-25T00:00:00Z') }), /expired/);
});

test('re-attesting bumps event_version so the verdict can be revised', () => {
  const first = attest();
  const second = attest({ verdict: 'REFUTED', previous: first, issuedAt: new Date('2026-09-24T00:45:00Z') });
  assert.equal(second.event_id, first.event_id);
  assert.equal(second.event_version, first.event_version + 1);
  assert.equal(second.attributes.verdict, 'REFUTED');
  const other = { ...first, event_id: 'attest:report:other' };
  assert.throws(() => attest({ previous: other }), /different report/);
});

test('fixture attestations are valid under the fixture official key', async () => {
  const { createPublicKey } = await import('node:crypto');
  const key = createPublicKey({ key: Buffer.from(fixture.official_public_key, 'base64'), format: 'der', type: 'spki' });
  const [confirmed, refuted] = fixture.attestations;
  for (const attestation of fixture.attestations) {
    assert.equal(verifyEvent(attestation, key, { trustedKeyIds: [fixture.official_key_id], now: fixture.now }).valid, true);
  }
  assert.equal(refuted.event_version, confirmed.event_version + 1);
});

test('cli attest writes an event batch that build can package', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'attest-'));
  const keyPath = path.join(dir, 'private-key.pem');
  const reportsPath = path.join(dir, 'reports.json');
  const outPath = path.join(dir, 'attestation.json');
  writeFileSync(keyPath, exportPrivateKeyPem(official.privateKey));
  writeFileSync(reportsPath, JSON.stringify([report]));
  execFileSync(process.execPath, [
    path.join(ROOT, 'pipeline/cli.mjs'), 'attest',
    '--report', reportsPath,
    '--verdict', 'confirmed',
    '--private-key', keyPath,
    '--key-id', KEY_ID,
    '--issued-at', ISSUED.toISOString(),
    '--out', outPath,
  ]);
  const batch = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.equal(batch.schema_version, 'event-batch-v0');
  assert.equal(batch.events[0].attributes.verdict, 'CONFIRMED');

  const bundleDir = path.join(dir, 'bundle');
  execFileSync(process.execPath, [
    path.join(ROOT, 'pipeline/cli.mjs'), 'build',
    '--input', outPath,
    '--out-dir', bundleDir,
    '--private-key', keyPath,
    '--key-id', KEY_ID,
  ]);
  const metadata = JSON.parse(readFileSync(path.join(bundleDir, 'bundle-metadata.json'), 'utf8'));
  assert.equal(metadata.dataset_id, 'official-verified');
  assert.equal(metadata.event_count, 1);
});
