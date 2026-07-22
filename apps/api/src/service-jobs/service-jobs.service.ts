import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ServiceJobStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateServiceJobDto } from './dto/create-service-job.dto';
import { UpdateServiceJobStatusDto } from './dto/update-service-job-status.dto';

const JOB_INCLUDE = {
  customer: true,
  branch: { select: { name: true } },
  sale: { select: { saleId: true } },
} as const;

// Not a strict linear sequence - a job can move back to WAITING_PARTS from
// IN_PROGRESS, or be cancelled from any not-yet-finished state. COMPLETED
// and CANCELLED are terminal, same reasoning as SalonAppointmentStatus.
const ALLOWED_TRANSITIONS: Record<ServiceJobStatus, ServiceJobStatus[]> = {
  [ServiceJobStatus.OPEN]: [
    ServiceJobStatus.IN_PROGRESS,
    ServiceJobStatus.CANCELLED,
  ],
  [ServiceJobStatus.IN_PROGRESS]: [
    ServiceJobStatus.WAITING_PARTS,
    ServiceJobStatus.COMPLETED,
    ServiceJobStatus.CANCELLED,
  ],
  [ServiceJobStatus.WAITING_PARTS]: [
    ServiceJobStatus.IN_PROGRESS,
    ServiceJobStatus.CANCELLED,
  ],
  [ServiceJobStatus.COMPLETED]: [],
  [ServiceJobStatus.CANCELLED]: [],
};

@Injectable()
export class ServiceJobsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateServiceJobDto) {
    return this.tenantPrisma.run(async (tx) => {
      const [branch, customer] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        dto.customerId
          ? tx.customer.findUnique({ where: { id: dto.customerId } })
          : Promise.resolve(null),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (dto.customerId && !customer) {
        throw new NotFoundException('Customer not found');
      }

      const { organizationId, orgUserId } = getTenantStore();
      const job = await tx.serviceJob.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          customerId: dto.customerId,
          assetLabel: dto.assetLabel,
          description: dto.description,
          notes: dto.notes,
          createdById: orgUserId,
        },
        include: JOB_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'serviceJob.created',
        entityType: 'ServiceJob',
        entityId: job.id,
        after: { branchId: dto.branchId, description: dto.description },
      });

      return job;
    });
  }

  findAll(filters: { branchId?: string; status?: ServiceJobStatus }) {
    return this.tenantPrisma.run((tx) =>
      tx.serviceJob.findMany({
        where: { branchId: filters.branchId, status: filters.status },
        include: JOB_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  async findOne(id: string) {
    const job = await this.tenantPrisma.run((tx) =>
      tx.serviceJob.findUnique({ where: { id }, include: JOB_INCLUDE }),
    );
    if (!job) throw new NotFoundException('Service job not found');
    return job;
  }

  async updateStatus(id: string, dto: UpdateServiceJobStatusDto) {
    return this.tenantPrisma.run(async (tx) => {
      const job = await tx.serviceJob.findUnique({ where: { id } });
      if (!job) throw new NotFoundException('Service job not found');

      const allowed = ALLOWED_TRANSITIONS[job.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `Cannot move a service job from ${job.status} to ${dto.status}`,
        );
      }

      return tx.serviceJob.update({
        where: { id },
        data: {
          status: dto.status,
          closedAt:
            dto.status === ServiceJobStatus.COMPLETED ||
            dto.status === ServiceJobStatus.CANCELLED
              ? new Date()
              : job.closedAt,
        },
        include: JOB_INCLUDE,
      });
    });
  }
}
