/* eslint-disable @typescript-eslint/no-explicit-any */
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { EtimsItemsService, REGISTER_BATCH } from './etims-items.service';

const inTenant = <T>(fn: () => Promise<T>) =>
  tenantContext.run(
    { organizationId: 'org-1', orgUserId: 'ou-1', role: Role.OWNER },
    fn,
  );

const TAX_CODES = [
  { cdCls: '04', cd: 'A', userDfnCd1: '0' },
  { cdCls: '04', cd: 'B', userDfnCd1: '16' },
  { cdCls: '04', cd: 'C', userDfnCd1: '0' },
  { cdCls: '04', cd: 'D', userDfnCd1: '0' },
  { cdCls: '04', cd: 'E', userDfnCd1: '8' },
  { cdCls: '10', cd: 'U', userDfnCd1: null },
  { cdCls: '10', cd: 'KG', userDfnCd1: null },
  { cdCls: '17', cd: 'NT', userDfnCd1: null },
  { cdCls: '24', cd: '2', userDfnCd1: null },
  { cdCls: '24', cd: '3', userDfnCd1: null },
];

const variant = (id: string, over: Record<string, any> = {}) => ({
  id,
  sku: `SKU-${id}`,
  name: null,
  barcode: null,
  price: 100,
  quantityMode: 'COUNT',
  product: {
    name: `Product ${id}`,
    isActive: true,
    taxClass: { name: 'VAT', rate: 0.16, isExempt: false },
  },
  etimsItem: null,
  hotelRoomType: null,
  ...over,
});
const mapping = (over: Record<string, any> = {}) => ({
  itemCd: null,
  itemClsCd: '5059690800',
  itemTyCd: '2',
  pkgUnitCd: 'NT',
  qtyUnitCd: 'U',
  taxTyCd: null,
  status: 'NOT_SENT',
  sentHash: null,
  lastError: null,
  registeredAt: null,
  ...over,
});

function setup(variants: any[], answers: ((body: any) => any)[] = []) {
  let seq = 0;
  const db: Record<string, any> = Object.fromEntries(
    variants.map((v) => [v.id, v]),
  );
  const tx: any = {
    etimsSetting: {
      findFirst: jest.fn().mockResolvedValue({ environment: 'SANDBOX' }),
    },
    etimsCode: { findMany: jest.fn().mockResolvedValue(TAX_CODES) },
    etimsItemClass: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ itemClsCd: '5059690800', useYn: 'Y' }),
    },
    productVariant: {
      findMany: jest.fn().mockImplementation(async () => Object.values(db)),
      findUnique: jest
        .fn()
        .mockImplementation(async ({ where }: any) => db[where.id] ?? null),
    },
    etimsItem: {
      findUnique: jest
        .fn()
        .mockImplementation(
          async ({ where }: any) => db[where.variantId]?.etimsItem ?? null,
        ),
      upsert: jest
        .fn()
        .mockImplementation(async ({ where, create, update }: any) => {
          const v = db[where.variantId];
          v.etimsItem = v.etimsItem
            ? { ...v.etimsItem, ...update }
            : { ...mapping({ itemClsCd: null }), ...create };
          return v.etimsItem;
        }),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const v = db[where.variantId];
        v.etimsItem = { ...v.etimsItem, ...data };
        return v.etimsItem;
      }),
    },
    orgUser: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ user: { fullName: 'Wanjiru Kamau' } }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockImplementation(async () => [{ itemSeq: ++seq }]),
  };
  const tenantPrisma = {
    run: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const audit = { logInTx: jest.fn().mockResolvedValue(undefined) };
  const sent: any[] = [];
  const client = {
    call: jest
      .fn()
      .mockImplementation(async (_e: string, _p: string, body: any) => {
        sent.push(body);
        const make =
          answers[sent.length - 1] ??
          (() => ({
            resultCd: '000',
            resultMsg: 'ok',
            resultDt: '',
            data: null,
          }));
        return make(body);
      }),
  };
  const settings = {
    credentials: jest
      .fn()
      .mockResolvedValue({
        environment: 'SANDBOX',
        tin: 'A123456789Z',
        bhfId: '00',
        cmcKey: 'k',
      }),
  };
  return {
    service: new EtimsItemsService(
      tenantPrisma as never,
      audit as never,
      client as never,
      settings as never,
    ),
    tx,
    client,
    sent,
    db,
    settings,
  };
}

