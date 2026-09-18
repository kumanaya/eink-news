#!/usr/bin/env node
// Serves the built paper over the LAN so the Kindle can open it.
//
//   node tools/serve.mjs [dir] [port] [host]
//
// Zero dependencies, because this runs on the machine that also builds the
// site. It is deliberately boring: correct MIME types, gzip for text, and
// cache headers that keep the paper out of the way of the next edition.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(process.argv[2] || 'dist');
const PORT = Number(process.argv[3] || 8080);
const HOST = process.argv[4] || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.txt']);

if (!existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`error: no index.html under ${ROOT} - run "npm run build" first`);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const method = req.method || 'GET';

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end('method not allowed\n');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request\n');
    return;
  }

  let file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden\n');
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found\n');
    log(method, pathname, 404, 0, started);
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stat = statSync(file);
  const headers = {
    'content-type': type,
    'cache-control': ext === '.html' ? 'no-cache' : 'max-age=300',
    'last-modified': stat.mtime.toUTCString(),
  };

  const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  let body = null;
  if (wantsGzip && COMPRESSIBLE.has(ext)) {
    body = gzipSync(await readFile(file));
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = String(body.length);
  } else {
    headers['content-length'] = String(stat.size);
  }

  res.writeHead(200, headers);
  if (method === 'HEAD') {
    res.end();
    log(method, pathname, 200, headers['content-length'], started);
    return;
  }
  if (body) {
    res.end(body);
    log(method, pathname, 200, body.length, started);
    return;
  }
  createReadStream(file).pipe(res);
  log(method, pathname, 200, stat.size, started);
});

function log(method, pathname, status, bytes, started) {
  const ms = Date.now() - started;
  console.log(`${method} ${pathname} ${status} ${bytes} B ${ms} ms`);
}

server.listen(PORT, HOST, () => {
  const name = HOST === '0.0.0.0' ? 'all interfaces' : HOST;
  console.log(`E-INK NEWS is being printed at http://${name}:${PORT}/`);
  console.log('On the Kindle, open:  http://<this-machine-ip>:' + PORT + '/');
  if (HOST === '0.0.0.0') {
    console.log('If the firewall is on:  sudo ufw allow ' + PORT + '/tcp');
  }
});
