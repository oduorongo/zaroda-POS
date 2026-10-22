import { BadRequestException, Injectable } from '@nestjs/common';
import { EtimsEnvironment, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { EtimsClient } from './etims.client';
import { EtimsSettingsService } from './etims-settings.service';
import { classifyResult, explainResult, INITIAL_LAST_REQ } from './etims.util';

interface CodeClass {
  cdCls: string;
  cdClsNm: string;
  useYn?: string | null;
  dtlList?: {
    cd: string;
    cdNm: string;
    cdDesc?: string | null;
    useYn?: string | null;
    srtOrd?: number | null;
    userDfnCd1?: string | null;
  }[];
}
interface ItemClass {
  itemClsCd: string;
  itemClsNm: string;
  itemClsLvl?: number | null;
  taxTyCd?: string | null;
  useYn?: string | null;
}

const CHUNK = 1000;
/** The last row for each key (an insert that names the same row twice would fail). */
const dedupe = <T>(rows: T[], key: (r: T) => string): T[] => [
  ...new Map(rows.map((r) => [key(r), r])).values(),
];
const chunks = <T>(rows: T[]): T[][] =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) =>
    rows.slice(i * CHUNK, (i + 1) * CHUNK),
  );

/**
 * KRA's code lists (tax types, units, payment methods...) and its product classification list, copied down so the rest of the
 * integration can use KRA's own values. Each download asks only for what changed since the last one ("lastReqDt"), which KRA
 * wants the business's system to keep track of. They are the same for every business, so they have no tenant.
 */
