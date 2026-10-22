/* eslint-disable @typescript-eslint/no-explicit-any */
import { Role } from '@prisma/client';
import {
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
} from '../common/crypto/secret-box';
import { tenantContext } from '../common/tenant/tenant-context';
import { EtimsSettingsService } from './etims-settings.service';

const KEY = Buffer.alloc(32, 7).toString('base64');
const inTenant = <T>(fn: () => Promise<T>) =>
  tenantContext.run(
    { organizationId: 'org-1', orgUserId: 'u1', role: Role.OWNER },
    fn,
  );

function setup(
  opts: {
    setting?: Record<string, unknown> | null;
    answer?: Record<string, unknown>;
    taken?: boolean;
  } = {},
) {
  const device = {
    id: 'd1',
    branchId: 'b1',
    bhfId: '00',
    dvcSrlNo: 'S1',
    status: 'NOT_CONNECTED',
    cmcKeyEnc: null,
  };
  const saved: Record<string, any> = {};
  const tx = {
    etimsSetting: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.setting === undefined
            ? { enabled: true, environment: 'SANDBOX', tin: 'A123456789Z' }
            : opts.setting,
        ),
      upsert: jest
        .fn()
        .mockImplementation(async (a: any) => ((saved.setting = a), {})),
      update: jest
        .fn()
        .mockImplementation(
          async (a: any) => ((saved.settingUpdate = a.data), {}),
        ),
    },
    branch: {
      findUnique: jest.fn().mockResolvedValue({ id: 'b1' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'Main' }]),
    },
    etimsDevice: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.taken ? { id: 'other' } : null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(device),
      count: jest.fn().mockResolvedValue(0),
      upsert: jest.fn().mockResolvedValue(device),
      update: jest
        .fn()
        .mockImplementation(async (a: any) => ((saved.device = a.data), {})),
    },
  };
  const tenantPrisma = {
    run: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const audit = { logInTx: jest.fn().mockResolvedValue(undefined) };
  const client = {
    call: jest.fn().mockResolvedValue(
      opts.answer ?? {
        resultCd: '000',
        resultMsg: 'ok',
        resultDt: '20261105120000',
        data: {
          info: {
            tin: 'A123456789Z',
            taxprNm: 'Mama Mboga Ltd',
            bhfId: '00',
            bhfNm: 'Headquarter',
            dvcId: 'D1',
            sdcId: 'S1',
            mrcNo: 'M1',
            cmcKey: 'the-secret-key',
          },
        },
      },
    ),
  };
  const config = {
    get: (k: string) => (k === 'SECRETS_ENCRYPTION_KEY' ? KEY : undefined),
  };
  const service = new EtimsSettingsService(
    tenantPrisma as never,
    audit as never,
    client as never,
    config as never,
  );
  return { service, tx, client, saved, audit };
}

const refusal = (code: string, msg: string) => ({
  resultCd: code,
  resultMsg: msg,
  resultDt: '',
  data: null,
});

describe('updating the eTIMS settings', () => {
  it('turns it on once there is a PIN, and tidies the PIN', async () => {
    const { service, saved } = setup({ setting: null });
    await inTenant(() =>
      service.update({ tin: ' a123456789z ', enabled: true }),
    );
    expect(saved.setting.update).toEqual({ enabled: true, tin: 'A123456789Z' });
  });
  it('refuses to turn it on with no PIN', async () => {
    const { service } = setup({ setting: { enabled: false, tin: null } });
    await expect(
      inTenant(() => service.update({ enabled: true })),
    ).rejects.toThrow(/PIN/);
  });
  it('refuses a PIN that is not a PIN', async () => {
    const { service } = setup();
    await expect(
      inTenant(() => service.update({ tin: '12345' })),
    ).rejects.toThrow(/not a KRA PIN/);
  });
  it('refuses live KRA for now', async () => {
    const { service } = setup();
    await expect(
      inTenant(() => service.update({ environment: 'PRODUCTION' })),
    ).rejects.toThrow(/not available yet/);
  });
  it('will not change the PIN while a device is connected under the old one', async () => {
    const { service, tx } = setup();
    tx.etimsDevice.count.mockResolvedValue(1);
    await expect(
      inTenant(() => service.update({ tin: 'P051234567K' })),
    ).rejects.toThrow(/Disconnect/);
  });
});

