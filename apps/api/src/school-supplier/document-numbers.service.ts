import { Injectable } from '@nestjs/common';
import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { documentNumber, todayKey } from './school-money.util';

export type DocumentKind = 'SO' | 'DN' | 'INV' | 'RC' | 'CN' | 'QT';

/**
 * Numbers for printed documents: SO-2026-0007 (order), DN- (delivery note), INV- (invoice), RC- (receipt), CN- (credit note), QT- (quotation). One running
 * count per business, per kind and per year, taken inside the caller's transaction with a single INSERT ... ON CONFLICT
 * DO UPDATE, so two people issuing documents at the same moment can never get the same number, and a number is only
 * used if the document is actually saved (the counter rolls back with it).
 */
@Injectable()
export class DocumentNumbersService {
  async next(
    tx: TenantTx,
    organizationId: string,
    kind: DocumentKind,
    now: Date = new Date(),
  ): Promise<string> {
    const year = Number(todayKey(now).slice(0, 4));
    const rows = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO document_counters ("organizationId", "kind", "year", "last")
      VALUES (${organizationId}, ${kind}, ${year}, 1)
      ON CONFLICT ("organizationId", "kind", "year") DO UPDATE SET "last" = document_counters."last" + 1
      RETURNING "last"`;
    return documentNumber(kind, year, Number(rows[0].last));
  }
}
