import http from 'node:http';

const productId = '1lP-POUWmspqNspsD5Kcxw==';

function active(purchase, now = Date.now()) {
  if (purchase?.product_id !== productId || !purchase.subscription_id) return false;
  if (purchase.refunded !== false || purchase.chargebacked !== false) return false;
  if (purchase.disputed !== false && purchase.dispute_won !== true) return false;
  return ['subscription_ended_at', 'subscription_cancelled_at', 'subscription_failed_at']
    .every(field => purchase[field] === null || Date.parse(purchase[field]) > now);
}

function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/verify') return reply(res, 404, {});
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(res, 415, {});
  let body = '';
  let key;
  try {
    for await (const chunk of req) {
      if (body.length + chunk.length > 2048) return reply(res, 413, {});
      body += chunk.toString();
    }
    key = JSON.parse(body)?.license_key;
  } catch {
    return reply(res, 400, {});
  }
  if (typeof key !== 'string' || !/^[a-z0-9-]{12,128}$/i.test(key)) return reply(res, 400, { active: false });
  try {
    const result = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ product_id: productId, license_key: key, increment_uses_count: 'false' })
    });
    if (result.status === 404) return reply(res, 200, { active: false });
    if (!result.ok) return reply(res, 503, { error: 'verification_unavailable' });
    const data = await result.json();
    return reply(res, 200, { active: data.success === true && active(data.purchase) });
  } catch {
    return reply(res, 503, { error: 'verification_unavailable' });
  }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0');