describe('the product list', () => {
  it('shows where each product stands and counts them', async () => {
    const s = setup([
      variant('a'),
      variant('b', { etimsItem: mapping() }),
      variant('c', {
        etimsItem: mapping({ status: 'REJECTED', lastError: 'no' }),
      }),
    ]);
    const r = await inTenant(() => s.service.list({}));
    expect(r.counts).toMatchObject({
      NEEDS_SETUP: 1,
      READY: 1,
      REJECTED: 1,
      REGISTERED: 0,
    });
    expect(r.rows.find((x) => x.variantId === 'a')).toMatchObject({
      state: 'NEEDS_SETUP',
      problems: ["Choose KRA's product classification"],
      taxTyCd: 'B',
    });
    expect(r.listsDownloaded).toBe(true);
  });
  it('works out the tax type from the tax class, the unit from how it is sold, and a hotel room as a service', async () => {
    const s = setup([
      variant('kg', {
        quantityMode: 'WEIGHT',
        product: {
          name: 'Rice',
          isActive: true,
          taxClass: { name: 'Exempt', rate: 0, isExempt: true },
        },
      }),
      variant('room', { hotelRoomType: { id: 'r' } }),
    ]);
    const rows = (await inTenant(() => s.service.list({}))).rows;
    expect(rows.find((x) => x.variantId === 'kg')).toMatchObject({
      qtyUnitCd: 'KG',
      taxTyCd: 'A',
    });
    expect(rows.find((x) => x.variantId === 'room')).toMatchObject({
      itemTyCd: '3',
    });
  });
  it('a registered item whose price has changed since needs an update', async () => {
    const s = setup([
      variant('a', {
        etimsItem: mapping({ status: 'REGISTERED', itemCd: 'KE2NTU0000001' }),
      }),
    ]);
    await inTenant(() => s.service.register({ variantIds: ['a'] })); // sends and fingerprints
    s.db.a.price = 120;
    expect((await inTenant(() => s.service.list({}))).rows[0].state).toBe(
      'NEEDS_UPDATE',
    );
  });
  it('filters by state and by search, and pages', async () => {
    const s = setup([variant('a'), variant('b', { etimsItem: mapping() })]);
    expect(
      (await inTenant(() => s.service.list({ state: 'READY' }))).rows.map(
        (r) => r.variantId,
      ),
    ).toEqual(['b']);
    expect((await inTenant(() => s.service.list({}))).total).toBe(2);
  });
});

