#!/usr/bin/env node
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.env.GOVERNMENT_PUBLIC_DIR ?? '.government-public');
const port = Number(process.env.PORT ?? 8787);
http.createServer(async (request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1);
  if (request.method !== 'GET' || !(/^(feed\.json|index\.html)$/.test(name) ||
      /^releases\/[0-9]+\/[a-z][a-z0-9-]+\/[0-9]+\.json$/.test(name))) {
    response.writeHead(404); response.end(); return;
  }
  try {
    const bytes = await readFile(path.join(root, name));
    response.writeHead(200, { 'Content-Type': name.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
}).listen(port, '127.0.0.1', () => console.log(`Local signed-feed server: http://127.0.0.1:${port}/ (USB validation only)`));
