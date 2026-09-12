// Static same-origin server for a built product directory.
// Usage: node scripts/serve-dist.mjs [directory]  (PORT selects the port)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.env.PORT ?? '4197');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('PORT must be 1024..65535');
}

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function resolveFile(requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  try {
    const info = await stat(absolute);
    if (info.isDirectory()) return path.join(absolute, 'index.html');
    return absolute;
  } catch {
    return null;
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405);
    response.end();
    return;
  }
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let file = await resolveFile(url.pathname);
    if (!file && !path.extname(url.pathname)) file = path.join(root, 'index.html');
    if (!file) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const bytes = await readFile(file);
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(400);
    response.end('Invalid or unavailable asset');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Sheet product server: http://127.0.0.1:${port} (${root})`);
});