describe('choosing the classification and units', () => {
  it('saves a classification KRA has, and refuses one it does not', async () => {
    const s = setup([variant('a')]);
    await inTenant(() => s.service.update('a', { itemClsCd: '5059690800' }));
    expect(s.db.a.etimsItem.itemClsCd).toBe('5059690800');
    s.tx.etimsItemClass.findUnique.mockResolvedValue(null);
    await expect(
      inTenant(() => s.service.update('a', { itemClsCd: '1' })),
    ).rejects.toThrow(/no product classification/);
  });
  it('refuses a unit KRA does not list', async () => {
    const s = setup([variant('a')]);
    await expect(
      inTenant(() => s.service.update('a', { qtyUnitCd: 'ZZZ' })),
    ).rejects.toThrow(/no unit of quantity "ZZZ"/);
    await expect(
      inTenant(() => s.service.update('a', { pkgUnitCd: 'QQ' })),
    ).rejects.toThrow(/no packaging unit/);
  });
  it('says to download the lists first when there are none', async () => {
    const s = setup([variant('a')]);
    s.tx.etimsCode.findMany.mockResolvedValue([]);
    s.tx.etimsItemClass.findUnique.mockResolvedValue(null);
    await expect(
      inTenant(() => s.service.update('a', { itemClsCd: '5059690800' })),
    ).rejects.toThrow(/Download KRA's lists first/);
  });
  it('changing a rejected item lets it be sent again', async () => {
    const s = setup([
      variant('a', {
        etimsItem: mapping({ status: 'REJECTED', lastError: 'KRA said no' }),
      }),
    ]);
    await inTenant(() =>
      s.service.update('a', { itemClsCd: '5059690800', qtyUnitCd: 'KG' }),
    );
    expect(s.db.a.etimsItem).toMatchObject({
      status: 'NOT_SENT',
      lastError: null,
      qtyUnitCd: 'KG',
    });
  });
  it('gives one classification to many products at once', async () => {
    const s = setup([variant('a'), variant('b')]);
    expect(
      await inTenant(() => s.service.classify(['a', 'b', 'a'], '5059690800')),
    ).toEqual({ updated: 2 });
    expect(s.db.a.etimsItem.itemClsCd).toBe('5059690800');
    expect(s.db.b.etimsItem.itemClsCd).toBe('5059690800');
  });
});

describe('registering with KRA', () => {
  it('gives the item its code, sends what the spec asks for, and records that KRA has it', async () => {
    const s = setup([
      variant('a', {
        barcode: '616110001',
        name: 'Large',
        etimsItem: mapping(),
      }),
    ]);
    const r = await inTenant(() => s.service.register({ variantIds: ['a'] }));
    expect(r).toMatchObject({
      sent: 1,
      skipped: 0,
      failed: [],
      remaining: 0,
      stopped: null,
    });
    expect(s.sent[0]).toMatchObject({
      tin: 'A123456789Z',
      bhfId: '00',
      cmcKey: 'k',
      itemCd: 'KE2NTU0000001',
      itemNm: 'Product a - Large',
      bcd: '616110001',
      taxTyCd: 'B',
      dftPrc: 116,
      useYn: 'Y',
      regrNm: 'Wanjiru Kamau',
    });
    expect(s.db.a.etimsItem).toMatchObject({
      status: 'REGISTERED',
      itemCd: 'KE2NTU0000001',
      lastError: null,
    });
    expect(s.db.a.etimsItem.sentHash).toHaveLength(32);
  });
  it('numbers the items one after another', async () => {
    const s = setup([
      variant('a', { etimsItem: mapping() }),
      variant('b', { etimsItem: mapping({ qtyUnitCd: 'KG' }) }),
    ]);
    await inTenant(() => s.service.register({ variantIds: ['a', 'b'] }));
    expect(s.sent.map((b) => b.itemCd)).toEqual([
      'KE2NTU0000001',
      'KE2NTKG0000002',
    ]);
  });
  it('an item that already has a code keeps it when it is sent again', async () => {
    const s = setup([
      variant('a', { etimsItem: mapping({ itemCd: 'KE2NTU0000099' }) }),
    ]);
    await inTenant(() => s.service.register({ variantIds: ['a'] }));
    expect(s.sent[0].itemCd).toBe('KE2NTU0000099');
    expect(s.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('skips an item KRA already has, unchanged', async () => {
    const s = setup([variant('a', { etimsItem: mapping() })]);
    await inTenant(() => s.service.register({ variantIds: ['a'] }));
    const again = await inTenant(() =>
      s.service.register({ variantIds: ['a'] }),
    );
    expect(again).toMatchObject({ sent: 0, skipped: 1 });
    expect(s.client.call).toHaveBeenCalledTimes(1);
  });
  it('an item that is not set up is not sent, and says what is missing', async () => {
    const s = setup([variant('a')]);
    const r = await inTenant(() => s.service.register({ variantIds: ['a'] }));
    expect(r.failed).toEqual([
      {
        variantId: 'a',
        name: 'Product a',
        message: "Choose KRA's product classification",
      },
    ]);
    expect(s.client.call).not.toHaveBeenCalled();
  });
  it("a rejection keeps KRA's reason, and the others still go", async () => {
    const reject = () => ({
      resultCd: '991',
      resultMsg: 'There is an error during registration',
      resultDt: '',
      data: null,
    });
    const s = setup(
      [
        variant('a', { etimsItem: mapping() }),
        variant('b', { etimsItem: mapping() }),
      ],
      [reject],
    );
    const r = await inTenant(() =>
      s.service.register({ variantIds: ['a', 'b'] }),
    );
    expect(r.sent).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(s.db.a.etimsItem).toMatchObject({ status: 'REJECTED' });
    expect(s.db.a.etimsItem.lastError).toMatch(/991/);
    expect(s.db.b.etimsItem.status).toBe('REGISTERED');
  });
  it('trouble reaching KRA stops the round and leaves the rest unsent, keeping their codes for next time', async () => {
    const down = () => ({
      resultCd: '894',
      resultMsg: 'Could not reach the KRA server',
      resultDt: '',
      data: null,
    });
    const s = setup(
      [
        variant('a', { etimsItem: mapping() }),
        variant('b', { etimsItem: mapping() }),
      ],
      [down],
    );
    const r = await inTenant(() =>
      s.service.register({ variantIds: ['a', 'b'] }),
    );
    expect(r.stopped).toMatch(/Could not reach KRA/);
    expect(r.sent).toBe(0);
    expect(s.client.call).toHaveBeenCalledTimes(1);
    expect(s.db.a.etimsItem).toMatchObject({
      status: 'NOT_SENT',
      itemCd: 'KE2NTU0000001',
    });
    expect(s.db.b.etimsItem.itemCd).toBeNull();
  });
  it('a device KRA no longer accepts also stops the round', async () => {
    const bad = () => ({
      resultCd: '901',
      resultMsg: 'It is not valid device',
      resultDt: '',
      data: null,
    });
    const s = setup([variant('a', { etimsItem: mapping() })], [bad]);
    expect(
      (await inTenant(() => s.service.register({ variantIds: ['a'] }))).stopped,
    ).toMatch(/does not recognise this device/);
  });
  it('"already there" (994) counts as registered', async () => {
    const dup = () => ({
      resultCd: '994',
      resultMsg: 'overlapped',
      resultDt: '',
      data: null,
    });
    const s = setup([variant('a', { etimsItem: mapping() })], [dup]);
    expect(
      (await inTenant(() => s.service.register({ variantIds: ['a'] }))).sent,
    ).toBe(1);
  });
  it('"all" sends what is ready or needs an update, not what needs setup or is registered', async () => {
    const s = setup([
      variant('a'),
      variant('b', { etimsItem: mapping() }),
      variant('c', { etimsItem: mapping({ itemCd: 'KE2NTU0000050' }) }),
    ]);
    await inTenant(() => s.service.register({ variantIds: ['c'] }));
    s.client.call.mockClear();
    const r = await inTenant(() => s.service.register({ all: true }));
    expect(r.sent).toBe(1);
    expect(s.client.call).toHaveBeenCalledTimes(1);
  });
  it(`sends at most ${REGISTER_BATCH} in one request and says how many are left`, async () => {
    const many = Array.from({ length: REGISTER_BATCH + 7 }, (_, i) =>
      variant(`v${i}`, { etimsItem: mapping() }),
    );
    const s = setup(many);
    const r = await inTenant(() => s.service.register({ all: true }));
    expect(r.sent).toBe(REGISTER_BATCH);
    expect(r.remaining).toBe(7);
  });
  it('needs a connected device', async () => {
    const s = setup([variant('a', { etimsItem: mapping() })]);
    s.settings.credentials.mockResolvedValue(null);
    await expect(
      inTenant(() => s.service.register({ variantIds: ['a'] })),
    ).rejects.toThrow(/connect a branch/);
  });
  it('an archived product is sent as no longer used', async () => {
    const s = setup([
      variant('a', {
        etimsItem: mapping(),
        product: { name: 'Old', isActive: false, taxClass: null },
      }),
    ]);
    await inTenant(() => s.service.register({ variantIds: ['a'] }));
    expect(s.sent[0]).toMatchObject({ useYn: 'N', taxTyCd: 'D', dftPrc: 100 });
  });
});
