// Netlify Function serving every /api/* route. Data lives in Netlify Blobs.
import { getStore } from '@netlify/blobs';
import { handle } from '../../lib/core.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // Strong consistency so a shift started in one request is visible to the next one immediately
  const blobs = getStore({ name: 'tracker', consistency: 'strong' });
  const store = {
    get: (key) => blobs.get(key, { type: 'json' }),
    set: (key, value) => blobs.setJSON(key, value),
  };

  let body;
  if (request.method === 'POST') {
    try {
      const raw = await request.text();
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS });
    }
  }

  const { status, body: out } = await handle(
    {
      method: request.method,
      pathname: new URL(request.url).pathname,
      token: (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''),
      body,
    },
    store,
  );
  return Response.json(out, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });
};

export const config = { path: '/api/*' };
