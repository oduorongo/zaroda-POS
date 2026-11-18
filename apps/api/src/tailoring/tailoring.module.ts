import { Module, OnModuleInit } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { DocumentNumbersService } from '../school-supplier/document-numbers.service';
import { TailoringController } from './tailoring.controller';
import { TailoringService } from './tailoring.service';

/**
 * Uniform makers (industryType "UNIFORM_MAKER"): a school supplier that makes its own uniforms. On top of the school supplier
 * screens it adds tailors, the jobs given to them, hand-ins of finished pieces and tailor pay. The item's recipe is the list of
 * materials one piece uses; a uniform set is an item whose recipe is finished pieces (taken from stock when the set is sold).
 */
@Module({
  imports: [InventoryModule, ModuleRegistryModule],
  controllers: [TailoringController],
  providers: [TailoringService, DocumentNumbersService],
})
export class TailoringModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistryService) {}

  onModuleInit() {
    this.registry.register({
      manifestVersion: 1,
      industryType: 'UNIFORM_MAKER',
      entityExtensions: [
        { tableName: 'tailors', description: 'People who sew for the business, paid by the piece' },
        { tableName: 'tailor_jobs', description: 'Batches of one piece and size given to a tailor, with the materials handed out' },
        { tableName: 'tailor_job_materials', description: 'The materials handed out for a job, at their cost then' },
        { tableName: 'tailor_hand_ins', description: 'Finished pieces handed in: into stock at materials + rate, earning the tailor' },
        { tableName: 'tailor_payments', description: 'Money paid to tailors (voided, never edited)' },
      ],
    });
  }
}
