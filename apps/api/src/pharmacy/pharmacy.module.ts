import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { PharmacyHooksService } from './pharmacy-hooks.service';

/**
 * Phase 5's first slice (DESIGN.md's Phase 5+ scope): batch/expiry
 * ENFORCEMENT only, deliberately not prescription linkage or
 * controlled-substance flags yet - the same one-bounded-slice-at-a-time
 * discipline used throughout this project. No new entities or schema of
 * its own for this slice: batch/expiry tracking already existed as a
 * core capability (Batch, SaleLineItem.batchId - see schema.prisma), so
 * this module's entire job is layering a pharmacy-specific POLICY
 * (block dispensing an expired batch) on top of data core already
 * collects, via the same hook mechanism proven in Phase 4.
 */
@Module({
  imports: [ModuleRegistryModule],
  providers: [PharmacyHooksService],
})
export class PharmacyModule implements OnModuleInit {
  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly hooks: PharmacyHooksService,
  ) {}

  onModuleInit() {
    this.registry.register({
      industryType: 'PHARMACY',
      hooks: [
        {
          event: 'inventory.beforeDecrement',
          handler: this.hooks.onInventoryBeforeDecrement.bind(this.hooks),
        },
      ],
    });
  }
}
