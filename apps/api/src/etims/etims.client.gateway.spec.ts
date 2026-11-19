import { EtimsClient } from './etims.client';

const config = (values: Record<string, string> = {}) => ({ get: (k: string) => values[k] }) as never;
const KEYS = { ETIMS_SANDBOX_CONSUMER_KEY: 'ck', ETIMS_SANDBOX_CONSUMER_SECRET: 'cs' };
const ok = { resultCd: '000', resultMsg: 'It is succeeded', resultDt: '20261119120000', data: null };
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

type Call = { url: string; init: { method: string; headers: Record<string, string>; body?: string } };

/** A pretend KRA: the token address hands out tokens, the eTIMS address answers with `etims` (one per call, last one repeats). */
function kra(opts: { tokens?: (string | null)[]; etims?: { status: number; body: unknown }[] } = {}) {
  const calls: Call[] = [];
  const tokens = [...(opts.tokens ?? ['t1', 't2'])];
  const etims = [...(opts.etims ?? [{ status: 200, body: ok }])];
  global.fetch = jest.fn(async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    if (url.includes('/token/generate')) {
      const t = tokens.shift();
      return t ? { ok: true, status: 200, json: async () => ({ access_token: t, expires_in: '3599' }) } : { ok: false, status: 401, json: async () => ({ fault: 'bad' }) };
    }
    const r = etims.length > 1 ? etims.shift()! : etims[0];
    return { status: r.status, text: async () => JSON.stringify(r.body) };
  }) as never;
  return calls;
}

const sale = { tin: 'P051234567X', bhfId: '00', cmcKey: 'secret-cmc', invcNo: 1 };

describe('EtimsClient through KRA GavaConnect', () => {
  it('without a consumer key, calls go out as before: no token, no extra headers', async () => {
    const calls = kra();
    const c = new EtimsClient(config());
    expect(c.usesGateway('SANDBOX')).toBe(false);
    await c.call('SANDBOX', 'saveTrnsSalesOsdc', sale);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json' });
  });

  it('with a key, swaps it for a token (Basic key:secret, client credentials) and sends the token and business headers', async () => {
    const calls = kra();
    const c = new EtimsClient(config(KEYS));
    const r = await c.call('SANDBOX', 'saveTrnsSalesOsdc', sale);
    expect(r.resultCd).toBe('000');
    expect(calls[0].url).toBe('https://sbx.kra.go.ke/v1/token/generate?grant_type=client_credentials');
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${Buffer.from('ck:cs').toString('base64')}`);
    expect(calls[1].url).toBe('https://etims-api-sbx.kra.go.ke/etims-api/saveTrnsSalesOsdc');
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Bearer t1', tin: 'P051234567X', bhfId: '00', cmcKey: 'secret-cmc' });
    expect(JSON.parse(calls[1].init.body!)).toEqual(sale);
  });

  it('reuses the token until it is about to expire', async () => {
    const calls = kra();
    const c = new EtimsClient(config(KEYS));
    await c.call('SANDBOX', 'selectCodeList', sale);
    await c.call('SANDBOX', 'selectItemClsList', sale);
    expect(calls.filter((x) => x.url.includes('/token/generate'))).toHaveLength(1);
  });

  it('device sign-up carries only the token, no business headers', async () => {
    const calls = kra();
    await new EtimsClient(config(KEYS)).call('SANDBOX', 'selectInitOsdcInfo', { tin: 'P051234567X', bhfId: '00', dvcSrlNo: 'ZRD-1' });
    expect(calls[1].init.headers.Authorization).toBe('Bearer t1');
    expect(calls[1].init.headers.tin).toBeUndefined();
    expect(calls[1].init.headers.cmcKey).toBeUndefined();
  });

  it('a 401 from the gateway gets a fresh token and one retry', async () => {
    const calls = kra({ etims: [{ status: 401, body: { fault: { faultstring: 'Invalid Access Token' } } }, { status: 200, body: ok }] });
    const r = await new EtimsClient(config(KEYS)).call('SANDBOX', 'saveItem', sale);
    expect(r.resultCd).toBe('000');
    expect(calls.map((x) => (x.url.includes('token') ? 'token' : 'etims'))).toEqual(['token', 'etims', 'token', 'etims']);
    expect(calls[3].init.headers.Authorization).toBe('Bearer t2');
  });

  it('a refused key becomes a clear 894 answer and nothing is sent to eTIMS', async () => {
    const calls = kra({ tokens: [null] });
    const r = await new EtimsClient(config(KEYS)).call('SANDBOX', 'saveItem', sale);
    expect(r).toMatchObject({ resultCd: '894' });
    expect(r.resultMsg).toMatch(/consumer key and secret/);
    expect(calls).toHaveLength(1);
  });

  it("a gateway refusal without a result code says what the gateway said", async () => {
    kra({ etims: [{ status: 403, body: { fault: { faultstring: 'Not subscribed to this API' } } }] });
    const r = await new EtimsClient(config(KEYS)).call('SANDBOX', 'saveItem', sale);
    expect(r).toMatchObject({ resultCd: '899' });
    expect(r.resultMsg).toMatch(/Not subscribed to this API/);
  });

  it('live uses its own keys and the live token address', async () => {
    const calls = kra();
    const c = new EtimsClient(config({ ...KEYS, ETIMS_PRODUCTION_CONSUMER_KEY: 'pk', ETIMS_PRODUCTION_CONSUMER_SECRET: 'ps' }));
    await c.call('PRODUCTION', 'saveItem', sale);
    expect(calls[0].url).toBe('https://api.kra.go.ke/v1/token/generate?grant_type=client_credentials');
    expect(calls[0].init.headers.Authorization).toBe(`Basic ${Buffer.from('pk:ps').toString('base64')}`);
    expect(calls[1].url).toBe('https://etims-api.kra.go.ke/etims-api/saveItem');
  });
});
