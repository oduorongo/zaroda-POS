// A pretend Safaricom Daraja B2C for TESTING wage payouts on your own computer - nothing real is contacted and nobody
// is paid.
//
//   node scripts/mock-daraja-b2c.js        (listens on http://localhost:4030)
//
// Point the API at it with MPESA_B2C_BASE_URL=http://localhost:4030. It answers the two calls the API makes -
// /oauth/v1/generate and /mpesa/b2c/v3/paymentrequest - and a moment later posts the result to the ResultURL it was given.
//
// Test behaviour (the real Daraja has none of this):
//   consumer key "wrong-key"            OAuth is refused
//   a phone ending in 000999            the payment fails (ResultCode 2001, wrong initiator details)
//   GET /_test/payments                 everything received so far
const http = require('http');

const PORT = Number(process.env.MOCK_DARAJA_PORT || 4030);
const RUN = Math.random().toString(36).slice(2, 5).toUpperCase();
const payments = [];
let counter = 0;

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

async function settle(p) {
  const ok = !String(p.PartyB).endsWith('000999');
  const receipt = `${RUN}${String(++counter).padStart(7, '0')}`;
  const body = {
    Result: {
      ResultType: 0,
      ResultCode: ok ? 0 : 2001,
      ResultDesc: ok ? 'The service request is processed successfully.' : 'The initiator information is invalid.',
      OriginatorConversationID: p.OriginatorConversationID,
      ConversationID: p.conversationId,
      TransactionID: ok ? receipt : undefined,
      ResultParameters: ok ? { ResultParameter: [{ Key: 'TransactionAmount', Value: p.Amount }, { Key: 'TransactionReceipt', Value: receipt }] } : undefined,
    },
  };
  p.result = body.Result;
  await fetch(p.ResultURL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch((e) => console.log('callback failed', e.message));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/oauth/v1/generate') {
      const key = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':')[0];
      if (key === 'wrong-key') return send(res, 400, { errorMessage: 'Invalid credentials' });
      return send(res, 200, { access_token: `mock-${key}`, expires_in: '3599' });
    }
    if (req.method === 'POST' && url.pathname === '/mpesa/b2c/v3/paymentrequest') {
      const body = await readBody(req);
      if (!body.ResultURL || !body.PartyB || !body.Amount || !Number.isInteger(body.Amount)) return send(res, 400, { errorMessage: 'Bad request' });
      const p = { ...body, conversationId: `AG_${Date.now()}_${++counter}` };
      payments.push(p);
      setTimeout(() => settle(p), 300);
      return send(res, 200, { ConversationID: p.conversationId, OriginatorConversationID: body.OriginatorConversationID, ResponseCode: '0', ResponseDescription: 'Accept the service request successfully.' });
    }
    if (req.method === 'GET' && url.pathname === '/_test/payments') return send(res, 200, payments);
    send(res, 404, { errorMessage: 'Not found' });
  })
  .listen(PORT, () => console.log(`Pretend Daraja B2C on http://localhost:${PORT}`));
