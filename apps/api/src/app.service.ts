import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './common/prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHealth(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Distinct from /health: liveness ("is the process up") vs readiness
   * ("can it actually serve a request right now"). A container
   * orchestrator (or a load balancer's own health check) should route
   * traffic away from an instance that's up but can't reach its database
   * - restarting a live-but-DB-less process would just repeat the same
   * failure, where routing around it until the database recovers is the
   * actual fix. No Redis check yet - this codebase has no Redis/BullMQ
   * dependency at all yet (see DESIGN.md's "planned" note on async jobs);
   * add one here the same way once that infrastructure actually exists,
   * rather than checking a dependency that isn't real yet.
   */
  async getReady(): Promise<{ status: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is not reachable');
    }
    return { status: 'ok' };
  }
}
