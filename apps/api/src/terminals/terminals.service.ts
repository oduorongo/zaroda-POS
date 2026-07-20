import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { CreateTerminalDto, UpdateTerminalDto } from './dto/terminal.dto';

@Injectable()
export class TerminalsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  create(dto: CreateTerminalDto) {
    return this.tenantPrisma.run(async (tx) => {
      const branch = await tx.branch.findUnique({
        where: { id: dto.branchId },
      });
      if (!branch) throw new NotFoundException('Branch not found');

      return tx.terminal.create({
        data: { branchId: dto.branchId, deviceLabel: dto.deviceLabel },
      });
    });
  }

  findAll(filters: { branchId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.terminal.findMany({
        where: { branchId: filters.branchId },
        orderBy: { deviceLabel: 'asc' },
      }),
    );
  }

  async findOne(id: string) {
    const terminal = await this.tenantPrisma.run((tx) =>
      tx.terminal.findUnique({ where: { id } }),
    );
    if (!terminal) throw new NotFoundException('Terminal not found');
    return terminal;
  }

  async update(id: string, dto: UpdateTerminalDto) {
    await this.findOne(id);
    return this.tenantPrisma.run((tx) =>
      tx.terminal.update({ where: { id }, data: dto }),
    );
  }
}
