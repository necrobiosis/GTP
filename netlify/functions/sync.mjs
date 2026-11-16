// 多设备同步（Netlify 函数）：按「同步码」存一份学习进度。知道同步码的设备都能读、能写，所以同步码要像密码一样保管。
// 只存进度（读到哪一关、爱心、金币、生字库、花园……），不存照片。
import { getStore } from '@netlify/blobs';

const HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  const code = (new URL(req.url).searchParams.get('code') || '').toLowerCase();
  if (!/^[a-z0-9]{8,24}$/.test(code)) return json({ error: 'bad-code' }, 400);
  const store = getStore('family-sync');
  if (req.method === 'GET') {
    const saved = await store.get(code, { type: 'json' });
    return saved ? json(saved) : json({ error: 'not-found' }, 404);
  }
  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > 400000) return json({ error: 'too-big' }, 413);
    let body;
    try { body = JSON.parse(text); } catch (e) { return json({ error: 'bad-json' }, 400); }
    if (!body || typeof body.state !== 'string' || typeof body.at !== 'number') return json({ error: 'bad-body' }, 400);
    await store.setJSON(code, { at: body.at, state: body.state });
    return json({ ok: true, at: body.at });
  }
  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/sync' };
