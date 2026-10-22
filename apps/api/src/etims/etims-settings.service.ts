import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EtimsDevice, EtimsEnvironment, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import {
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
} from '../common/crypto/secret-box';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { ConnectDeviceDto, UpdateEtimsSettingsDto } from './dto/etims.dto';
import { EtimsClient } from './etims.client';
import {
  classifyResult,
  explainResult,
  isValidBhfId,
  isValidPin,
  isValidSerial,
  normalizePin,
} from './etims.util';

/** What KRA sends back when a device is connected (spec 3.3.1.1). */
interface InitData {
  info?: {
    tin?: string;
    taxprNm?: string;
    bhfId?: string;
    bhfNm?: string;
    dvcId?: string;
    sdicId?: string;
    sdcId?: string;
    mrcNo?: string;
    cmcKey?: string;
  };
}

/** A device ready to make calls: the business's PIN, the branch ID and the decrypted key. */
export interface DeviceCredentials {
  environment: EtimsEnvironment;
  tin: string;
  bhfId: string;
  cmcKey: string;
}

/**
 * A business's eTIMS setup: the on/off switch, its KRA PIN, and one device per branch. Connecting a device is the first call to
 * KRA: it checks the PIN, branch and serial, and hands back the key every later call carries. That key is stored encrypted and
 * never shown. Live KRA is refused for now - this build talks to the sandbox only, until the integration is certified.
 */
