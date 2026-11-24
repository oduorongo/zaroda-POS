import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EtimsEnvironment } from '@prisma/client';
import { encryptSecret, parseEncryptionKey } from '../common/crypto/secret-box';
import { PrismaService } from '../common/prisma/prisma.service';
import { EtimsClient } from './etims.client';

const ENVIRONMENTS: EtimsEnvironment[] = ['SANDBOX', 'PRODUCTION'];
const TX = { timeout: 15_000, maxWait: 15_000 };

export const maskKey = (k: string) => (k.length <= 8 ? '****' : `${k.slice(0, 4)}...${k.slice(-4)}`);

/**
 * ZARODA's side of eTIMS, for the platform admin: the GavaConnect keys per environment (saved encrypted, tested against KRA), every
 * business that has eTIMS set up with its devices and how its documents are doing, and the per-business approval for live KRA.
 */
@Injectable()
export class EtimsPlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: EtimsClient,
    private readonly config: ConfigService,
  ) {}

  async gateways() {
    const rows = await this.prisma.etimsGateway.findMany();
    return Promise.all(
      ENVIRONMENTS.map(async (environment) => {
        const row = rows.find((r) => r.environment === environment);
        const keys = await this.client.keySource(environment);
        return {
          environment,
          source: keys?.from ?? 'NONE',
          consumerKey: keys ? maskKey(keys.key) : null,
          apiUrl: this.client.baseUrl(environment),
          tokenUrl: this.client.tokenUrl(environment),
          lastTestAt: row?.lastTestAt ?? null,
          lastTestOk: row?.lastTestOk ?? null,
          lastTestMessage: row?.lastTestMessage ?? null,
          updatedAt: row?.consumerKey ? row.updatedAt : null,
        };
      }),
    );
  }

  async saveGateway(environment: EtimsEnvironment, consumerKey: string, consumerSecret: string, adminId: string) {
    const key = consumerKey.trim();
    const secret = consumerSecret.trim();
    if (!key || !secret) throw new BadRequestException('Enter both the consumer key and the consumer secret from developer.go.ke.');
    const data = {
      consumerKey: key,
      consumerSecretEnc: encryptSecret(secret, parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'))),
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
      updatedBy: adminId,
    };
    await this.prisma.etimsGateway.upsert({ where: { environment }, create: { environment, ...data }, update: data });
    this.client.forget(environment);
    return this.test(environment);
  }

  async clearGateway(environment: EtimsEnvironment, adminId: string) {
    await this.prisma.etimsGateway.upsert({
      where: { environment },
      create: { environment, updatedBy: adminId },
      update: { consumerKey: null, consumerSecretEnc: null, lastTestAt: null, lastTestOk: null, lastTestMessage: null, updatedBy: adminId },
    });
    this.client.forget(environment);
    return this.gateways();
  }

  async test(environment: EtimsEnvironment) {
    const result = (await this.client.keySource(environment))
      ? await this.client.testGateway(environment)
      : { ok: false, message: "No GavaConnect keys are set, so calls go straight to KRA's eTIMS address without a gateway token." };
    const at = new Date();
    await this.prisma.etimsGateway.upsert({
      where: { environment },
      create: { environment, lastTestAt: at, lastTestOk: result.ok, lastTestMessage: result.message },
      update: { lastTestAt: at, lastTestOk: result.ok, lastTestMessage: result.message },
    });
    return { environment, ...result, testedAt: at };
  }

  /** Every business with eTIMS set up. Reads each business's devices and documents with its own tenant set, one at a time. */
  async businesses() {
    const settings = await this.prisma.etimsSetting.findMany({
      include: { organization: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const out = [];
    for (const s of settings) {
      const detail = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${s.organizationId}, true)`;
        const [devices, counts, last] = await Promise.all([
          tx.etimsDevice.findMany({ select: { bhfId: true, status: true, lastError: true, connectedAt: true, branch: { select: { name: true } } }, orderBy: { bhfId: 'asc' } }),
          tx.etimsDocument.groupBy({ by: ['status'], _count: { _all: true } }),
          tx.etimsDocument.findFirst({ orderBy: { updatedAt: 'desc' }, select: { kind: true, status: true, lastError: true, updatedAt: true } }),
        ]);
        return { devices, counts, last };
      }, TX);
      const count = (status: string) => detail.counts.find((c) => c.status === status)?._count._all ?? 0;
      out.push({
        organizationId: s.organizationId,
        name: s.organization.name,
        enabled: s.enabled,
        sendSales: s.sendSales,
        environment: s.environment,
        tin: s.tin,
        taxpayerName: s.taxpayerName,
        liveApprovedAt: s.liveApprovedAt,
        devices: detail.devices.map((d) => ({ branch: d.branch.name, bhfId: d.bhfId, status: d.status, lastError: d.lastError, connectedAt: d.connectedAt })),
        documents: { sent: count('SENT'), pending: count('PENDING'), rejected: count('REJECTED'), manual: count('MANUAL') },
        lastDocument: detail.last,
      });
    }
    return out;
  }

  async setLive(organizationId: string, approve: boolean, adminId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      const s = await tx.etimsSetting.findFirst();
      if (!s) throw new NotFoundException('That business has not set up eTIMS yet.');
      if (!approve && s.environment === 'PRODUCTION')
        throw new ConflictException('This business is on live eTIMS now. It has to switch back to test before live can be withdrawn.');
      await tx.etimsSetting.update({
        where: { organizationId },
        data: approve ? { liveApprovedAt: s.liveApprovedAt ?? new Date(), liveApprovedBy: adminId } : { liveApprovedAt: null, liveApprovedBy: null },
      });
    }, TX);
    return this.businesses();
  }
}
