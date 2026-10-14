// Platform-independent API logic. Used by the local Node server (server.js, file storage)
// and the Netlify Function (netlify/functions/api.mjs, Netlify Blobs storage).
//
// `store` must implement: get(key) -> Promise<any|null>, set(key, value) -> Promise<void>
import crypto from 'node:crypto';

const MAX_POINTS_PER_SHIFT = 5000;

export const USERS = [
  { id: 'u1', name: 'Alex Rivera', email: 'alex@acme.co', password: 'password123', role: 'Field Technician', color: '#7C5CFF' },
  { id: 'u2', name: 'Priya Shah', email: 'priya@acme.co', password: 'password123', role: 'Delivery Driver', color: '#00C2A8' },
  { id: 'u3', name: 'Sam Okafor', email: 'sam@acme.co', password: 'password123', role: 'Site Supervisor', color: '#FF8A3D' },
];

const publicUser = ({ password, ...u }) => u;
const ok = (body) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });

async function activeShift(store, userId) {
  const id = await store.get(`active/${userId}`);
  return id ? store.get(`shift/${id}`) : null;
}

async function employeeSnapshot(store, user) {
  const activeId = await store.get(`active/${user.id}`);
  const shiftId = activeId || (await store.get(`last/${user.id}`));
  const shift = shiftId ? await store.get(`shift/${shiftId}`) : null;
  const meta = shiftId ? await store.get(`meta/${shiftId}`) : null;
  return {
    ...publicUser(user),
    onShift: Boolean(activeId),
    shift,
    last: meta?.last ?? null,
    pointCount: meta?.count ?? 0,
  };
}

/**
 * @param {{method: string, pathname: string, token?: string, body?: any}} req
 * @returns {Promise<{status: number, body: any}>}
 */
export async function handle(req, store) {
  const { method, pathname } = req;
  const body = req.body ?? {};

  if (method === 'POST' && pathname === '/api/login') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const user = USERS.find((u) => u.email === email);
    if (!user || user.password !== body.password) return fail(401, 'Invalid email or password');
    const token = crypto.randomBytes(24).toString('hex');
    await store.set(`token/${token}`, user.id);
    return ok({ token, user: publicUser(user), activeShift: await activeShift(store, user.id) });
  }

  // Dashboard endpoints (unauthenticated for this demo)
  if (method === 'GET' && pathname === '/api/employees') {
    return ok(await Promise.all(USERS.map((u) => employeeSnapshot(store, u))));
  }
  const trail = pathname.match(/^\/api\/shifts\/([\w-]+)\/locations$/);
  if (method === 'GET' && trail) {
    return ok((await store.get(`points/${trail[1]}`)) ?? []);
  }

  // Everything below needs an employee token
  const userId = req.token ? await store.get(`token/${req.token}`) : null;
  const user = USERS.find((u) => u.id === userId);
  if (!user) return fail(401, 'Unauthorized');

  if (method === 'GET' && pathname === '/api/me') {
    return ok({ user: publicUser(user), activeShift: await activeShift(store, user.id) });
  }

  if (method === 'POST' && pathname === '/api/shifts/start') {
    let shift = await activeShift(store, user.id);
    if (!shift) {
      shift = { id: 's_' + crypto.randomBytes(6).toString('hex'), userId: user.id, startedAt: Date.now(), endedAt: null };
      await store.set(`shift/${shift.id}`, shift);
      await store.set(`active/${user.id}`, shift.id);
      await store.set(`last/${user.id}`, shift.id);
    }
    return ok({ shift });
  }

  if (method === 'POST' && pathname === '/api/shifts/end') {
    const shift = await activeShift(store, user.id);
    if (shift) {
      shift.endedAt = Date.now();
      await store.set(`shift/${shift.id}`, shift);
      await store.set(`active/${user.id}`, null);
    }
    return ok({ shift });
  }

  if (method === 'POST' && pathname === '/api/locations') {
    const shift = body.shiftId ? await store.get(`shift/${body.shiftId}`) : null;
    if (!shift || shift.userId !== user.id) return fail(404, 'Unknown shift');
    if (!Array.isArray(body.points)) return fail(400, 'points must be an array');

    const now = Date.now();
    const clean = body.points
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy ?? null,
        speed: p.speed ?? null,
        battery: p.battery ?? null,
        recordedAt: p.timestamp ?? now,
        receivedAt: now,
      }));

    if (clean.length) {
      const list = (await store.get(`points/${shift.id}`)) ?? [];
      list.push(...clean);
      list.sort((a, b) => a.recordedAt - b.recordedAt);
      if (list.length > MAX_POINTS_PER_SHIFT) list.splice(0, list.length - MAX_POINTS_PER_SHIFT);
      await store.set(`points/${shift.id}`, list);
      await store.set(`meta/${shift.id}`, { last: list[list.length - 1], count: list.length });
      const p = clean[clean.length - 1];
      console.log(`📍 ${user.name.padEnd(12)} ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}  (+${clean.length})`);
    }
    return ok({ accepted: clean.length });
  }

  return fail(404, 'Not found');
}
