import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnlineStore, Prisma } from '@prisma/client';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { encryptSecret, parseEncryptionKey } from '../common/crypto/secret-box';
import { DEFAULT_COMMISSION_RATE, normalizeSlug } from './online-store.constants';
import { ConnectTumaDto, UpdateOnlineStoreDto } from './dto/update-online-store.dto';
import { TumaClient } from './tuma.client';

/** What a tenant sees - never the encrypted API key itself, just whether one is connected. */
export function toTenantView(store: OnlineStore | null) {
  return {
    addonActive: store?.addonActive ?? false,
    commissionRate: store?.commissionRate != null ? Number(store.commissionRate) : DEFAULT_COMMISSION_RATE,
    isPublished: store?.isPublished ?? false,
    slug: store?.slug ?? null,
    displayName: store?.displayName ?? null,
    description: store?.description ?? null,
    contactPhone: store?.contactPhone ?? null,
    fulfilmentBranchId: store?.fulfilmentBranchId ?? null,
    pickupEnabled: store?.pickupEnabled ?? true,
    deliveryEnabled: store?.deliveryEnabled ?? false,
    tumaEmail: store?.tumaEmail ?? null,
    tumaConnected: Boolean(store?.tumaApiKeyEncrypted),
  };
}

/** Every reason the shop can't go live yet, in the order a business would fix them. Empty = ready. */
export function publishBlockers(store: Pick<
  OnlineStore,
  'slug' | 'displayName' | 'fulfilmentBranchId' | 'pickupEnabled' | 'deliveryEnabled' | 'tumaApiKeyEncrypted'
>): string[] {
  const blockers: string[] = [];
  if (!store.slug) blockers.push('Choose a shop link');
  if (!store.displayName) blockers.push('Enter a shop name');
  if (!store.fulfilmentBranchId) blockers.push('Choose which branch fulfils online orders');
  if (!store.pickupEnabled && !store.deliveryEnabled) blockers.push('Turn on pickup or delivery');
  if (!store.tumaApiKeyEncrypted) blockers.push('Connect your TUMA account so buyers can pay you');
  return blockers;
}

@Injectable()
export class OnlineStoreService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tuma: TumaClient,
    private readonly config: ConfigService,
  ) {}

  async getMine() {
    const { organizationId } = getTenantStore();
    const store = await this.tenantPrisma.run((tx) =>
      tx.onlineStore.findUnique({ where: { organizationId } }),
    );
    return { ...toTenantView(store), publishBlockers: store ? publishBlockers(store) : [] };
  }

  /** The row only exists once a platform admin has enabled the add-on - a tenant can't create it. */
  private async requireActiveStore(tx: TenantTx, organizationId: string) {
    const store = await tx.onlineStore.findUnique({ where: { organizationId } });
    if (!store?.addonActive) {
      throw new ForbiddenException(
        'The Online Shop add-on is not active for this business - contact Zaroda to enable it',
      );
    }
    return store;
  }

  async updateMine(dto: UpdateOnlineStoreDto) {
    const { organizationId } = getTenantStore();

    let slug: string | undefined;
    if (dto.slug !== undefined) {
      const normalized = normalizeSlug(dto.slug);
      if (!normalized) {
        throw new BadRequestException(
          'Shop link must be 3-40 characters: lowercase letters, numbers and single hyphens (e.g. mama-mboga)',
        );
      }
      slug = normalized;
    }

    try {
      const store = await this.tenantPrisma.run(async (tx) => {
        const current = await this.requireActiveStore(tx, organizationId);

        if (dto.fulfilmentBranchId) {
          // RLS-scoped lookup - another tenant's branch id simply isn't found.
          const branch = await tx.branch.findUnique({ where: { id: dto.fulfilmentBranchId } });
          if (!branch) throw new BadRequestException('Branch not found');
        }

        const data = {
          slug,
          displayName: cleanText(dto.displayName),
          description: cleanText(dto.description),
          contactPhone: cleanText(dto.contactPhone),
          fulfilmentBranchId: dto.fulfilmentBranchId,
          pickupEnabled: dto.pickupEnabled,
          deliveryEnabled: dto.deliveryEnabled,
          isPublished: dto.isPublished,
        };

        // Checked against the merged result, so a request that both fills in
        // the last missing field and publishes succeeds in one save.
        const wantsPublished = dto.isPublished ?? current.isPublished;
        if (wantsPublished) {
          const merged = { ...current, ...stripUndefined(data) };
          const blockers = publishBlockers(merged);
          if (blockers.length > 0) {
            throw new BadRequestException(`Can't publish yet: ${blockers.join('; ')}`);
          }
        }

        return tx.onlineStore.update({ where: { organizationId }, data });
      });
      return { ...toTenantView(store), publishBlockers: publishBlockers(store) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('That shop link is already taken - try another');
      }
      throw e;
    }
  }

  async connectTuma(dto: ConnectTumaDto) {
    const { organizationId } = getTenantStore();
    const key = parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
    const email = dto.email.trim().toLowerCase();
    const apiKey = dto.apiKey.trim();

    // Fail fast before calling TUMA if the add-on isn't on.
    await this.tenantPrisma.run((tx) => this.requireActiveStore(tx, organizationId));
    // Outside the transaction - an external HTTP call shouldn't hold a DB
    // connection open for up to its 15s timeout.
    await this.tuma.verifyCredentials(email, apiKey);

    const store = await this.tenantPrisma.run(async (tx) => {
      await this.requireActiveStore(tx, organizationId);
      return tx.onlineStore.update({
        where: { organizationId },
        data: { tumaEmail: email, tumaApiKeyEncrypted: encryptSecret(apiKey, key) },
      });
    });
    return { ...toTenantView(store), publishBlockers: publishBlockers(store) };
  }

  /** Disconnecting also unpublishes - a live shop with no way to take payment would just fail every checkout. */
  async disconnectTuma() {
    const { organizationId } = getTenantStore();
    const store = await this.tenantPrisma.run(async (tx) => {
      await this.requireActiveStore(tx, organizationId);
      return tx.onlineStore.update({
        where: { organizationId },
        data: { tumaEmail: null, tumaApiKeyEncrypted: null, isPublished: false },
      });
    });
    return { ...toTenantView(store), publishBlockers: publishBlockers(store) };
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** undefined = leave unchanged; a blank string clears the field. */
function cleanText(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value.trim() || null;
}
