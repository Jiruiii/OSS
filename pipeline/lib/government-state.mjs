import { sha256Canonical } from './canonical.mjs';
import { verifyFeed } from './government-feed.mjs';

export async function readPublishedJson(baseUrl, name, { allowMissing = false } = {}) {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
    throw new Error('Published state requires a plain HTTPS base URL');
  const response = await fetch(new URL(name, base), {
    signal: AbortSignal.timeout(30000), redirect: 'error',
  });
  if (response.status === 404 && allowMissing) return null;
  if (!response.ok) throw new Error(`Cannot restore published state (${response.status})`);
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > 8 * 1024 * 1024) {
      throw new Error('Published state too large');
    }
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

// A failed upload may leave a newer local release. It is safe to retry that
// release; a signed public release with the same revision and different content
// is never safe to overwrite. Use only one active production publisher.
export function comparePublishedState(local, published, publicKey) {
  verifyFeed(local, publicKey);
  verifyFeed(published, publicKey);
  if (local.revision === published.revision && sha256Canonical(local) !== sha256Canonical(published))
    throw new Error('Conflicting signed publisher revision');
  return Math.sign(local.revision - published.revision);
}
