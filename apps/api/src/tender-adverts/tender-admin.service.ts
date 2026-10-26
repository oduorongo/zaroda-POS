import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenderAdvertStatus, TenderBuyerStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The platform owner's side of the tender board: check that a school that registered is real before it may post, suspend one
 * that misuses it, and take an advert down (or put it back). Tender adverts reach every supplier, so the gate is here.
 */
@Injectable()
export class TenderAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Schools waiting for approval first, then the rest; with how many adverts each has posted. */
  async listBuyers() {
    const rows = await this.prisma.tenderBuyer.findMany({
      include: { _count: { select: { adverts: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const order = { PENDING: 0, APPROVED: 1, SUSPENDED: 2 } as const;
    return rows
      .sort((a, b) => order[a.status] - order[b.status])
      .map((b) => ({
        id: b.id,
        name: b.name,
        contactName: b.contactName,
        phone: b.phone,
        email: b.email,
        county: b.county,
        status: b.status,
        statusNote: b.statusNote,
        adverts: b._count.adverts,
        viaSupplier: b.supplierSchoolId !== null,
        registeredAt: b.createdAt,
        lastLoginAt: b.lastLoginAt,
      }));
  }

  async setBuyerStatus(
    id: string,
    status: 'APPROVED' | 'SUSPENDED',
    note?: string,
  ) {
    const b = await this.prisma.tenderBuyer.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('School not found');
    await this.prisma.tenderBuyer.update({
      where: { id },
      data: {
        status:
          status === 'APPROVED'
            ? TenderBuyerStatus.APPROVED
            : TenderBuyerStatus.SUSPENDED,
        statusNote: note?.trim() || null,
      },
    });
    // a suspended school's open adverts disappear from the board with it
    if (status === 'SUSPENDED')
      await this.prisma.tenderAdvert.updateMany({
        where: { buyerId: id, status: TenderAdvertStatus.OPEN },
        data: { status: TenderAdvertStatus.REMOVED, removedReason: 'School suspended' },
      });
    return { id, status };
  }

  async listAdverts() {
    const rows = await this.prisma.tenderAdvert.findMany({
      include: { buyer: { select: { name: true, phone: true, county: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map((a) => ({
      id: a.id,
      title: a.title,
      school: a.buyer.name,
      schoolPhone: a.buyer.phone,
      county: a.county,
      closingDate: day(a.closingDate),
      status: a.status,
      removedReason: a.removedReason,
      postedAt: a.createdAt,
    }));
  }

  async removeAdvert(id: string, reason: string) {
    const a = await this.prisma.tenderAdvert.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Advert not found');
    if (a.status === TenderAdvertStatus.REMOVED)
      throw new ConflictException('Already taken down.');
    await this.prisma.tenderAdvert.update({
      where: { id },
      data: { status: TenderAdvertStatus.REMOVED, removedReason: reason.trim() },
    });
    return { id, status: TenderAdvertStatus.REMOVED };
  }

  async restoreAdvert(id: string) {
    const a = await this.prisma.tenderAdvert.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Advert not found');
    if (a.status !== TenderAdvertStatus.REMOVED)
      throw new ConflictException('Only a removed advert can be put back.');
    await this.prisma.tenderAdvert.update({
      where: { id },
      data: { status: TenderAdvertStatus.OPEN, removedReason: null },
    });
    return { id, status: TenderAdvertStatus.OPEN };
  }
}
