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

async function verify(key) {
  if (typeof key !== 'string' || !/^[a-z0-9-]{12,128}$/i.test(key)) return false;
  try {
    const result = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ product_id: productId, license_key: key, increment_uses_count: 'false' })
    });
    if (result.status === 404) return false;
    if (!result.ok) throw new Error('Verification unavailable');
    const data = await result.json();
    return data.success === true && active(data.purchase);
  } catch {
    return reply(res, 503, { error: 'verification_unavailable' });
  }
}

const tool = {
  name: 'verify_membership',
  description: 'Check a supplied Ayn Store membership key. Return only the access decision.',
  inputSchema: { type: 'object', properties: { license_key: { type: 'string', maxLength: 128 } }, required: ['license_key'], additionalProperties: false }
};

async function rpc(message, res) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
  }
  const { id, method, params } = message;
  if (id === undefined) {
    res.writeHead(202);
    return res.end();
  }
  let result;
  switch (method) {
    case 'initialize':
      result = { protocolVersion: '2025-06-18', serverInfo: { name: 'ayn-store-license', version: '1.0.0' }, capabilities: { tools: {} } };
      break;
    case 'ping': result = {}; break;
    case 'tools/list': result = { tools: [tool] }; break;
    case 'tools/call':
      if (params?.name !== tool.name) return reply(res, 200, { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } });
      try {
        const active = await verify(params.arguments?.license_key);
        result = { content: [{ type: 'text', text: JSON.stringify({ active }) }] };
      } catch {
        result = { isError: true, content: [{ type: 'text', text: 'Verification unavailable; retry later.' }] };
      }
      break;
    default: return reply(res, 200, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }
  return reply(res, 200, { jsonrpc: '2.0', id, result });
}

http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true });
  if (!['/verify', '/mcp'].includes(req.url)) return reply(res, 404, {});
  if (req.headers.origin && req.headers.origin !== 'https://chatgpt.com' && req.headers.origin !== 'https://ayn-store-license.onrender.com') return reply(res, 403, {});
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(res, 405, {}); }
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(res, 415, {});
  let size = 0;
  const chunks = [];
  let body;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) return reply(res, 413, {});
      chunks.push(chunk);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return reply(res, 400, {}); }
  if (req.url === '/mcp') return rpc(body, res);
  const key = body?.license_key;
  if (typeof key !== 'string' || !/^[a-z0-9-]{12,128}$/i.test(key)) return reply(res, 400, { active: false });
  try { return reply(res, 200, { active: await verify(key) }); }
  catch { return reply(res, 503, { error: 'verification_unavailable' }); }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0');