@Injectable()
export class EtimsCodesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
    private readonly client: EtimsClient,
    private readonly settings: EtimsSettingsService,
  ) {}

  /** Downloads what KRA has changed in the code lists and the item classes. */
  async sync() {
    const creds = await this.tenantPrisma.run((tx) =>
      this.settings.credentials(tx),
    );
    if (!creds)
      throw new BadRequestException(
        'Turn eTIMS on, enter the KRA PIN and connect a branch first.',
      );
    const { environment } = creds;
    const last = await this.tenantPrisma.run(async (tx) => {
      const rows = await tx.etimsSyncState.findMany({ where: { environment } });
      return {
        codes:
          rows.find((r) => r.kind === 'codes')?.lastReqDt ?? INITIAL_LAST_REQ,
        items:
          rows.find((r) => r.kind === 'itemClasses')?.lastReqDt ??
          INITIAL_LAST_REQ,
      };
    });
    const base = { tin: creds.tin, bhfId: creds.bhfId, cmcKey: creds.cmcKey };

    const [codeRes, itemRes] = [
      await this.client.call<{ clsList?: CodeClass[] }>(
        environment,
        'selectCodeList',
        { ...base, lastReqDt: last.codes },
      ),
      await this.client.call<{ itemClsList?: ItemClass[] }>(
        environment,
        'selectItemClsList',
        { ...base, lastReqDt: last.items },
      ),
    ];
    for (const r of [codeRes, itemRes]) {
      const kind = classifyResult(r.resultCd);
      if (kind !== 'OK' && kind !== 'NO_DATA')
        throw new BadRequestException(explainResult(r.resultCd, r.resultMsg));
    }

    const codeRows = (codeRes.data?.clsList ?? []).flatMap((c) =>
      (c.dtlList ?? []).map((d) => ({
        cdCls: c.cdCls,
        cdClsNm: c.cdClsNm,
        cd: d.cd,
        cdNm: d.cdNm,
        cdDesc: d.cdDesc ?? null,
        sortOrder: d.srtOrd ?? 0,
        userDfnCd1: d.userDfnCd1 ?? null,
        useYn: d.useYn ?? 'Y',
      })),
    );
    const itemRows = (itemRes.data?.itemClsList ?? []).map((i) => ({
      itemClsCd: i.itemClsCd,
      itemClsNm: i.itemClsNm,
      itemClsLvl: i.itemClsLvl ?? null,
      taxTyCd: i.taxTyCd ?? null,
      useYn: i.useYn ?? 'Y',
    }));

    await this.tenantPrisma.run(async (tx) => {
      for (const part of chunks(
        dedupe(codeRows, (r) => `${r.cdCls}|${r.cd}`),
      )) {
        await tx.$executeRaw`
          INSERT INTO etims_codes ("environment", "cdCls", "cdClsNm", "cd", "cdNm", "cdDesc", "sortOrder", "userDfnCd1", "useYn", "updatedAt")
          SELECT ${environment}::"EtimsEnvironment", x."cdCls", x."cdClsNm", x."cd", x."cdNm", x."cdDesc", COALESCE(x."sortOrder", 0), x."userDfnCd1", COALESCE(x."useYn", 'Y'), now()
          FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb) AS x("cdCls" text, "cdClsNm" text, "cd" text, "cdNm" text, "cdDesc" text, "sortOrder" int, "userDfnCd1" text, "useYn" text)
          ON CONFLICT ("environment", "cdCls", "cd") DO UPDATE SET "cdClsNm" = EXCLUDED."cdClsNm", "cdNm" = EXCLUDED."cdNm", "cdDesc" = EXCLUDED."cdDesc", "sortOrder" = EXCLUDED."sortOrder", "userDfnCd1" = EXCLUDED."userDfnCd1", "useYn" = EXCLUDED."useYn", "updatedAt" = now()`;
      }
      for (const part of chunks(dedupe(itemRows, (r) => r.itemClsCd))) {
        await tx.$executeRaw`
          INSERT INTO etims_item_classes ("environment", "itemClsCd", "itemClsNm", "itemClsLvl", "taxTyCd", "useYn", "updatedAt")
          SELECT ${environment}::"EtimsEnvironment", x."itemClsCd", x."itemClsNm", x."itemClsLvl", x."taxTyCd", COALESCE(x."useYn", 'Y'), now()
          FROM jsonb_to_recordset(${JSON.stringify(part)}::jsonb) AS x("itemClsCd" text, "itemClsNm" text, "itemClsLvl" int, "taxTyCd" text, "useYn" text)
          ON CONFLICT ("environment", "itemClsCd") DO UPDATE SET "itemClsNm" = EXCLUDED."itemClsNm", "itemClsLvl" = EXCLUDED."itemClsLvl", "taxTyCd" = EXCLUDED."taxTyCd", "useYn" = EXCLUDED."useYn", "updatedAt" = now()`;
      }
      // remember where we got to - KRA's own clock, as it answered
      for (const [kind, res] of [
        ['codes', codeRes],
        ['itemClasses', itemRes],
      ] as const) {
        if (res.resultDt && /^\d{14}$/.test(res.resultDt))
          await tx.etimsSyncState.upsert({
            where: { environment_kind: { environment, kind } },
            create: { environment, kind, lastReqDt: res.resultDt },
            update: { lastReqDt: res.resultDt },
          });
      }
      await this.auditLog.logInTx(tx, {
        action: 'etims.codes_synced',
        entityType: 'EtimsCode',
        entityId: environment,
        after: { codes: codeRows.length, itemClasses: itemRows.length },
      });
    });
    return {
      codes: codeRows.length,
      itemClasses: itemRows.length,
      upToDate: codeRows.length === 0 && itemRows.length === 0,
    };
  }

  /** The downloaded code lists, grouped by class (or one class). */
  async lists(cdCls?: string) {
    const environment = await this.environment();
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.etimsCode.findMany({
        where: { environment, ...(cdCls ? { cdCls } : {}) },
        orderBy: [{ cdCls: 'asc' }, { sortOrder: 'asc' }],
      });
      const groups = new Map<
        string,
        {
          cdCls: string;
          cdClsNm: string;
          codes: {
            cd: string;
            cdNm: string;
            cdDesc: string | null;
            userDfnCd1: string | null;
            useYn: string;
          }[];
        }
      >();
      for (const r of rows) {
        const g = groups.get(r.cdCls) ?? {
          cdCls: r.cdCls,
          cdClsNm: r.cdClsNm,
          codes: [],
        };
        g.codes.push({
          cd: r.cd,
          cdNm: r.cdNm,
          cdDesc: r.cdDesc,
          userDfnCd1: r.userDfnCd1,
          useYn: r.useYn,
        });
        groups.set(r.cdCls, g);
      }
      return [...groups.values()];
    });
  }

  /** Search KRA's product classifications by name or code (the owner picks one for each product). */
  async searchItemClasses(search?: string, limit = 50) {
    const environment = await this.environment();
    const term = search?.trim();
    return this.tenantPrisma.run((tx) =>
      tx.etimsItemClass.findMany({
        where: {
          environment,
          useYn: 'Y',
          ...(term
            ? {
                OR: [
                  {
                    itemClsNm: {
                      contains: term,
                      mode: 'insensitive',
                    } as Prisma.StringFilter,
                  },
                  { itemClsCd: { startsWith: term } },
                ],
              }
            : {}),
        },
        orderBy: [{ itemClsLvl: 'desc' }, { itemClsNm: 'asc' }],
        take: Math.min(Math.max(limit, 1), 200),
      }),
    );
  }

  /** How many of each KRA has given us, for the setup screen. */
  async counts() {
    const environment = await this.environment();
    return this.tenantPrisma.run(async (tx) => {
      const [codes, classes, state] = await Promise.all([
        tx.etimsCode.count({ where: { environment } }),
        tx.etimsItemClass.count({ where: { environment } }),
        tx.etimsSyncState.findFirst({ where: { environment, kind: 'codes' } }),
      ]);
      return {
        codes,
        itemClasses: classes,
        lastSyncedAt: state?.updatedAt ?? null,
      };
    });
  }

  private async environment(): Promise<EtimsEnvironment> {
    return this.tenantPrisma.run(
      async (tx) =>
        (await tx.etimsSetting.findFirst())?.environment ?? 'SANDBOX',
    );
  }
}
