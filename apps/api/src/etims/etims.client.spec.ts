import { EtimsClient } from './etims.client';

const config = (values: Record<string, string> = {}) =>
  ({ get: (k: string) => values[k] }) as never;
const respond = (body: unknown, status = 200) =>
  jest.fn().mockResolvedValue({
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('EtimsClient', () => {
  it("uses KRA's sandbox and live addresses unless told otherwise", () => {
    const c = new EtimsClient(config());
    expect(c.baseUrl('SANDBOX')).toBe(
      'https://etims-api-sbx.kra.go.ke/etims-api/',
    );
    expect(c.baseUrl('PRODUCTION')).toBe(
      'https://etims-api.kra.go.ke/etims-api/',
    );
    expect(
      new EtimsClient(
        config({ ETIMS_SANDBOX_URL: 'http://localhost:4020/etims-api' }),
      ).baseUrl('SANDBOX'),
    ).toBe('http://localhost:4020/etims-api/');
  });

  it("posts the body as JSON to the method's address and returns KRA's answer", async () => {
    global.fetch = respond({
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: '20261105120000',
      data: { info: { cmcKey: 'k' } },
    }) as never;
    const r = await new EtimsClient(config()).call(
      'SANDBOX',
      '/selectInitOsdcInfo',
      { tin: 'A123456789Z' },
    );
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(
      'https://etims-api-sbx.kra.go.ke/etims-api/selectInitOsdcInfo',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ tin: 'A123456789Z' });
    expect(r).toEqual({
      resultCd: '000',
      resultMsg: 'It is succeeded',
      resultDt: '20261105120000',
      data: { info: { cmcKey: 'k' } },
    });
  });

  it('keeps a "no results" answer as it is (data is null)', async () => {
    global.fetch = respond({
      resultCd: '001',
      resultMsg: 'There is no search result',
      resultDt: '20261105120000',
    }) as never;
    expect(
      await new EtimsClient(config()).call('SANDBOX', 'selectCodeList', {}),
    ).toMatchObject({ resultCd: '001', data: null });
  });

  it('turns a network failure into code 894 instead of throwing', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as never;
    expect(
      await new EtimsClient(config()).call('SANDBOX', 'selectCodeList', {}),
    ).toMatchObject({ resultCd: '894', data: null });
  });

  it('turns an answer that is not JSON (a KRA error page) into code 899', async () => {
    global.fetch = respond('<html>Bad gateway</html>', 502) as never;
    expect(
      await new EtimsClient(config()).call('SANDBOX', 'selectCodeList', {}),
    ).toMatchObject({ resultCd: '899' });
  });

  it('turns JSON with no result code into code 899', async () => {
    global.fetch = respond({ hello: 'world' }) as never;
    expect(
      await new EtimsClient(config()).call('SANDBOX', 'selectCodeList', {}),
    ).toMatchObject({ resultCd: '899' });
  });
});
