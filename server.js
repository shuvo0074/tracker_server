// Minimal, dependency-free API + dashboard for ShiftTracker.
// Data is kept in memory and persisted to data.json so restarts don't lose history.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_POINTS_PER_SHIFT = 5000;

const SEED_USERS = [
  { id: 'u1', name: 'Alex Rivera', email: 'alex@acme.co', password: 'password123', role: 'Field Technician', color: '#7C5CFF' },
  { id: 'u2', name: 'Priya Shah', email: 'priya@acme.co', password: 'password123', role: 'Delivery Driver', color: '#00C2A8' },
  { id: 'u3', name: 'Sam Okafor', email: 'sam@acme.co', password: 'password123', role: 'Site Supervisor', color: '#FF8A3D' },
];

// ---------- persistence ----------
let db = { users: SEED_USERS, tokens: {}, shifts: [], locations: {} };
if (fs.existsSync(DATA_FILE)) {
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (e) {
    console.warn('Could not read data.json, starting fresh:', e.message);
  }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(db), () => {}), 500);
}

// ---------- live updates (Server-Sent Events) ----------
const sseClients = new Set();
function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) res.write(msg);
}

// ---------- helpers ----------
const publicUser = ({ password, ...u }) => u;
const activeShiftFor = (userId) => db.shifts.find((s) => s.userId === userId && !s.endedAt);

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

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

function auth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const userId = db.tokens[token];
  return userId ? db.users.find((u) => u.id === userId) : null;
}

function employeeSnapshot(user) {
  const shift = activeShiftFor(user.id);
  const lastShift = shift || [...db.shifts].reverse().find((s) => s.userId === user.id);
  const points = lastShift ? db.locations[lastShift.id] || [] : [];
  return {
    ...publicUser(user),
    onShift: Boolean(shift),
    shift: lastShift || null,
    last: points[points.length - 1] || null,
    pointCount: points.length,
  };
}

// ---------- routes ----------
async function api(req, res, url) {
  const { pathname } = url;

  if (req.method === 'POST' && pathname === '/api/login') {
    const { email = '', password = '' } = await readBody(req);
    const user = db.users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
    if (!user || user.password !== password) return send(res, 401, { error: 'Invalid email or password' });
    const token = crypto.randomBytes(24).toString('hex');
    db.tokens[token] = user.id;
    save();
    return send(res, 200, { token, user: publicUser(user), activeShift: activeShiftFor(user.id) || null });
  }

  // Dashboard endpoints (unauthenticated for this demo)
  if (req.method === 'GET' && pathname === '/api/employees') {
    return send(res, 200, db.users.map(employeeSnapshot));
  }
  if (req.method === 'GET' && pathname.startsWith('/api/shifts/') && pathname.endsWith('/locations')) {
    const shiftId = pathname.split('/')[3];
    return send(res, 200, db.locations[shiftId] || []);
  }
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
    return;
  }

  // Everything below needs an employee token
  const user = auth(req);
  if (!user) return send(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET' && pathname === '/api/me') {
    return send(res, 200, { user: publicUser(user), activeShift: activeShiftFor(user.id) || null });
  }

  if (req.method === 'POST' && pathname === '/api/shifts/start') {
    let shift = activeShiftFor(user.id);
    if (!shift) {
      shift = { id: 's_' + crypto.randomBytes(6).toString('hex'), userId: user.id, startedAt: Date.now(), endedAt: null };
      db.shifts.push(shift);
      db.locations[shift.id] = [];
      save();
      broadcast('employee', employeeSnapshot(user));
    }
    return send(res, 200, { shift });
  }

  if (req.method === 'POST' && pathname === '/api/shifts/end') {
    const shift = activeShiftFor(user.id);
    if (shift) {
      shift.endedAt = Date.now();
      save();
      broadcast('employee', employeeSnapshot(user));
    }
    return send(res, 200, { shift: shift || null });
  }

  if (req.method === 'POST' && pathname === '/api/locations') {
    const { shiftId, points } = await readBody(req);
    const shift = db.shifts.find((s) => s.id === shiftId && s.userId === user.id);
    if (!shift) return send(res, 404, { error: 'Unknown shift' });
    if (!Array.isArray(points)) return send(res, 400, { error: 'points must be an array' });

    const list = (db.locations[shift.id] ||= []);
    const clean = points
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy ?? null,
        speed: p.speed ?? null,
        battery: p.battery ?? null,
        recordedAt: p.timestamp ?? Date.now(),
        receivedAt: Date.now(),
      }));
    list.push(...clean);
    list.sort((a, b) => a.recordedAt - b.recordedAt);
    if (list.length > MAX_POINTS_PER_SHIFT) list.splice(0, list.length - MAX_POINTS_PER_SHIFT);
    save();

    if (clean.length) {
      broadcast('location', { userId: user.id, shiftId: shift.id, points: clean });
      broadcast('employee', employeeSnapshot(user));
      const p = clean[clean.length - 1];
      console.log(`📍 ${user.name.padEnd(12)} ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}  (+${clean.length})`);
    }
    return send(res, 200, { accepted: clean.length });
  }

  return send(res, 404, { error: 'Not found' });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 400, { error: e.message });
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
