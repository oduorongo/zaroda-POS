// A pretend Tuma (tuma.co.ke) for TESTING the online shop on your own
// computer - nothing real is contacted and nobody is charged.
//
//   node scripts/mock-tuma.js            (listens on http://localhost:4010)
//
// It answers the same three calls the API makes - POST /auth/token,
// /payment/stk-push, /payment/status - the way the school system's Tuma
// client (and Tuma's example collection) say the real one does, and posts
// a callback to the callback_url it was given.
//
// Test-only controls (the real Tuma has none of these):
//   POST /_test/pay/:merchantRequestId   mark a push as paid (then send the callback)
//   POST /_test/pay-silent/:merchantRequestId  mark it paid but send NO callback (tests the
//                                        API's own re-check when a callback never arrives)
//   POST /_test/fail/:merchantRequestId  mark it failed (then send the callback)
//   POST /_test/forge/:merchantRequestId send a "completed" callback WITHOUT paying -
//                                        what an attacker could do - to prove the API
//                                        ignores it
//   GET  /_test/pushes                   everything received so far
//
// Accounts: every api_key is accepted except the literal "wrong-key".
const http = require('http');

const PORT = Number(process.env.MOCK_TUMA_PORT || 4010);
const pushes = new Map(); // merchant_request_id -> push record
let counter = 0;

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

async function sendCallback(push, status) {
  const body = {
    merchant_request_id: push.merchant_request_id,
    payment_id: push.payment_id,
    status,
    amount: push.amount,
    ...(status === 'completed' ? { mpesa_receipt_number: push.receipt } : {}),
  };
  try {
    const response = await fetch(push.callback_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return response.status;
  } catch (e) {
    return `callback failed: ${e.message}`;
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const body = req.method === 'POST' ? await readBody(req) : {};
    const route = `${req.method} ${url.pathname}`;

    if (route === 'POST /auth/token') {
      if (!body.email || !body.api_key || body.api_key === 'wrong-key') return send(res, 401, { message: 'Invalid credentials' });
      // A real-looking JWT (unsigned) with a 24h expiry, like Tuma's sample tokens.
      const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const token = `${part({ alg: 'none' })}.${part({ sub: body.email, exp: Math.floor(Date.now() / 1000) + 86400 })}.x`;
      return send(res, 200, { success: true, token });
    }

    if (route === 'POST /payment/stk-push') {
      if (!(req.headers.authorization || '').startsWith('Bearer ')) return send(res, 401, { message: 'Unauthorized' });
      if (!(Number(body.amount) >= 1) || !/^254[17]\d{8}$/.test(String(body.phone))) {
        return send(res, 400, { message: 'amount must be at least 1 and phone must look like 2547XXXXXXXX' });
      }
      counter += 1;
      const push = {
        merchant_request_id: `MR-${Date.now()}-${counter}`,
        payment_id: `PAY-${counter}`,
        checkout_request_id: `CO-${counter}`,
        amount: Number(body.amount),
        phone: body.phone,
        description: body.description,
        callback_url: body.callback_url,
        status: 'pending',
        receipt: `QTEST${String(counter).padStart(5, '0')}`,
      };
      pushes.set(push.merchant_request_id, push);
      return send(res, 201, {
        success: true,
        message: 'STK push initiated successfully',
        data: { payment_id: push.payment_id, merchant_request_id: push.merchant_request_id, checkout_request_id: push.checkout_request_id, amount: push.amount, phone: push.phone },
      });
    }

    if (route === 'POST /payment/status') {
      const push = pushes.get(body.merchant_request_id);
      if (!push) return send(res, 404, { message: 'Unknown payment' });
      return send(res, 200, {
        status: push.status,
        amount: push.amount,
        ...(push.status === 'completed' ? { mpesa_receipt_number: push.receipt } : {}),
      });
    }

    const silent = url.pathname.match(/^\/_test\/pay-silent\/(.+)$/);
    if (req.method === 'POST' && silent) {
      const push = pushes.get(decodeURIComponent(silent[1]));
      if (!push) return send(res, 404, { message: 'Unknown payment' });
      push.status = 'completed';
      return send(res, 200, { ok: true, status: push.status, callbackSent: false });
    }

    const test = url.pathname.match(/^\/_test\/(pay|fail|forge)\/(.+)$/);
    if (req.method === 'POST' && test) {
      const push = pushes.get(decodeURIComponent(test[2]));
      if (!push) return send(res, 404, { message: 'Unknown payment' });
      if (test[1] === 'pay') push.status = 'completed';
      if (test[1] === 'fail') push.status = 'failed';
      const callbackStatus = await sendCallback(push, test[1] === 'fail' ? 'failed' : 'completed');
      return send(res, 200, { ok: true, status: push.status, callbackAnsweredWith: callbackStatus });
    }

    if (route === 'GET /_test/pushes') return send(res, 200, Array.from(pushes.values()));
    return send(res, 404, { message: `No route ${route}` });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Pretend Tuma listening on http://localhost:${PORT}`));