describe('connecting a branch to KRA', () => {
  it('sends the PIN, branch ID and serial; stores the key ENCRYPTED; and records who KRA says the business is', async () => {
    const { service, client, saved } = setup();
    await inTenant(() =>
      service.connect('b1', { bhfId: '00', dvcSrlNo: 'S1' }),
    );
    expect(client.call).toHaveBeenCalledWith('SANDBOX', 'selectInitOsdcInfo', {
      tin: 'A123456789Z',
      bhfId: '00',
      dvcSrlNo: 'S1',
    });
    expect(saved.device.status).toBe('ACTIVE');
    expect(saved.device.cmcKeyEnc).not.toContain('the-secret-key');
    expect(decryptSecret(saved.device.cmcKeyEnc, parseEncryptionKey(KEY))).toBe(
      'the-secret-key',
    );
    expect(saved.settingUpdate.taxpayerName).toBe('Mama Mboga Ltd');
  });
  it('a device KRA does not know is recorded as failed with a plain explanation, and no key is kept', async () => {
    const { service, saved } = setup({
      answer: refusal('901', 'It is not valid device'),
    });
    await expect(
      inTenant(() => service.connect('b1', { bhfId: '00', dvcSrlNo: 'S1' })),
    ).rejects.toThrow(/does not recognise this device/);
    expect(saved.device.status).toBe('FAILED');
    expect(saved.device.cmcKeyEnc).toBeUndefined();
  });
  it('a device already installed says so', async () => {
    const { service } = setup({
      answer: refusal('902', 'This device is installed'),
    });
    await expect(
      inTenant(() => service.connect('b1', { bhfId: '00', dvcSrlNo: 'S1' })),
    ).rejects.toThrow(/already installed/);
  });
  it('KRA being unreachable says so', async () => {
    const { service } = setup({
      answer: refusal('894', 'Could not reach the KRA server'),
    });
    await expect(
      inTenant(() => service.connect('b1', { bhfId: '00', dvcSrlNo: 'S1' })),
    ).rejects.toThrow(/Could not reach KRA/);
  });
  it('a device KRA ties to a different PIN is refused', async () => {
    const { service, saved } = setup({
      answer: {
        resultCd: '000',
        resultMsg: 'ok',
        resultDt: '',
        data: { info: { tin: 'P999999999Z', cmcKey: 'k' } },
      },
    });
    await expect(
      inTenant(() => service.connect('b1', { bhfId: '00', dvcSrlNo: 'S1' })),
    ).rejects.toThrow(/different PIN/);
    expect(saved.device.status).toBe('FAILED');
  });
  it('success without a key is not treated as success', async () => {
    const { service } = setup({
      answer: {
        resultCd: '000',
        resultMsg: 'ok',
        resultDt: '',
        data: { info: { tin: 'A123456789Z' } },
      },
    });
    await expect(
      inTenant(() => service.connect('b1', { bhfId: '00', dvcSrlNo: 'S1' })),
    ).rejects.toThrow(/communication key/);
  });
  it('needs the PIN first, and a branch ID not used by another branch', async () => {
    await expect(
      inTenant(() =>
        setup({ setting: { tin: null } }).service.connect('b1', {
          bhfId: '00',
          dvcSrlNo: 'S1',
        }),
      ),
    ).rejects.toThrow(/PIN first/);
    await expect(
      inTenant(() =>
        setup({ taken: true }).service.connect('b1', {
          bhfId: '00',
          dvcSrlNo: 'S1',
        }),
      ),
    ).rejects.toThrow(/already used/);
  });
  it('a branch that is already connected is not connected again, so its key is never thrown away by a second attempt', async () => {
    const { service, tx, client } = setup();
    tx.etimsDevice.findUnique.mockResolvedValue({
      id: 'd1',
      branchId: 'b1',
      status: 'ACTIVE',
      cmcKeyEnc: 'v1:x',
    });
    await expect(
      inTenant(() => service.connect('b1', { bhfId: '00', dvcSrlNo: 'S1' })),
    ).rejects.toThrow(/already connected/);
    expect(client.call).not.toHaveBeenCalled();
    expect(tx.etimsDevice.upsert).not.toHaveBeenCalled();
  });
  it('refuses a bad branch ID or serial before calling KRA', async () => {
    const { service, client } = setup();
    await expect(
      inTenant(() => service.connect('b1', { bhfId: '0', dvcSrlNo: 'S1' })),
    ).rejects.toThrow(/two digits/);
    await expect(
      inTenant(() => service.connect('b1', { bhfId: '00', dvcSrlNo: ' S1' })),
    ).rejects.toThrow(/serial/);
    expect(client.call).not.toHaveBeenCalled();
  });
});

describe('credentials for making calls', () => {
  it('are null when eTIMS is off, or no device is connected', async () => {
    const off = setup({ setting: { enabled: false, tin: 'A123456789Z' } });
    expect(await off.service.credentials(off.tx as never)).toBeNull();
    const none = setup();
    expect(await none.service.credentials(none.tx as never)).toBeNull();
  });
  it('give the decrypted key of the connected device', async () => {
    const s = setup();
    s.tx.etimsDevice.findMany.mockResolvedValue([
      {
        bhfId: '00',
        cmcKeyEnc: encryptSecret('k-123', parseEncryptionKey(KEY)),
      },
    ]);
    expect(await s.service.credentials(s.tx as never)).toEqual({
      environment: 'SANDBOX',
      tin: 'A123456789Z',
      bhfId: '00',
      cmcKey: 'k-123',
    });
  });
});

describe('the overview', () => {
  it('never contains a key, and says live KRA is not available', async () => {
    const s = setup();
    s.tx.etimsDevice.findMany.mockResolvedValue([
      {
        branchId: 'b1',
        bhfId: '00',
        dvcSrlNo: 'S1',
        status: 'ACTIVE',
        cmcKeyEnc: 'v1:secret',
        bhfNm: 'HQ',
        dvcId: null,
        sdcId: null,
        mrcNo: null,
        connectedAt: null,
        lastError: null,
      },
    ]);
    const o = await inTenant(() => s.service.overview());
    expect(JSON.stringify(o)).not.toContain('v1:secret');
    expect(o.branches[0].device).toMatchObject({
      hasKey: true,
      status: 'ACTIVE',
    });
    expect(o.productionAvailable).toBe(false);
  });
});
