import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenderAdvertStatus, TenderBuyerStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { ObjectStorageService } from '../common/storage/object-storage.service';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { todayKey } from '../school-supplier/school-money.util';
import { SaveTenderAdvertDto } from './dto/tender-advert.dto';
import {
  cleanItems,
  closingDateProblem,
  looksLikePdf,
  MAX_ADVERTS_PER_DAY,
  MAX_PDF_BYTES,
} from './tender-advert.util';
import { TenderBoardService } from './tender-board.service';
import { TenderBuyerAuthService } from './tender-buyer-auth.service';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** A school's own tender adverts: post one (once approved), change it, withdraw it. A school only ever reaches its own. */
@Injectable()
export class TenderAdvertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly board: TenderBoardService,
    private readonly auth: TenderBuyerAuthService,
    private readonly storage: ObjectStorageService,
  ) {}

  private async buyer(buyerId: string) {
    const b = await this.prisma.tenderBuyer.findUnique({ where: { id: buyerId } });
    if (!b) throw new NotFoundException('Account not found');
    return b;
  }

  async me(buyerId: string) {
    return this.auth.view(await this.buyer(buyerId));
  }

  private view(a: {
    id: string;
    reference: string | null;
    title: string;
    description: string;
    county: string;
    items: unknown;
    documentsInfo: string | null;
    pdfKey: string | null;
    pdfName: string | null;
    closingDate: Date;
    contactName: string;
    contactPhone: string;
    contactEmail: string | null;
    status: TenderAdvertStatus;
    removedReason: string | null;
    createdAt: Date;
  }) {
    const closing = day(a.closingDate);
    return {
      id: a.id,
      reference: a.reference,
      title: a.title,
      description: a.description,
      county: a.county,
      items: a.items,
      documentsInfo: a.documentsInfo,
      pdfUrl: a.pdfKey ? this.storage.publicUrl(a.pdfKey) : null,
      pdfName: a.pdfName,
      closingDate: closing,
      contactName: a.contactName,
      contactPhone: a.contactPhone,
      contactEmail: a.contactEmail,
      status: a.status,
      removedReason: a.removedReason,
      closed: closing < todayKey(),
      postedAt: a.createdAt,
    };
  }

  async list(buyerId: string) {
    const rows = await this.prisma.tenderAdvert.findMany({
      where: { buyerId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.view(r));
  }

  private data(dto: SaveTenderAdvertDto) {
    const today = todayKey();
    const problem = closingDateProblem(dto.closingDate, today);
    if (problem) throw new BadRequestException(problem);
    const phone = normalizeKenyanPhone(dto.contactPhone);
    if (!phone)
      throw new BadRequestException(
        'Enter a valid Kenyan mobile number for the contact, e.g. 0712 345 678',
      );
    return {
      reference: dto.reference?.trim() || null,
      title: dto.title.trim(),
      description: dto.description.trim(),
      county: dto.county.trim(),
      items: cleanItems(dto.items ?? []) as unknown as object,
      documentsInfo: dto.documentsInfo?.trim() || null,
      closingDate: new Date(`${dto.closingDate}T00:00:00Z`),
      contactName: dto.contactName.trim(),
      contactPhone: phone,
      contactEmail: dto.contactEmail?.trim().toLowerCase() || null,
    };
  }

  async create(buyerId: string, dto: SaveTenderAdvertDto) {
    const b = await this.buyer(buyerId);
    if (b.status !== TenderBuyerStatus.APPROVED)
      throw new ForbiddenException(
        b.status === TenderBuyerStatus.SUSPENDED
          ? 'This account has been suspended. Please contact Zaroda.'
          : 'Your school is still waiting to be approved. You can post adverts as soon as it is.',
      );
    const data = this.data(dto);
    const since = new Date(`${todayKey()}T00:00:00+03:00`); // start of the Nairobi day
    const today = await this.prisma.tenderAdvert.count({
      where: { buyerId, createdAt: { gte: since } },
    });
    if (today >= MAX_ADVERTS_PER_DAY)
      throw new ConflictException(
        `You can post up to ${MAX_ADVERTS_PER_DAY} adverts a day. Try again tomorrow.`,
      );
    const row = await this.prisma.tenderAdvert.create({
      data: { buyerId, ...data },
    });
    // tell the suppliers after the answer is on its way: it must never hold up or fail the school
    void this.board.alertSuppliers(row.id);
    return this.view(row);
  }

  private async own(buyerId: string, id: string) {
    const a = await this.prisma.tenderAdvert.findFirst({ where: { id, buyerId } });
    if (!a) throw new NotFoundException('Advert not found');
    return a;
  }

  async update(buyerId: string, id: string, dto: SaveTenderAdvertDto) {
    const a = await this.own(buyerId, id);
    if (a.status !== TenderAdvertStatus.OPEN)
      throw new ConflictException('Only an open advert can be changed.');
    const row = await this.prisma.tenderAdvert.update({
      where: { id },
      data: this.data(dto),
    });
    return this.view(row);
  }

  /** Attaches the school's own tender document (a PDF); a new one replaces the old. */
  async setPdf(buyerId: string, id: string, name: string, body: Buffer) {
    const a = await this.own(buyerId, id);
    if (a.status !== TenderAdvertStatus.OPEN)
      throw new ConflictException('Only an open advert can be changed.');
    if (body.length === 0) throw new BadRequestException('The file is empty');
    if (body.length > MAX_PDF_BYTES)
      throw new BadRequestException('The PDF must be 10MB or smaller');
    if (!looksLikePdf(body))
      throw new BadRequestException('That file is not a valid PDF');
    const key = `tender-adverts/${id}/${randomUUID()}.pdf`;
    await this.storage.upload(key, body, 'application/pdf');
    try {
      const row = await this.prisma.tenderAdvert.update({
        where: { id },
        data: { pdfKey: key, pdfName: name },
      });
      if (a.pdfKey) await this.storage.deleteMany([a.pdfKey]);
      return this.view(row);
    } catch (e) {
      await this.storage.deleteMany([key]);
      throw e;
    }
  }

  async removePdf(buyerId: string, id: string) {
    const a = await this.own(buyerId, id);
    if (a.status !== TenderAdvertStatus.OPEN)
      throw new ConflictException('Only an open advert can be changed.');
    const row = await this.prisma.tenderAdvert.update({
      where: { id },
      data: { pdfKey: null, pdfName: null },
    });
    if (a.pdfKey) await this.storage.deleteMany([a.pdfKey]);
    return this.view(row);
  }

  async cancel(buyerId: string, id: string) {
    const a = await this.own(buyerId, id);
    if (a.status !== TenderAdvertStatus.OPEN)
      throw new ConflictException('That advert is already closed.');
    const row = await this.prisma.tenderAdvert.update({
      where: { id },
      data: { status: TenderAdvertStatus.CANCELLED },
    });
    return this.view(row);
  }
}
