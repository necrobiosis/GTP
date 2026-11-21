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
  const store = getStore({ name: 'family-sync', consistency: 'strong' }); // 写完马上能读到，两台设备不会互相看到旧的
  if (req.method === 'GET') {
    const saved = await store.getWithMetadata(code, { type: 'json' });
    if (!saved) return json({ error: 'not-found' }, 404);
    const state = JSON.parse(saved.data.state);
    let version = saved.etag;
    if (Object.hasOwn(state, 'myName')) {
      delete state.myName;
      saved.data.state = JSON.stringify(state);
      const cleaned = await store.setJSON(code, saved.data, { onlyIfMatch: version });
      if (!cleaned.modified) return json({ error: 'retry' }, 409);
      version = cleaned.etag;
    }
    return json({ ...saved.data, version });
  }
  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > 400000) return json({ error: 'too-big' }, 413);
    let body;
    try { body = JSON.parse(text); } catch (e) { return json({ error: 'bad-json' }, 400); }
    if (!body || typeof body.state !== 'string' || typeof body.at !== 'number') return json({ error: 'bad-body' }, 400);
    if (body.version !== null && typeof body.version !== 'string') return json({ error: 'version-required' }, 428);
    let state;
    try { state = JSON.parse(body.state); } catch { return json({ error: 'bad-state' }, 400); }
    if (!state || typeof state !== 'object' || Array.isArray(state)) return json({ error: 'bad-state' }, 400);
    delete state.myName;
    const condition = body.version === null ? { onlyIfNew: true } : { onlyIfMatch: body.version };
    const result = await store.setJSON(code, { at: body.at, state: JSON.stringify(state) }, condition);
    if (!result.modified) return json({ error: 'retry' }, 409);
    return json({ ok: true, at: body.at });
  }
  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/sync' };
