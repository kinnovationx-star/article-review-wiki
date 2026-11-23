const origin = 'https://kinnovationx-star.github.io';
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Cache-Control': 'no-store',
    };
    const reply = (value, status = 200) => Response.json(value, { status, headers });
    if (url.pathname !== '/comments') return reply({ error: 'Not found' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token || !env.REVIEW_KEY_HASH) return reply({ error: 'Unauthorized' }, 401);
    const digest = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    let diff = 0;
    for (let i = 0; i < 64; i++) diff |= digest.charCodeAt(i) ^ env.REVIEW_KEY_HASH.charCodeAt(i);
    if (diff || env.REVIEW_KEY_HASH.length !== 64) return reply({ error: 'Unauthorized' }, 401);

    try {
      if (request.method === 'GET') {
        const entries = [];
        let cursor;
        do {
          const page = await env.BUCKET.list({ prefix: 'comments/', cursor, limit: 100 });
          const objects = await Promise.all(page.objects.map(item => env.BUCKET.get(item.key)));
          entries.push(...await Promise.all(objects.filter(Boolean).map(item => item.json())));
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        return reply(entries.sort((a, b) => a.created.localeCompare(b.created)));
      }
      if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

      const reader = request.body?.getReader();
      if (!reader) return reply({ error: 'Missing body' }, 400);
      const decode = new TextDecoder();
      let text = '';
      let bytes = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32000) {
          await reader.cancel();
          return reply({ error: 'Body too large' }, 413);
        }
        text += decode.decode(value, { stream: true });
      }
      let input;
      try { input = JSON.parse(text + decode.decode()); } catch { return reply({ error: 'Invalid JSON' }, 400); }
      const { id, anchor, start, end, quote, message } = input ?? {};
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) ||
          typeof anchor !== 'string' || !/^(p-[1-8]|book-(?:[1-9]|10|11))$/.test(anchor) ||
          !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > 2000 ||
          typeof quote !== 'string' || quote.length !== end - start ||
          typeof message !== 'string' || !message.trim() || message.length > 4000) return reply({ error: 'Invalid comment' }, 400);
      const key = 'comments/' + id;
      const previous = await env.BUCKET.get(key);
      if (previous) return reply(await previous.json());
      const saved = { id, anchor, start, end, quote, message: message.trim(), created: new Date().toISOString() };
      await env.BUCKET.put(key, JSON.stringify(saved), { onlyIf: { etagDoesNotMatch: '*' } });
      const final = await env.BUCKET.get(key);
      return reply(final ? await final.json() : saved, 201);
    } catch {
      return reply({ error: 'Comments unavailable' }, 503);
    }
  }
};
