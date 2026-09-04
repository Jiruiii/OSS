import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

test('committed experiments/results match a fresh deterministic matrix run', () => {
  // Throws (non-zero exit) on any MISMATCH.
  execFileSync('node', [path.join(ROOT, 'simulator', 'cli.mjs'), 'matrix', '--check'], {
    stdio: 'pipe',
  });
});
