import { Module, OnModuleInit } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { ServiceJobsController } from './service-jobs.controller';
import { ServiceJobsService } from './service-jobs.service';
import { ServiceJobsSalesService } from './service-jobs-sales.service';

/**
 * The service-industry vertical: job/work-order businesses that bill
 * labor and parts against a customer's asset (garage, transport...). This
 * module imports SalesModule directly (ServiceJobsSalesService calls
 * SalesService.create() to invoice a job) - the same "module calls into
 * core" contract already proven by restaurant/pharmacy/salon (DESIGN.md
 * §3). Core imports nothing from here.
 */
@Module({
  imports: [SalesModule, ModuleRegistryModule],
  controllers: [ServiceJobsController],
  providers: [ServiceJobsService, ServiceJobsSalesService],
})
export class ServiceJobsModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistryService) {}

  onModuleInit() {
    this.registry.register({
      manifestVersion: 1,
      industryType: 'SERVICE',
      entityExtensions: [
        {
          tableName: 'service_jobs',
          description:
            'A job/work order against a customer asset (vehicle, route...) - tracks status through to invoicing',
        },
        {
          tableName: 'service_job_sales',
          description: 'Links a completed invoicing sale to the job it was for',
        },
      ],
    });
  }
}