@Injectable()
export class EtimsSettingsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
    private readonly client: EtimsClient,
    private readonly config: ConfigService,
  ) {}

  private key(): Buffer {
    return parseEncryptionKey(
      this.config.get<string>('SECRETS_ENCRYPTION_KEY'),
    );
  }

  private deviceView(d: EtimsDevice) {
    return {
      bhfId: d.bhfId,
      dvcSrlNo: d.dvcSrlNo,
      status: d.status,
      bhfNm: d.bhfNm,
      dvcId: d.dvcId,
      sdcId: d.sdcId,
      mrcNo: d.mrcNo,
      connectedAt: d.connectedAt,
      lastError: d.lastError,
      // never the key itself
      hasKey: Boolean(d.cmcKeyEnc),
    };
  }

  /** The switch, the PIN, and every branch with its device (or none yet). */
  async overview() {
    return this.tenantPrisma.run(async (tx) => {
      const [setting, branches, devices] = await Promise.all([
        tx.etimsSetting.findFirst(),
        tx.branch.findMany({
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        }),
        tx.etimsDevice.findMany(),
      ]);
      const byBranch = new Map(devices.map((d) => [d.branchId, d]));
      return {
        enabled: setting?.enabled ?? false,
        environment: setting?.environment ?? 'SANDBOX',
        tin: setting?.tin ?? null,
        taxpayerName: setting?.taxpayerName ?? null,
        // live KRA needs the integration to be certified first
        productionAvailable: false,
        branches: branches.map((b) => ({
          branchId: b.id,
          branchName: b.name,
          device: byBranch.has(b.id)
            ? this.deviceView(byBranch.get(b.id)!)
            : null,
        })),
      };
    });
  }

  async update(dto: UpdateEtimsSettingsDto) {
    const { organizationId } = getTenantStore();
    if (dto.environment === 'PRODUCTION')
      throw new BadRequestException(
        'Live eTIMS is not available yet. It opens after KRA has certified this integration - for now only the test (sandbox) setup can be used.',
      );
    let tin: string | undefined;
    if (dto.tin !== undefined) {
      tin = normalizePin(dto.tin);
      if (!isValidPin(tin))
        throw new BadRequestException(
          'That is not a KRA PIN. It is a letter, nine digits and a letter, like A123456789Z.',
        );
    }
    await this.tenantPrisma.run(async (tx) => {
      const before = await tx.etimsSetting.findFirst();
      if (tin !== undefined && before?.tin && before.tin !== tin) {
        const connected = await tx.etimsDevice.count({
          where: { status: 'ACTIVE' },
        });
        if (connected > 0)
          throw new ConflictException(
            'A device is already connected under the old PIN. Disconnect the devices before changing the PIN.',
          );
      }
      if (dto.enabled === true && !(tin ?? before?.tin))
        throw new BadRequestException(
          "Enter the business's KRA PIN before turning eTIMS on.",
        );
      const data = {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(tin !== undefined ? { tin } : {}),
      };
      await tx.etimsSetting.upsert({
        where: { organizationId },
        create: { organizationId, ...data },
        update: data,
      });
      await this.auditLog.logInTx(tx, {
        action: 'etims.settings_updated',
        entityType: 'EtimsSetting',
        entityId: organizationId,
        before: { enabled: before?.enabled ?? false, tin: before?.tin ?? null },
        after: data,
      });
    });
    return this.overview();
  }

  /**
   * Connects a branch to KRA. The database is not held open while KRA answers: the branch's row is saved first (so a half-finished
   * attempt shows), then KRA is called, then the answer is saved.
   */
  async connect(branchId: string, dto: ConnectDeviceDto) {
    const { organizationId } = getTenantStore();
    if (!isValidBhfId(dto.bhfId))
      throw new BadRequestException('The branch ID is two digits, like 00.');
    if (!isValidSerial(dto.dvcSrlNo))
      throw new BadRequestException(
        'Enter the device serial number KRA approved, with no spaces at the ends.',
      );

    const { tin, environment, deviceId } = await this.tenantPrisma.run(
      async (tx) => {
        const setting = await tx.etimsSetting.findFirst();
        if (!setting?.tin)
          throw new BadRequestException("Enter the business's KRA PIN first.");
        if (!(await tx.branch.findUnique({ where: { id: branchId } })))
          throw new NotFoundException('Branch not found');
        const existing = await tx.etimsDevice.findUnique({
          where: { branchId },
        });
        if (existing?.status === 'ACTIVE' && existing.cmcKeyEnc)
          throw new ConflictException(
            'This branch is already connected. Connecting again would not work: KRA only lets a device be installed once. Disconnecting forgets the key KRA gave, and KRA would then have to reset the device before it could be connected again.',
          );
        const taken = await tx.etimsDevice.findFirst({
          where: { bhfId: dto.bhfId, branchId: { not: branchId } },
        });
        if (taken)
          throw new ConflictException(
            `Branch ID ${dto.bhfId} is already used by another branch of this business.`,
          );
        const device = await tx.etimsDevice.upsert({
          where: { branchId },
          create: {
            organizationId,
            branchId,
            bhfId: dto.bhfId,
            dvcSrlNo: dto.dvcSrlNo,
          },
          update: {
            bhfId: dto.bhfId,
            dvcSrlNo: dto.dvcSrlNo,
            status: 'NOT_CONNECTED',
            cmcKeyEnc: null,
            lastError: null,
          },
        });
        return {
          tin: setting.tin,
          environment: setting.environment,
          deviceId: device.id,
        };
      },
    );

    const res = await this.client.call<InitData>(
      environment,
      'selectInitOsdcInfo',
      { tin, bhfId: dto.bhfId, dvcSrlNo: dto.dvcSrlNo },
    );
    const kind = classifyResult(res.resultCd);
    const info = res.data?.info;
    let problem: string | null = null;
    if (kind !== 'OK') problem = explainResult(res.resultCd, res.resultMsg);
    else if (!info?.cmcKey)
      problem =
        'KRA accepted the device but did not send the communication key. Try again, and tell support if it happens twice.';
    else if (info.tin && normalizePin(info.tin) !== tin)
      problem = `KRA connected this device to a different PIN (${info.tin}) from the one entered here (${tin}).`;

    await this.tenantPrisma.run(async (tx) => {
      if (problem) {
        await tx.etimsDevice.update({
          where: { id: deviceId },
          data: { status: 'FAILED', lastError: problem.slice(0, 500) },
        });
      } else {
        await tx.etimsDevice.update({
          where: { id: deviceId },
          data: {
            status: 'ACTIVE',
            cmcKeyEnc: encryptSecret(info!.cmcKey!, this.key()),
            dvcId: info!.dvcId ?? null,
            sdcId: info!.sdcId ?? info!.sdicId ?? null,
            mrcNo: info!.mrcNo ?? null,
            bhfNm: info!.bhfNm ?? null,
            connectedAt: new Date(),
            lastError: null,
          },
        });
        if (info!.taxprNm)
          await tx.etimsSetting.update({
            where: { organizationId },
            data: { taxpayerName: info!.taxprNm.slice(0, 120) },
          });
      }
      await this.auditLog.logInTx(tx, {
        action: problem
          ? 'etims.device_connect_failed'
          : 'etims.device_connected',
        entityType: 'EtimsDevice',
        entityId: deviceId,
        after: {
          branchId,
          bhfId: dto.bhfId,
          dvcSrlNo: dto.dvcSrlNo,
          resultCd: res.resultCd,
          problem,
        },
      });
    });
    if (problem) throw new BadRequestException(problem);
    return this.overview();
  }

  /** Forgets the key and the connection for a branch (so it can be connected again). KRA is not told. */
  async disconnect(branchId: string) {
    await this.tenantPrisma.run(async (tx) => {
      const d = await tx.etimsDevice.findUnique({ where: { branchId } });
      if (!d) throw new NotFoundException('That branch has no device');
      await tx.etimsDevice.update({
        where: { branchId },
        data: {
          status: 'NOT_CONNECTED',
          cmcKeyEnc: null,
          connectedAt: null,
          lastError: null,
        },
      });
      await this.auditLog.logInTx(tx, {
        action: 'etims.device_disconnected',
        entityType: 'EtimsDevice',
        entityId: d.id,
        after: { branchId, bhfId: d.bhfId },
      });
    });
    return this.overview();
  }

  /**
   * A connected device, with its key, for making calls: the head office's if it has one, else the first. Null when eTIMS is off,
   * there is no PIN, or no device is connected. Only for use by this module.
   */
  async credentials(
    tx: TenantTx,
    branchId?: string,
  ): Promise<DeviceCredentials | null> {
    const setting = await tx.etimsSetting.findFirst();
    if (!setting?.enabled || !setting.tin) return null;
    const devices = await tx.etimsDevice.findMany({
      where: { status: 'ACTIVE', ...(branchId ? { branchId } : {}) },
      orderBy: { bhfId: 'asc' },
    });
    const d = devices.find((x) => x.cmcKeyEnc);
    if (!d) return null;
    return {
      environment: setting.environment,
      tin: setting.tin,
      bhfId: d.bhfId,
      cmcKey: decryptSecret(d.cmcKeyEnc!, this.key()),
    };
  }

  /** For tests and the code-list sync: is this a real unique-constraint clash? */
  static isUniqueClash(e: unknown): boolean {
    return (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
    );
  }
}
