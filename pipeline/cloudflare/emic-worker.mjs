export const EMIC_URL = 'https://portal2.emic.gov.tw/Pub/EEA2/OpenData/Shelter.xml';
export const EMIC_PATH = '/api/emic-shelters';

export async function relayEmic(request, fetchImpl = globalThis.fetch) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const upstream = await fetchImpl(EMIC_URL, {
      headers: { Accept: 'application/xml, text/xml;q=0.9' },
      redirect: 'manual', signal: controller.signal,
    });
    if (!upstream.ok || !/xml/i.test(upstream.headers.get('content-type') ?? ''))
      return new Response('Government source unavailable', { status: 502,
        headers: { 'Cache-Control': 'no-store' } });
    const reader = upstream.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 24 * 1024 * 1024) { await reader.cancel(); throw new Error('Response too large'); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const headers = new Headers({ 'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Government-Source': EMIC_URL });
    const modified = upstream.headers.get('last-modified');
    if (modified) headers.set('Last-Modified', modified);
    return new Response(body, { headers });
  } catch {
    return new Response('Government source unavailable', { status: 502,
      headers: { 'Cache-Control': 'no-store' } });
  } finally { clearTimeout(timer); }
}
