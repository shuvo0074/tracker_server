// Simulates an employee walking a loop so you can see the dashboard move without a phone.
// Usage: node simulate.js [email] [intervalSeconds]
const API = process.env.API_URL || 'http://localhost:4000';
const email = process.argv[2] || 'priya@acme.co';
const intervalSec = Number(process.argv[3]) || 5;

const post = async (path, body, token) => {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

const { token, user } = await post('/api/login', { email, password: 'password123' });
const { shift } = await post('/api/shifts/start', {}, token);
console.log(`Simulating ${user.name} on shift ${shift.id} every ${intervalSec}s (Ctrl+C to end shift)`);

// A small loop around a city block
const center = { lat: 40.7484 + Math.random() * 0.01, lng: -73.9857 + Math.random() * 0.01 };
let t = 0;
let battery = 0.95;
const timer = setInterval(async () => {
  t += 0.08;
  battery = Math.max(0.05, battery - 0.002);
  const point = {
    latitude: center.lat + Math.sin(t) * 0.004,
    longitude: center.lng + Math.cos(t * 0.8) * 0.006,
    accuracy: 5 + Math.random() * 10,
    speed: 1.2 + Math.random(),
    battery,
    timestamp: Date.now(),
  };
  try {
    await post('/api/locations', { shiftId: shift.id, points: [point] }, token);
    process.stdout.write('.');
  } catch (e) {
    console.error('\n' + e.message);
  }
}, intervalSec * 1000);

process.on('SIGINT', async () => {
  clearInterval(timer);
  await post('/api/shifts/end', {}, token).catch(() => {});
  console.log('\nShift ended.');
  process.exit(0);
});
