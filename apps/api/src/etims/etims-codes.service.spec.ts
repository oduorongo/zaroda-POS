/* eslint-disable @typescript-eslint/no-explicit-any */
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { EtimsCodesService } from './etims-codes.service';

const inTenant = <T>(fn: () => Promise<T>) =>
  tenantContext.run(
    { organizationId: 'org-1', orgUserId: 'u1', role: Role.OWNER },
    fn,
  );
const ok = (data: unknown, dt = '20261105120000') => ({
  resultCd: '000',
  resultMsg: 'ok',
  resultDt: dt,
  data,
});
const none = {
  resultCd: '001',
  resultMsg: 'none',
  resultDt: '20261105120000',
  data: null,
};

function setup(
  answers: { codes: any; items: any },
  last: { kind: string; lastReqDt: string }[] = [],
) {
  const inserts: string[] = [];
  const state: Record<string, string> = {};
  const tx = {
    etimsSyncState: {
      findMany: jest.fn().mockResolvedValue(last),
      upsert: jest
        .fn()
        .mockImplementation(
          async (a: any) => ((state[a.create.kind] = a.create.lastReqDt), {}),
        ),
    },
    // the first parameter of a raw insert is the environment; the second is the JSON of the rows written
    $executeRaw: jest
      .fn()
      .mockImplementation(
        async (strings: TemplateStringsArray, ...values: unknown[]) => {
          inserts.push(
            `${strings.join('?').includes('etims_codes') ? 'codes' : 'items'}:${(JSON.parse(String(values[1])) as unknown[]).length}`,
          );
          return 1;
        },
      ),
  };
  const tenantPrisma = {
    run: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const client = {
    call: jest
      .fn()
      .mockImplementation(async (_e: string, path: string) =>
        path === 'selectCodeList' ? answers.codes : answers.items,
      ),
  };
  const settings = {
    credentials: jest.fn().mockResolvedValue({
      environment: 'SANDBOX',
      tin: 'A123456789Z',
      bhfId: '00',
      cmcKey: 'k',
    }),
  };
  const audit = { logInTx: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new EtimsCodesService(
      tenantPrisma as never,
      audit as never,
      client as never,
      settings as never,
    ),
    client,
    tx,
    state,
    settings,
    inserts,
  };
}

describe('EtimsCodesService.sync', () => {
  it("asks for everything the first time, with the device's PIN, branch and key", async () => {
    const s = setup({ codes: none, items: none });
    await inTenant(() => s.service.sync());
    expect(s.client.call).toHaveBeenCalledWith('SANDBOX', 'selectCodeList', {
      tin: 'A123456789Z',
      bhfId: '00',
      cmcKey: 'k',
      lastReqDt: '20180101000000',
    });
    expect(s.client.call).toHaveBeenCalledWith('SANDBOX', 'selectItemClsList', {
      tin: 'A123456789Z',
      bhfId: '00',
      cmcKey: 'k',
      lastReqDt: '20180101000000',
    });
  });

  it("asks only for what changed since last time, and remembers KRA's own time", async () => {
    const s = setup(
      { codes: ok({ clsList: [] }, '20261106010101'), items: none },
      [
        { kind: 'codes', lastReqDt: '20261105120000' },
        { kind: 'itemClasses', lastReqDt: '20261104000000' },
      ],
    );
    await inTenant(() => s.service.sync());
    expect(s.client.call).toHaveBeenCalledWith(
      'SANDBOX',
      'selectCodeList',
      expect.objectContaining({ lastReqDt: '20261105120000' }),
    );
    expect(s.client.call).toHaveBeenCalledWith(
      'SANDBOX',
      'selectItemClsList',
      expect.objectContaining({ lastReqDt: '20261104000000' }),
    );
    expect(s.state.codes).toBe('20261106010101');
  });

  it('counts what came down, writing a repeated row once, and says when nothing changed', async () => {
    const codes = ok({
      clsList: [
        {
          cdCls: '04',
          cdClsNm: 'Tax',
          dtlList: [
            { cd: 'A', cdNm: 'A' },
            { cd: 'B', cdNm: 'B', userDfnCd1: '16' },
          ],
        },
        { cdCls: '10', cdClsNm: 'Unit', dtlList: [{ cd: 'U', cdNm: 'Piece' }] },
      ],
    });
    const items = ok({
      itemClsList: [
        { itemClsCd: '1', itemClsNm: 'x' },
        { itemClsCd: '1', itemClsNm: 'x again' },
        { itemClsCd: '2', itemClsNm: 'y' },
      ],
    });
    const s = setup({ codes, items });
    expect(await inTenant(() => s.service.sync())).toEqual({
      codes: 3,
      itemClasses: 3,
      upToDate: false,
    });
    expect(s.inserts).toContain('items:2'); // the repeated classification is written once
    expect(
      await inTenant(() => setup({ codes: none, items: none }).service.sync()),
    ).toEqual({ codes: 0, itemClasses: 0, upToDate: true });
  });

  it('writes in chunks, so a big list does not become one huge statement', async () => {
    const itemClsList = Array.from({ length: 2500 }, (_, i) => ({
      itemClsCd: String(i),
      itemClsNm: `n${i}`,
    }));
    const s = setup({ codes: none, items: ok({ itemClsList }) });
    await inTenant(() => s.service.sync());
    expect(s.inserts.filter((x) => x.startsWith('items'))).toEqual([
      'items:1000',
      'items:1000',
      'items:500',
    ]);
  });

  it('a KRA error stops the sync and says why; nothing is written or remembered', async () => {
    const s = setup({
      codes: {
        resultCd: '901',
        resultMsg: 'It is not valid device',
        resultDt: '',
        data: null,
      },
      items: none,
    });
    await expect(inTenant(() => s.service.sync())).rejects.toThrow(
      /does not recognise this device/,
    );
    expect(s.tx.$executeRaw).not.toHaveBeenCalled();
    expect(s.tx.etimsSyncState.upsert).not.toHaveBeenCalled();
  });

  it('needs a connected device', async () => {
    const s = setup({ codes: none, items: none });
    s.settings.credentials.mockResolvedValue(null);
    await expect(inTenant(() => s.service.sync())).rejects.toThrow(
      /connect a branch/,
    );
    expect(s.client.call).not.toHaveBeenCalled();
  });
});
