import { Module, OnModuleInit } from '@nestjs/common';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { OnlineStoreModule } from '../online-store/online-store.module';
import { OrgUsersModule } from '../org-users/org-users.module';
import { PrivateObjectStorageService } from '../common/storage/private-object-storage.service';
import { ConProjectGuard, ConstructionGuard } from './common/con-access';
import { ConSetupService } from './common/con-setup.service';
import { ComplianceAlertsService } from './compliance/compliance-alerts.service';
import { ComplianceService } from './compliance/compliance.service';
import { ConBillingCallbackController, ConPublicController, ConstructionController } from './construction.controller';
import { ConstructionService } from './construction.service';
import { ConLimitsListener } from './plans/con-limits.listener';
import { ConPlansService } from './plans/con-plans.service';
import { BqService } from './projects/bq.service';
import { ProjectsController, TendersController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { TendersService } from './projects/tenders.service';
import { LabourService } from './site/labour.service';
import { SafetyService } from './site/safety.service';
import { SiteController } from './site/site.controller';
import { SiteService } from './site/site.service';

/** Construction contractors (industryType "CONSTRUCTION", served at CONSTRUCTION_DOMAIN). See docs/construction. */
@Module({
  imports: [ModuleRegistryModule, OnlineStoreModule, OrgUsersModule],
  controllers: [ConstructionController, TendersController, ProjectsController, SiteController, ConBillingCallbackController, ConPublicController],
  providers: [
    ConSetupService,
    ConstructionGuard,
    ConProjectGuard,
    ConPlansService,
    ConLimitsListener,
    ComplianceService,
    ComplianceAlertsService,
    ConstructionService,
    ProjectsService,
    TendersService,
    BqService,
    SiteService,
    LabourService,
    SafetyService,
    PrivateObjectStorageService,
  ],
  // Platform admin edits plans and coupons, extends trials and records payments.
  exports: [ConPlansService, ConSetupService, ComplianceAlertsService],
})
export class ConstructionModule implements OnModuleInit {
  constructor(private readonly registry: ModuleRegistryService) {}

  onModuleInit() {
    this.registry.register({
      manifestVersion: 1,
      industryType: 'CONSTRUCTION',
      entityExtensions: [
        { tableName: 'con_plans', description: 'Construction price list: limits and features per plan (global)' },
        { tableName: 'con_coupons', description: 'Construction discount codes (global)' },
        { tableName: 'con_subscriptions', description: "A contractor's construction plan, trial and paid-up date" },
        { tableName: 'con_subscription_payments', description: 'Payments for the construction plan (M-Pesa or recorded by ZARODA)' },
        { tableName: 'con_roles', description: 'Construction roles with approval limits' },
        { tableName: 'con_user_roles', description: 'Company-level construction roles held by staff' },
        { tableName: 'con_project_members', description: 'Who works on which project, in which role' },
        { tableName: 'con_company_registrations', description: 'NCA registration per works class, with licence expiry' },
        { tableName: 'con_compliance_docs', description: 'Compliance vault documents with expiry dates and private files' },
        { tableName: 'con_category_limits', description: 'NCA category caps per works class' },
        { tableName: 'con_tax_settings', description: 'VAT, withholding, levies and retention rates with effective dates' },
        { tableName: 'con_alerts', description: 'In-app construction alerts (expiring documents)' },
        { tableName: 'con_settings', description: 'Construction rules: block or only warn' },
        { tableName: 'con_staff_accreditations', description: 'NCA accreditation cards held by staff' },
        { tableName: 'con_parties', description: 'Clients, consultants and subcontractors' },
        { tableName: 'con_tenders', description: 'Tender register with NCA cap check' },
        { tableName: 'con_projects', description: 'Projects and contracts' },
        { tableName: 'con_project_parties', description: 'Consultants and subcontractors on a project' },
        { tableName: 'con_project_permits', description: 'Project permit checklist (NCA, county, NEMA, DOSHS, occupancy)' },
        { tableName: 'con_milestones', description: 'Programme milestones with percent complete' },
        { tableName: 'con_bq_sections', description: 'Bill of Quantities sections' },
        { tableName: 'con_bq_items', description: 'Bill of Quantities items' },
        { tableName: 'con_site_diaries', description: 'Daily site diary, one per project per day' },
        { tableName: 'con_site_photos', description: 'Geo-tagged site photos (private files)' },
        { tableName: 'con_site_instructions', description: 'Site instructions from consultants' },
        { tableName: 'con_workers', description: 'Site workers with NCA accreditation cards' },
        { tableName: 'con_muster', description: 'Daily muster roll' },
        { tableName: 'con_toolbox_talks', description: 'Toolbox talks and who attended' },
        { tableName: 'con_ppe_issues', description: 'PPE issued to workers' },
        { tableName: 'con_permits_to_work', description: 'Permits to work (height, hot works, excavation...)' },
        { tableName: 'con_incidents', description: 'Incident register with DOSHS reporting' },
      ],
    });
  }
}
