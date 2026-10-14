// Local development server: same API as the Netlify Function, with storage in data.json.
// Handy for testing the app on a phone over your LAN.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { handle } from './lib/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- file-backed key/value store ----------
let data = {};
try {
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!parsed.users) data = parsed; // ignore the pre-Netlify data format
} catch {}
let saveTimer = null;
const store = {
  get: async (key) => data[key] ?? null,
  set: async (key, value) => {
    data[key] = value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(data), () => {}), 300);
  },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  try {
    if (url.pathname.startsWith('/api/')) {
      const { status, body } = await handle(
        {
          method: req.method,
          pathname: url.pathname,
          token: (req.headers.authorization || '').replace(/^Bearer\s+/i, ''),
          body: req.method === 'POST' ? await readBody(req) : undefined,
        },
        store,
      );
      res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(body));
    }
    const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`\nShiftTracker server running`);
  console.log(`  Dashboard:   http://localhost:${PORT}`);
  lan.forEach((ip) => console.log(`  App API URL: http://${ip}:${PORT}   (use this on a real phone)`));
  console.log(`  Demo login:  alex@acme.co / password123\n`);
});
